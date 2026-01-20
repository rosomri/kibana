# Time-Based Indices vs Single Indices: Analysis for Workflow Executions

## Current Architecture
- **Single Indices**: `.workflows-executions` and `.workflows-step-executions`
- **Fixed Index Names**: Hardcoded in `mappings.ts`
- **Simple Queries**: Direct index name in all queries

---

## Disadvantages of Moving to Time-Based Indices

### 1. **Significant Code Changes Required**

#### A. Index Name Resolution
**Current**:
```typescript
// Simple constant
export const WORKFLOWS_EXECUTIONS_INDEX = '.workflows-executions';

// Direct usage
await esClient.index({
  index: WORKFLOWS_EXECUTIONS_INDEX,
  ...
});
```

**Time-Based**:
```typescript
// Need to resolve index name based on date
function getIndexName(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `.workflows-executions-${year}-${month}`;
}

// Must resolve for every operation
await esClient.index({
  index: getIndexName(new Date()),
  ...
});
```

**Impact**: 
- Need to modify **every** place that uses index names
- ~20+ files need changes (repositories, queries, etc.)
- Risk of bugs if index resolution is wrong

#### B. Query Changes
**Current**:
```typescript
// Simple single-index query
await esClient.search({
  index: WORKFLOWS_EXECUTIONS_INDEX,
  query: { ... }
});
```

**Time-Based**:
```typescript
// Must query across multiple indices
const indexPattern = '.workflows-executions-*';
// Or use alias
const alias = 'workflows-executions';

await esClient.search({
  index: indexPattern, // or alias
  query: { ... }
});
```

**Impact**:
- All search queries need to use index patterns or aliases
- More complex query logic
- Potential performance impact (querying multiple indices)

### 2. **Index Management Complexity**

#### A. Alias Management
**Required Setup**:
```javascript
// Create write alias pointing to current index
PUT /.workflows-executions-2026-01/_alias/workflows-executions-write

// Create read alias pointing to all indices
PUT /.workflows-executions-*/_alias/workflows-executions-read
```

**Ongoing Maintenance**:
- Must update aliases when rolling over indices
- Need to handle alias updates atomically
- Risk of writes going to wrong index if alias misconfigured

#### B. Rollover Configuration
**Required**:
```javascript
// ILM policy with rollover
PUT /_ilm/policy/workflow-executions-policy
{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": {
            "max_size": "50GB",
            "max_age": "30d"
          }
        }
      }
    }
  }
}
```

**Complexity**:
- Need to configure rollover triggers (size, age, docs)
- Must ensure rollover happens correctly
- Risk of index growing too large if rollover fails

### 3. **Query Performance Impact**

#### A. Multi-Index Queries
**Current**: Query single index (fast)
```typescript
// Single index = fast
index: '.workflows-executions'
```

**Time-Based**: Query multiple indices (potentially slower)
```typescript
// Multiple indices = more overhead
index: '.workflows-executions-*'  // Could be 12+ indices
```

**Impact**:
- Query coordinator must merge results from multiple indices
- More shards to query = more overhead
- Slower queries when spanning many indices

#### B. Aggregations Across Indices
**Current**: Simple aggregation on single index
**Time-Based**: Must aggregate across multiple indices
- More memory usage for aggregations
- Slower aggregation performance
- Potential timeout issues

### 4. **Data Migration Required**

#### A. Existing Data
**Problem**: You have 52M+ documents in single indices
- Need to reindex existing data into time-based indices
- Must determine which time-based index each document belongs to
- Migration downtime or complex dual-write strategy

**Migration Options**:
1. **Reindex in place** (downtime)
   - Stop writes
   - Reindex all documents
   - Switch to new indices
   - **Risk**: Downtime, data loss if migration fails

2. **Dual-write strategy** (no downtime, complex)
   - Write to both old and new indices
   - Read from both
   - Gradually migrate
   - **Risk**: Complexity, potential inconsistencies

#### B. Migration Complexity
- Need to write migration script
- Must handle edge cases (documents without dates, etc.)
- Testing required
- Rollback plan needed

### 5. **More Shards = More Overhead**

#### Current
- 2 indices × 2 shards = **4 shards total**

#### Time-Based (Monthly)
- 12 indices/year × 2 shards = **24 shards per year**
- After 2 years: **48 shards**
- After 5 years: **120 shards**

**Impact**:
- More shards = more cluster state overhead
- More shards = more recovery time during node failures
- More shards = more memory usage
- Cluster shard limit (1000-3000 shards) becomes concern

### 6. **Code Complexity for Date Handling**

#### A. Index Resolution Logic
**Required Everywhere**:
```typescript
// Need this logic in many places
function resolveIndexName(documentDate: Date): string {
  const year = documentDate.getFullYear();
  const month = String(documentDate.getMonth() + 1).padStart(2, '0');
  return `.workflows-executions-${year}-${month}`;
}
```

**Issues**:
- What if document has no date?
- What if date is in the future?
- What if date is very old?
- Timezone handling complexity

#### B. Cross-Index Queries
**Complex Queries**:
```typescript
// Finding executions across date range
const startDate = new Date('2025-01-01');
const endDate = new Date('2025-12-31');

// Must determine which indices to query
const indices = getIndicesForDateRange(startDate, endDate);
// Could be 12+ indices

await esClient.search({
  index: indices,
  query: {
    bool: {
      must: [
        { range: { createdAt: { gte: startDate, lte: endDate } } },
        // ... other filters
      ]
    }
  }
});
```

### 7. **Testing Complexity**

#### A. Test Data Setup
**Current**: Simple - create test index
**Time-Based**: Complex - need multiple test indices with different dates

#### B. Integration Tests
- Must test index resolution logic
- Must test cross-index queries
- Must test rollover scenarios
- Must test alias updates

### 8. **Operational Overhead**

#### A. Monitoring
- Must monitor multiple indices
- Must track index sizes across all time-based indices
- More complex dashboards

#### B. Troubleshooting
- Harder to debug (which index has the issue?)
- More complex log analysis
- Harder to identify problematic indices

### 9. **Potential for Index Proliferation**

#### Risk
- If rollover misconfigured, could create too many indices
- Small indices = inefficient (overhead per index)
- Could hit cluster limits

#### Example
- If rollover happens too frequently (e.g., daily instead of monthly)
- 365 indices per year
- Massive overhead

### 10. **Backward Compatibility**

#### Breaking Changes
- Existing code expects single index
- API consumers might break
- Need versioning strategy
- Migration period required

---

## Advantages of Time-Based Indices

### 1. **Better ILM Support**
- ILM works naturally with time-based indices
- Automatic deletion of old indices
- No need for delete_by_query

### 2. **Easier Data Retention**
- Delete entire old indices (fast)
- No need to scan millions of documents
- Better performance

### 3. **Better Scalability**
- Each index stays smaller
- Better shard distribution
- Easier to manage large datasets

### 4. **Better Performance for Recent Data**
- Queries for recent data only hit current index
- Faster queries when you know the time range

---

## Recommendation

### **For Your Use Case: Stay with Single Indices + Cleanup Script**

**Reasons**:
1. **You have 52M+ existing documents** - migration is complex and risky
2. **Code changes are extensive** - high risk of bugs
3. **Query performance** - single index is faster for your queries
4. **Shard overhead** - time-based would create many more shards
5. **Cleanup script works well** - simpler solution for your needs

### **When Time-Based Makes Sense**
- Starting fresh (no existing data)
- Very high write volume (millions per day)
- Need automatic ILM deletion
- Queries are always time-range specific
- Willing to accept complexity

### **Alternative: Hybrid Approach**
- Keep single indices for now
- Use cleanup script for retention
- Consider time-based in future if:
  - Indices grow beyond 100GB
  - Write volume increases significantly
  - ILM becomes critical requirement

---

## Cost-Benefit Analysis

| Factor | Single Index + Cleanup | Time-Based Indices |
|--------|----------------------|-------------------|
| **Code Changes** | Minimal (cleanup script) | Extensive (20+ files) |
| **Migration Effort** | None | High (52M+ docs) |
| **Query Performance** | Fast (single index) | Slower (multi-index) |
| **Shard Count** | Low (4 shards) | High (24+ shards/year) |
| **Data Retention** | Manual (cleanup script) | Automatic (ILM) |
| **Complexity** | Low | High |
| **Risk** | Low | Medium-High |
| **Maintenance** | Low | High |

---

## Conclusion

**For workflow executions with 52M+ existing documents:**
- **Disadvantages outweigh advantages** for time-based indices
- **Cleanup script is simpler and safer**
- **Consider time-based only if starting fresh** or if requirements change significantly

The cleanup script approach gives you:
- ✅ Data retention (deletes old documents)
- ✅ Minimal code changes
- ✅ No migration needed
- ✅ Better query performance
- ✅ Lower shard count
- ✅ Less complexity

Time-based indices would add significant complexity without proportional benefits for your current use case.

