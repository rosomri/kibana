# Workflow Indices: Complete Fact-Based Summary
## Write Frequency, Flush Patterns, and Elasticsearch Impact

**Analysis Date**: 2026-01-20  
**Cluster**: 9a1c862d4fcb4acca037c5f0f9f86702  
**Data Source**: Actual cluster metrics

---

## Executive Summary

**3 Workflow-Related Indices:**
1. `.workflows-executions` - Single index
2. `.workflows-step-executions` - Single index  
3. `.workflows-execution-data-stream-logs` - Data stream

**Total Impact:**
- **314.1M documents**
- **56.3 GB storage**
- **383.1M indexing operations**
- **37,323 seconds total indexing time**

---

## Index 1: `.workflows-executions`

### Basic Facts
- **Type**: Single index (not time-based)
- **Documents**: 58,572,242
- **Storage**: 27.5 GB
- **Shards**: 2 (1 primary + 1 replica)
- **Shard Size**: 13.75 GB per shard
- **Shard Distribution**: 1 shard per node (good)

### Write Frequency & Pattern

**Flush Frequency**: Every 500ms (time-based) + immediate on workflow start

**Flush Triggers**:
1. **Time-based**: Every 500ms via `persistenceLoop()` (code: `persistence_loop.ts:15`)
2. **Immediate**: On workflow start (with `refresh: 'wait_for'` for deduplication)
3. **Final**: On workflow completion

**Write Pattern**:
```
T=0ms:    Workflow starts → immediate write (refresh: 'wait_for')
T=500ms:  First flush → update workflow execution state
T=1000ms: Second flush → update workflow execution state
T=1500ms: Third flush → update workflow execution state
...
T=end:    Final flush → terminal status update
```

**Actual Write Volume**:
- **Total Operations**: 96,055,927
- **Operations per Document**: 1.64 (indicates frequent updates)
- **Peak**: 261,039 executions/hour (observed 1/18/2026 8:00 PM)
- **Average**: ~165,098 executions/hour
- **Estimated Writes per Execution**: ~4 writes (start + 3×500ms flushes)

### Performance Metrics

**Write Efficiency**:
- **Avg Time per Operation**: 0.19ms
- **Total Indexing Time**: 18,206.52 seconds
- **Time per 1M Operations**: 189.54 seconds
- **Efficiency Rating**: 🟢 EXCELLENT (but 3.3x slower than event logs)

**Refresh Performance**:
- **Total Refreshes**: 909,528
- **Avg Refresh Time**: 76.19ms
- **Total Refresh Time**: 69,297.59 seconds
- **Refresh Frequency**: 47,250 refreshes/hour
- **Refresh Impact**: Major contributor to memory pressure

### Impact on Elasticsearch

**Resource Consumption**:
- **Indexing Time**: 18,206s = **48.8% of total workflow indexing time**
- **Write Operations**: 96.1M (25.0% of total operations)
- **Storage**: 27.5 GB (48.9% of total workflow storage)

**Memory Pressure Contributors**:
1. **Large Shards** (13.75 GB) - slow operations, high memory
2. **Excessive Refreshes** (909K) - constant memory pressure
3. **Frequent Updates** (1.64 ops/doc) - updates slower than creates
4. **Replica Writes** - doubles all operations

**Shard Health**:
- ✅ Good distribution (1 shard per node)
- ⚠️ Shards too large (13.75 GB - should be <10GB)
- ✅ Low imbalance (0.3%)

---

## Index 2: `.workflows-step-executions`

### Basic Facts
- **Type**: Single index (not time-based)
- **Documents**: 37,985,884
- **Storage**: 17.87 GB
- **Shards**: 2 (1 primary + 1 replica)
- **Shard Size**: 8.93 GB per shard
- **Shard Distribution**: 1 shard per node (good)

### Write Frequency & Pattern

**Flush Frequency**: Every 500ms (time-based) via bulk upsert

**Flush Triggers**:
1. **Time-based**: Every 500ms via `persistenceLoop()` (code: `persistence_loop.ts:15`)
2. **Method**: Bulk upsert of all accumulated step execution changes
3. **Refresh**: `refresh: false` (documents searchable after next refresh ~1s)

**Write Pattern**:
```
T=100ms:  Step 1 completes → accumulates in memory
T=200ms:  Step 2 completes → accumulates in memory
T=500ms:  FLUSH → bulk upsert of Step 1 + Step 2 (single operation)
T=600ms:  Step 3 completes → accumulates in memory
T=1000ms: FLUSH → bulk upsert of Step 3 (single operation)
```

**Actual Write Volume**:
- **Total Operations**: 21,413,548
- **Operations per Document**: 0.56 (efficient - bulk operations)
- **Bulk Efficiency**: Multiple steps batched into single bulk operation

### Performance Metrics

**Write Efficiency**:
- **Avg Time per Operation**: 0.18ms
- **Total Indexing Time**: 3,800.63 seconds
- **Time per 1M Operations**: 177.49 seconds
- **Efficiency Rating**: 🟢 EXCELLENT

**Refresh Performance**:
- **Total Refreshes**: 82,384
- **Avg Refresh Time**: 57.86ms
- **Total Refresh Time**: 4,766.41 seconds
- **Refresh Frequency**: 62,223 refreshes/hour

### Impact on Elasticsearch

**Resource Consumption**:
- **Indexing Time**: 3,801s = **10.2% of total workflow indexing time**
- **Write Operations**: 21.4M (5.6% of total operations)
- **Storage**: 17.87 GB (31.7% of total workflow storage)

**Memory Pressure Contributors**:
- ✅ Efficient bulk operations
- ✅ Good shard size (8.93 GB)
- ⚠️ Still frequent flushes (every 500ms)
- ⚠️ Replica writes (doubles operations)

**Shard Health**:
- ✅ Good distribution (1 shard per node)
- ✅ Optimal shard size (8.93 GB)
- ✅ Low imbalance (0.1%)

---

## Index 3: `.workflows-execution-data-stream-logs` (Event Logs)

### Basic Facts
- **Type**: Data stream (time-based)
- **Documents**: 265,910,910
- **Storage**: 33.54 GB
- **Shards**: 2 (1 primary + 1 replica)
- **Shard Size**: 16.77 GB average (but 100% imbalance!)
- **Shard Distribution**: ⚠️ **1 shard assigned, 1 shard unassigned** (CRITICAL)

### Write Frequency & Pattern

**Flush Frequency**: 
- **Immediate**: After each step start AND step finish (2 flushes per step)
- **Time-based**: Every 500ms via `persistenceLoop()` (bulk flush of accumulated events)

**Flush Triggers**:
1. **Per-step immediate** (code: `node_implementation.ts:109,157`):
   ```typescript
   await this.stepExecutionRuntime.startStep();
   await this.stepExecutionRuntime.flushEventLogs();  // Immediate flush
   
   // ... execute step ...
   
   await this.stepExecutionRuntime.flushEventLogs();  // Immediate flush
   ```

2. **Time-based bulk** (code: `persistence_loop.ts:15`):
   - Every 500ms via `persistenceLoop()`
   - Flushes accumulated events from event queue

**Write Pattern**:
```
T=0ms:    Workflow starts → log event → immediate flush
T=100ms:  Step 1 starts → log event → immediate flush
T=200ms:  Step 1 finishes → log event → immediate flush
T=300ms:  Step 2 starts → log event → immediate flush
T=400ms:  Step 2 finishes → log event → immediate flush
T=500ms:  PERSISTENCE LOOP → bulk flush any accumulated events
```

**Actual Write Volume**:
- **Total Operations**: 265,911,367
- **Operations per Document**: 1.00 (mostly creates, minimal updates)
- **Peak (Last 24h)**: 78,281 events/hour = 22 events/second
- **Average (Last 24h)**: 58,474 events/hour = 16 events/second
- **Events per Execution**: ~5.5 events per workflow execution

### Performance Metrics

**Write Efficiency**:
- **Avg Time per Operation**: 0.06ms (3.3x faster than executions!)
- **Total Indexing Time**: 15,316.07 seconds
- **Time per 1M Operations**: 57.60 seconds
- **Efficiency Rating**: 🟢 EXCELLENT (fastest of all indices)
- **Data Stream Advantage**: 69.6% faster per operation than single indices

**Refresh Performance**:
- **Total Refreshes**: 17,065 (53x fewer than executions!)
- **Avg Refresh Time**: 72.71ms
- **Total Refresh Time**: 1,240.83 seconds
- **Refresh Frequency**: 49,510 refreshes/hour

### Impact on Elasticsearch

**Resource Consumption**:
- **Indexing Time**: 15,316s = **41.0% of total workflow indexing time**
- **Write Operations**: 265.9M (69.4% of total operations)
- **Storage**: 33.54 GB (59.6% of total workflow storage)

**Memory Pressure Contributors**:
1. **High Operation Count** (265.9M) - despite fast writes
2. **Shard Imbalance** (100%!) - all data on one shard (33.54 GB)
3. **Unassigned Shard** - one shard is unassigned (potential recovery issue)
4. **Immediate Flushes** - constant write stream (no batching)
5. **Replica Writes** - doubles all operations

**Shard Health**:
- 🔴 **CRITICAL**: 100% shard imbalance
- 🔴 **CRITICAL**: 1 shard unassigned
- 🔴 **CRITICAL**: All writes hit single shard (33.54 GB) = bottleneck

---

## Comparative Analysis

### Write Efficiency (Time per Operation)

| Index | Time/Op | Efficiency | vs Event Logs |
|-------|---------|------------|---------------|
| **Event Logs** | **0.06ms** | 🟢 **EXCELLENT** | Baseline |
| Step Executions | 0.18ms | 🟢 EXCELLENT | 3.0x slower |
| Executions | 0.19ms | 🟢 EXCELLENT | **3.3x slower** |

**Finding**: Data streams are 69.6% faster per operation than single indices.

### Total Resource Impact (Indexing Time)

| Index | Indexing Time | % of Total | Operations | Time/1M Ops |
|-------|---------------|------------|------------|-------------|
| **Executions** | **18,206s** | **48.8%** | 96.1M | 189.54s |
| Event Logs | 15,316s | 41.0% | 265.9M | 57.60s |
| Step Executions | 3,801s | 10.2% | 21.4M | 177.49s |

**Finding**: Executions index consumes MORE indexing time (48.8%) despite having FEWER operations (25%), because writes are 3.3x slower.

### Refresh Impact

| Index | Refreshes | Avg Time | Total Time | Impact |
|-------|-----------|----------|------------|--------|
| **Executions** | **909,528** | **76.19ms** | **69,298s** | 🔴 **MAJOR** |
| Step Executions | 82,384 | 57.86ms | 4,766s | 🟡 Moderate |
| Event Logs | 17,065 | 72.71ms | 1,241s | 🟢 Low |

**Finding**: Executions index has 53x more refreshes than event logs, consuming 69,298s vs 1,241s.

### Operations vs Time Impact

| Index | Operations | % of Ops | Indexing Time | % of Time | Efficiency |
|-------|-----------|----------|---------------|-----------|------------|
| Event Logs | 265.9M | 69.4% | 15,316s | 41.0% | ✅ Efficient |
| Executions | 96.1M | 25.0% | 18,206s | **48.8%** | ⚠️ Less efficient |
| Step Executions | 21.4M | 5.6% | 3,801s | 10.2% | ✅ Efficient |

**Finding**: Executions index is less efficient - 25% of operations consume 48.8% of time.

---

## Flush Frequency Summary

### Execution Indices (`.workflows-executions` + `.workflows-step-executions`)

**Flush Interval**: 500ms (time-based)

**Code Location**: `persistence_loop.ts:15`
```typescript
export const FLUSH_INTERVAL_MS = 500;
```

**What Gets Flushed**:
- Workflow execution state changes (accumulated)
- Step execution changes (bulk upsert of all accumulated steps)
- Event logs (bulk flush of accumulated events)

**When**:
- Every 500ms while workflow is RUNNING
- Immediate on workflow start
- Final on workflow completion

**Impact**:
- All running workflows flush simultaneously every 500ms
- Creates write spikes every 500ms
- With 261K executions/hour peak = massive simultaneous flushes

### Event Logs (`.workflows-execution-data-stream-logs`)

**Flush Frequency**: 
- **Immediate**: Per step (start + finish)
- **Time-based**: Every 500ms (bulk flush)

**Code Locations**:
- Immediate: `node_implementation.ts:109,157`
- Time-based: `persistence_loop.ts:15`

**What Gets Flushed**:
- Step start events (immediate)
- Step finish events (immediate)
- Accumulated events (bulk every 500ms)

**Impact**:
- Immediate writes create constant write stream
- Bulk writes every 500ms add to spikes
- Combined = high write volume

---

## How They Affect Elasticsearch

### 1. Memory Pressure

**Primary Contributor: Executions Index (48.8% of indexing time)**
- Large shards (13.75 GB) require more memory for operations
- Excessive refreshes (909K) create constant memory pressure
- Slow writes (0.19ms) hold memory longer
- Frequent updates (1.64 ops/doc) = more overhead

**Secondary Contributor: Event Logs (41.0% of indexing time)**
- High operation count (265.9M) despite fast writes
- Shard imbalance (all on one shard) = bottleneck
- Constant write stream (immediate flushes)

### 2. Write Load

**Peak Scenario** (261K executions/hour):
- **Executions**: ~144 writes/sec (72 executions × 2: start + flush)
- **Step Executions**: ~144 writes/sec (bulk upserts)
- **Event Logs**: ~22 writes/sec (immediate per step)
- **Total**: ~310 writes/sec (without replicas)
- **With Replicas**: ~620 operations/sec

**Every 500ms Flush Cycle**:
- All running workflows flush simultaneously
- Creates write spike every 500ms
- With high concurrency = massive spikes

### 3. Refresh Load

**Executions Index**:
- 909,528 refreshes
- 76.19ms average refresh time
- 69,298 seconds total refresh time
- **Major contributor to memory pressure**

**Event Logs**:
- 17,065 refreshes (53x fewer!)
- 72.71ms average refresh time
- 1,241 seconds total refresh time
- **Minimal refresh impact**

### 4. Shard Health

**Executions**:
- ✅ Good distribution (1 shard per node)
- ⚠️ Shards too large (13.75 GB)
- ✅ Low imbalance (0.3%)

**Step Executions**:
- ✅ Good distribution (1 shard per node)
- ✅ Optimal shard size (8.93 GB)
- ✅ Low imbalance (0.1%)

**Event Logs**:
- 🔴 **CRITICAL**: 100% shard imbalance
- 🔴 **CRITICAL**: 1 shard unassigned
- 🔴 **CRITICAL**: All writes hit single shard (33.54 GB)

---

## Key Facts Summary

### Write Frequencies

| Index | Flush Frequency | Flush Triggers | Write Pattern |
|-------|----------------|----------------|---------------|
| Executions | Every 500ms | Time-based + immediate start | Batched, periodic spikes |
| Step Executions | Every 500ms | Time-based bulk | Batched, periodic spikes |
| Event Logs | Per step + 500ms | Immediate per step + time-based | Immediate + batched |

### Write Volumes

| Index | Total Operations | Operations/Doc | Peak/Hour | Avg/Hour |
|-------|-----------------|----------------|-----------|----------|
| Event Logs | 265,911,367 | 1.00 | 78,281 | 58,474 |
| Executions | 96,055,927 | 1.64 | 261,039 | 165,098 |
| Step Executions | 21,413,548 | 0.56 | - | - |

### Performance Impact

| Index | Indexing Time | % of Total | Time/1M Ops | Efficiency |
|-------|--------------|------------|-------------|------------|
| **Executions** | **18,206s** | **48.8%** | **189.54s** | ⚠️ Less efficient |
| Event Logs | 15,316s | 41.0% | 57.60s | ✅ Most efficient |
| Step Executions | 3,801s | 10.2% | 177.49s | ✅ Efficient |

### Refresh Impact

| Index | Refreshes | Total Time | Avg Time | Impact |
|-------|-----------|------------|----------|--------|
| **Executions** | **909,528** | **69,298s** | **76.19ms** | 🔴 **MAJOR** |
| Step Executions | 82,384 | 4,766s | 57.86ms | 🟡 Moderate |
| Event Logs | 17,065 | 1,241s | 72.71ms | 🟢 Low |

---

## Corrected Root Causes

### Primary: Executions Index (48.8% of indexing time)

**Why it's the bottleneck:**
1. **Slower writes** (0.19ms vs 0.06ms) - 3.3x slower than event logs
2. **Excessive refreshes** (909K vs 17K) - 53x more refreshes
3. **Large shards** (13.75 GB) - slow operations
4. **Frequent updates** (1.64 ops/doc) - updates slower than creates

### Secondary: Event Logs (41.0% of indexing time)

**Why it still matters:**
1. **High volume** (265.9M ops) despite fast writes
2. **Shard imbalance** (100% - all on one shard)
3. **Unassigned shard** (critical issue)
4. **Immediate flushes** (no batching)

---

*All data from actual cluster analysis on 2026-01-20*

