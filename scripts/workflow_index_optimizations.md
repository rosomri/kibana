# Workflow Index Optimizations
## Reducing Elasticsearch Load from Workflow Executions

Based on analysis of the workflow execution engine code, here are optimizations to reduce memory pressure and cluster load.

---

## Current Issues Identified

### 1. **Frequent Writes**
- Workflow state is flushed every **0.5 seconds** while running (`FLUSH_INTERVAL_MS`)
- Each workflow execution creates:
  - 1 workflow execution document (frequently updated)
  - Multiple step execution documents (one per step)
  - Execution log events
- With many concurrent workflows, this creates high write volume

### 2. **No Index Settings Optimized**
- Indices created without:
  - `refresh_interval` configuration
  - `number_of_replicas` optimization
  - `number_of_shards` configuration
  - Index lifecycle management (ILM)

### 3. **Expensive Refresh Operations**
- Some operations use `refresh: 'wait_for'` which blocks until indexed
- This is necessary for deduplication but adds latency

### 4. **No Data Retention**
- Indices grow indefinitely (`.workflows-executions`, `.workflows-step-executions`)
- Old execution data never deleted
- Contributes to index size and shard count

---

## Optimization Strategies

### 1. Index Settings Optimization

#### A. Increase Refresh Interval

**Problem**: Default refresh interval (1s) causes frequent index refreshes, consuming memory.

**Solution**: Increase refresh interval for workflow indices to reduce refresh frequency.

```javascript
PUT /.workflows-executions/_settings
{
  "index": {
    "refresh_interval": "5s"
  }
}

PUT /.workflows-step-executions/_settings
{
  "index": {
    "refresh_interval": "5s"
  }
}
```

**Impact**: 
- Reduces refresh operations by 80% (from 1s to 5s)
- Slightly increases search latency (documents searchable after 5s instead of 1s)
- Acceptable for workflow execution data (not real-time critical)

#### B. Reduce Replicas (if acceptable)

**Problem**: Default replicas (1) doubles write operations and storage.

**Solution**: Reduce replicas for non-critical workflow execution data.

```javascript
PUT /.workflows-executions/_settings
{
  "index": {
    "number_of_replicas": 0
  }
}

PUT /.workflows-step-executions/_settings
{
  "index": {
    "number_of_replicas": 0
  }
}
```

**Impact**:
- **HALVES** write operations (no replica writes)
- **HALVES** storage requirements
- **Reduces recovery load** when nodes fail (no replica shards to recover)
- Trade-off: No redundancy (data loss if node fails before backup)

**Alternative**: Keep 1 replica but only for critical workflows, or use 0 replicas with regular snapshots.

#### C. Optimize Shard Count

**Problem**: Default shard count may not be optimal for workflow data volume.

**Solution**: Use fewer, larger shards for workflow indices.

```javascript
// Check current shard count
GET /.workflows-executions/_settings?filter_path=**.number_of_shards

// If indices are small, consider fewer shards
// Note: Can only be set at index creation, not after
```

**Impact**: Fewer shards = less overhead, but less parallelism.

---

### 2. Code-Level Optimizations

#### A. Increase Flush Interval

**Current**: `FLUSH_INTERVAL_MS = 500ms` (flushes every 0.5 seconds)

**Recommended**: Increase to 2-5 seconds for non-critical workflows.

**Location**: `src/platform/plugins/shared/workflows_execution_engine/server/workflow_execution_loop/persistence_loop.ts`

```typescript
// Current
const FLUSH_INTERVAL_MS = 500;

// Recommended (configurable)
const FLUSH_INTERVAL_MS = process.env.WORKFLOW_FLUSH_INTERVAL_MS 
  ? parseInt(process.env.WORKFLOW_FLUSH_INTERVAL_MS, 10) 
  : 2000; // 2 seconds default
```

**Impact**:
- Reduces write operations by 75% (from 2/sec to 0.5/sec per workflow)
- With 100 concurrent workflows: from 200 writes/sec to 50 writes/sec
- Slightly increases risk of data loss if node crashes (last 2s of state)

#### B. Batch Step Execution Updates

**Current**: Step executions are upserted individually or in small batches.

**Recommended**: Batch more aggressively, flush less frequently.

**Location**: `src/platform/plugins/shared/workflows_execution_engine/server/repositories/step_execution_repository.ts`

Already uses `refresh: false` which is good. Consider:
- Increasing batch size
- Adding batching delay (collect updates for 100-200ms before flushing)

#### C. Remove Unnecessary `refresh: 'wait_for'`

**Current**: Some operations use `refresh: 'wait_for'` for deduplication.

**Location**: `src/platform/plugins/shared/workflows_execution_engine/server/plugin.ts:391`

**Recommendation**: Only use `refresh: 'wait_for'` when absolutely necessary (deduplication). For most updates, use `refresh: false`.

---

### 3. Index Lifecycle Management (ILM)

#### A. Implement ILM Policy for Data Retention

**Problem**: Workflow execution data grows indefinitely.

**Solution**: Use ILM to automatically delete old execution data.

```javascript
// Create ILM policy
PUT /_ilm/policy/workflow-executions-policy
{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": {
            "max_size": "50GB",
            "max_age": "7d"
          },
          "set_priority": {
            "priority": 100
          }
        }
      },
      "warm": {
        "min_age": "7d",
        "actions": {
          "set_priority": {
            "priority": 50
          },
          "allocate": {
            "number_of_replicas": 0
          }
        }
      },
      "delete": {
        "min_age": "30d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}

// Apply to workflow indices
PUT /.workflows-executions
{
  "settings": {
    "index.lifecycle.name": "workflow-executions-policy",
    "index.lifecycle.rollover_alias": "workflows-executions"
  }
}

PUT /.workflows-step-executions
{
  "settings": {
    "index.lifecycle.name": "workflow-executions-policy",
    "index.lifecycle.rollover_alias": "workflows-step-executions"
  }
}
```

**Impact**:
- Automatically deletes execution data older than 30 days
- Reduces index size over time
- Prevents indefinite growth

**Alternative**: Use time-based indices (e.g., `.workflows-executions-2026-01`) for easier management.

---

### 4. Query Optimizations

#### A. Use Filter Context Instead of Query Context

**Current**: Some queries use `must` (query context with scoring).

**Already Optimized**: The code already uses `filter` context in most places (good!).

**Location**: `workflow_execution_repository.ts:188-226`

#### B. Limit Search Results

**Current**: Some searches fetch up to 1000 results.

**Location**: `search_step_executions.ts:52`

**Recommendation**: 
- Use pagination more aggressively
- Consider search_after for deep pagination
- Limit default size to 100-200

#### C. Use `_source` Filtering

**Current**: Full documents are fetched even when only specific fields are needed.

**Recommendation**: Use `_source` filtering to fetch only needed fields.

```typescript
const response = await esClient.search<EsWorkflowExecution>({
  index: this.indexName,
  query: { ... },
  _source: ['id', 'status', 'createdAt'], // Only fetch needed fields
  size: 100,
});
```

---

### 5. Bulk Operations

#### A. Batch Multiple Updates

**Current**: Individual updates are made frequently.

**Already Optimized**: `bulkUpdateWorkflowExecutions` exists and is used.

**Recommendation**: 
- Use bulk operations more aggressively
- Batch updates across multiple workflows
- Consider async batching (collect updates, flush periodically)

---

## Implementation Priority

### Immediate (This Week)
1. ✅ **Increase refresh interval** to 5s (low risk, high impact)
2. ✅ **Reduce replicas to 0** (if acceptable for your use case)
3. ✅ **Implement ILM policy** for data retention

### Short-term (This Month)
4. ✅ **Increase flush interval** to 2-5 seconds (requires code change)
5. ✅ **Optimize query patterns** (use _source filtering)

### Long-term (This Quarter)
6. ✅ **Consider time-based indices** for better scalability
7. ✅ **Implement async batching** for writes
8. ✅ **Add monitoring** for write rates and index sizes

---

## Expected Impact

### Write Operations Reduction
- **Refresh operations**: 80% reduction (5s vs 1s interval)
- **Replica writes**: 50% reduction (0 replicas vs 1)
- **Flush frequency**: 75% reduction (2s vs 0.5s interval)
- **Overall**: ~85% reduction in write operations

### Memory Pressure Reduction
- **Fewer refresh operations**: Less memory for refresh buffers
- **Fewer replica shards**: Less memory during recovery
- **Smaller indices**: Less field data cache usage
- **ILM cleanup**: Prevents indefinite growth

### Recovery Impact
- **Fewer replica shards**: Faster recovery when nodes fail
- **Smaller indices**: Less data to recover
- **Better shard distribution**: More balanced cluster

---

## Monitoring Recommendations

Track these metrics:
1. **Index write rate**: `_stats` API, monitor `indexing.index_total`
2. **Refresh rate**: Monitor `refresh.total`
3. **Index size**: Track `store.size_in_bytes`
4. **Shard count**: Monitor unassigned shards
5. **Query performance**: Track search latency

---

## Risk Assessment

### Low Risk
- ✅ Increasing refresh interval (slight latency increase)
- ✅ Reducing replicas (if backups are acceptable)
- ✅ ILM policies (data retention)

### Medium Risk
- ⚠️ Increasing flush interval (potential data loss on crash)
- ⚠️ Changing index settings (requires testing)

### High Risk
- ❌ Changing shard count (requires reindexing)
- ❌ Removing replicas without backups (data loss risk)

---

## Testing Recommendations

1. **Test in staging** with similar workload
2. **Monitor metrics** before and after changes
3. **Gradual rollout** - apply one change at a time
4. **Load testing** - verify performance improvements
5. **Backup strategy** - ensure data can be recovered

---

*Generated based on analysis of workflow execution engine codebase*

