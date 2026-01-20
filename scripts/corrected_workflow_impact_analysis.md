# Corrected Workflow Indices Impact Analysis
## Based on Actual Performance Metrics (Not Just Operation Counts)

**Analysis Date**: 2026-01-20  
**Cluster**: 9a1c862d4fcb4acca037c5f0f9f86702

---

## Key Finding: Not All Writes Are Equal

**Raw operation counts are misleading.** Actual resource impact is measured by **total indexing time**, not just operation count.

---

## Actual Resource Impact (By Indexing Time)

| Index | Operations | % of Ops | **Indexing Time** | **% of Time** | **Time/1M Ops** |
|-------|-----------|----------|-------------------|---------------|-----------------|
| `.workflows-executions` | 96.1M | 25.0% | **18,206s** | **48.8%** | **189.54s** |
| Event Logs | 265.9M | 69.4% | **15,316s** | **41.0%** | **57.60s** |
| Step Executions | 21.4M | 5.6% | **3,801s** | **10.2%** | **177.49s** |
| **TOTAL** | **383.4M** | **100%** | **37,323s** | **100%** | - |

### Critical Insight

**Executions index consumes MORE indexing time (48.8%) despite having FEWER operations (25.0%)**

This means:
- **Executions writes are 3.3x slower per operation** (0.19ms vs 0.06ms)
- **Executions are the actual bottleneck** (48.8% of total indexing time)
- **Event logs are more efficient** but have more operations

---

## Write Efficiency Comparison

### Per-Operation Efficiency

| Index | Avg Time/Op | Efficiency Rating |
|-------|-------------|-------------------|
| **Event Logs** | **0.06ms** | 🟢 **EXCELLENT** (3.3x faster) |
| Step Executions | 0.18ms | 🟢 EXCELLENT |
| Executions | 0.19ms | 🟢 EXCELLENT (but 3.3x slower than event logs) |

**Key Finding**: Event logs are **69.6% faster per operation** than executions index.

### Why Event Logs Are More Efficient

1. **Data Stream Architecture**:
   - Better write optimization
   - Automatic time-based distribution
   - More efficient indexing

2. **Smaller Documents**:
   - Event logs: 135.43 bytes/doc
   - Executions: 504.15 bytes/doc (3.7x larger)
   - Smaller docs = faster writes

3. **Write Pattern**:
   - Event logs: Mostly creates (1.00 ops/doc)
   - Executions: Frequent updates (1.64 ops/doc)
   - Updates are slower than creates

---

## Shard Efficiency Analysis

### Shard Configuration

| Index | Shards | Avg Shard Size | Max Shard | Min Shard | Imbalance | Status |
|-------|--------|---------------|-----------|-----------|-----------|--------|
| Executions | 2 | **13.75 GB** | 13.79 GB | 13.72 GB | 0.3% | ⚠️ **Too Large** |
| Step Executions | 2 | 8.93 GB | 8.94 GB | 8.92 GB | 0.1% | ✅ OK |
| Event Logs | 2 | 16.77 GB | 33.54 GB | 0 GB | **100%** | 🔴 **Critical** |

### Critical Issues

1. **Event Logs Shard Imbalance (100%)**:
   - One shard: 33.54 GB
   - One shard: 0 GB (unassigned!)
   - **All writes go to single shard** = bottleneck
   - **Unassigned shard** = potential recovery issue

2. **Executions Shard Size (13.75 GB)**:
   - Too large for optimal performance
   - Should be <10GB per shard ideally
   - Causes slower operations

3. **Shard Distribution**:
   - All indices: 2 shards across 2 nodes (good distribution)
   - BUT event logs has unassigned shard (bad!)

---

## Refresh Performance

| Index | Total Refreshes | Avg Refresh Time | Refresh Frequency |
|-------|----------------|------------------|-------------------|
| Executions | 909,528 | **76.19ms** | 47,250/hour |
| Step Executions | 82,384 | 57.86ms | 62,223/hour |
| Event Logs | 17,065 | 72.71ms | 49,510/hour |

### Key Finding

- **Executions has 53x more refreshes** than event logs (909K vs 17K)
- **Executions refresh time is longer** (76ms vs 73ms)
- **Executions refresh operations consume more time**: 69,298s vs 1,241s

**Impact**: Executions index refresh operations are a major contributor to memory pressure.

---

## Corrected Root Cause Analysis

### Primary Bottleneck: Executions Index (48.8% of indexing time)

**Why Executions Index is the Real Problem:**

1. **Slower Writes** (0.19ms vs 0.06ms per operation)
   - 3.3x slower than event logs
   - Despite having fewer operations, takes more total time

2. **Large Shards** (13.75 GB)
   - Slower operations
   - Higher memory pressure
   - Longer recovery time

3. **Frequent Refreshes** (909K refreshes)
   - 53x more refreshes than event logs
   - Each refresh takes 76ms
   - Total refresh time: 69,298s (vs 1,241s for event logs)

4. **Frequent Updates** (1.64 ops/doc)
   - Updates are slower than creates
   - More overhead per document

### Secondary Issue: Event Logs Volume (41.0% of indexing time)

**Why Event Logs Still Matter:**

1. **High Operation Count** (265.9M operations)
   - Even though efficient per operation
   - Still consumes 41% of indexing time

2. **Shard Imbalance** (100% imbalance)
   - One shard has all data (33.54 GB)
   - One shard is unassigned
   - All writes hit single shard = bottleneck

3. **Immediate Flushes** (per step)
   - Creates constant write stream
   - No batching = more operations

---

## Corrected Recommendations

### Priority 1: Fix Executions Index (48.8% of indexing time)

1. **Increase Shard Count** (Critical)
   - Current: 1 shard for 58M documents
   - Recommended: 3-5 shards
   - Impact: Distributes load, reduces shard size
   - **Requires reindexing**

2. **Increase Flush Interval** (Immediate)
   - Current: 500ms
   - Recommended: 2-5 seconds
   - Impact: Reduces refresh frequency by 75-90%
   - **No reindexing needed**

3. **Reduce Replicas** (Immediate)
   - Current: 1 replica
   - Recommended: 0 replicas
   - Impact: Halves write operations
   - **No reindexing needed**

### Priority 2: Fix Event Logs (41.0% of indexing time)

1. **Fix Shard Assignment** (Critical)
   - One shard is unassigned
   - All writes going to single shard
   - Impact: Major bottleneck
   - **Check cluster allocation settings**

2. **Batch Event Log Writes** (High Impact)
   - Current: Immediate per step
   - Recommended: Batch every 2-5 seconds
   - Impact: Reduces operation count by 60-80%
   - **Code change needed**

3. **Skip Logs for Skipped Workflows** (High Impact)
   - 95%+ workflows are skipped
   - Don't log skipped workflows
   - Impact: Reduces event log volume by 95%
   - **Code change needed**

### Priority 3: Optimize Step Executions (10.2% of indexing time)

1. **Already efficient** (0.18ms/op)
2. **Good shard size** (8.93 GB)
3. **Low priority** (only 10% of indexing time)

---

## Performance Metrics Summary

### Write Efficiency (Time per Operation)
```
Event Logs:      ██ 0.06ms/op (FASTEST - Data Stream advantage)
Step Executions: ████ 0.18ms/op
Executions:      █████ 0.19ms/op (SLOWEST - Large shards, updates)
```

### Total Resource Impact (Indexing Time)
```
Executions:      ████████████████████████████████████████ 48.8% (BOTTLENECK)
Event Logs:      ████████████████████████████████████ 41.0%
Step Executions: ████████ 10.2%
```

### Refresh Impact
```
Executions:      ████████████████████████████████████████ 69,298s (MAJOR)
Event Logs:      █ 1,241s
Step Executions: ███ 4,766s
```

---

## Corrected Conclusions

### The Real Problem

1. **Executions Index is the Primary Bottleneck** (48.8% of indexing time)
   - Slower writes (0.19ms vs 0.06ms)
   - Large shards (13.75 GB)
   - Excessive refreshes (909K, 76ms each)
   - Frequent updates (1.64 ops/doc)

2. **Event Logs Have Efficiency But Volume** (41.0% of indexing time)
   - Fast writes (0.06ms/op - 3.3x faster)
   - BUT high operation count (265.9M)
   - Shard imbalance (100% - all on one shard)
   - Immediate flushes (no batching)

3. **Not All Writes Are Equal**
   - Data streams are 69.6% faster per operation
   - But execution indices have worse efficiency
   - Total time matters more than operation count

### Why Memory Pressure Occurs

**Primary Cause**: Executions index
- Large shards (13.75 GB) = high memory for operations
- Frequent refreshes (909K) = constant memory pressure
- Slow writes (0.19ms) = longer operations = more memory held

**Secondary Cause**: Event logs volume
- High operation count (265.9M)
- Shard imbalance (all on one shard)
- Constant write stream (immediate flushes)

---

## Action Plan

### Immediate (This Week)
1. ✅ **Fix event logs shard assignment** (unassigned shard)
2. ✅ **Reduce replicas to 0** (halves all writes)
3. ✅ **Increase flush interval** (500ms → 2-5s)

### Short-term (This Month)
4. ✅ **Batch event log writes** (2-5s instead of immediate)
5. ✅ **Skip logs for skipped workflows** (95% reduction)
6. ✅ **Plan shard count increase** (requires reindexing)

### Long-term
7. ✅ **Reindex with more shards** (3-5 shards per index)
8. ✅ **Monitor shard distribution** (ensure balance)

---

*Corrected analysis based on actual performance metrics, not just operation counts*

