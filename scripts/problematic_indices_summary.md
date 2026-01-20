# Problematic Workflow Indices Summary

## 🔴 PRIMARY PROBLEM: `.workflows-executions`

**Impact**: **48.8% of total indexing time** (18,206 seconds)

### Why It's Problematic:

1. **Slow Write Performance**
   - **0.19ms per operation** (3.3x slower than event logs)
   - Despite having only 25% of operations, consumes 48.8% of indexing time
   - **96.1M operations** total

2. **Excessive Refresh Operations**
   - **909,528 refreshes** (53x more than event logs)
   - **76.19ms average refresh time**
   - **69,298 seconds total refresh time** (vs 1,241s for event logs)
   - Constant memory pressure from frequent refreshes

3. **Large Shard Size**
   - **13.75 GB per shard** (too large for optimal performance)
   - Should be <10GB ideally
   - Slower operations, higher memory requirements

4. **Frequent Updates**
   - **1.64 operations per document** (frequent updates)
   - Updates are slower than creates
   - More overhead per document

5. **High Write Frequency**
   - Flushes every **500ms** for all running executions
   - During OOM: 661 running executions = 331 flushes/second
   - With replicas: ~662 operations/second

### Metrics:
- **Documents**: 58.6M
- **Size**: 27.5 GB
- **Operations**: 96.1M
- **Indexing Time**: 18,206s (48.8% of total)
- **Time per Operation**: 0.19ms
- **Refreshes**: 909,528
- **Shard Size**: 13.75 GB (⚠️ Too large)

---

## 🟡 SECONDARY PROBLEM: `.workflows-execution-data-stream-logs`

**Impact**: **41.0% of total indexing time** (15,316 seconds)

### Why It's Problematic:

1. **Critical Shard Imbalance** 🔴
   - **100% shard imbalance**
   - One shard: **33.54 GB** (all data)
   - One shard: **0 GB (UNASSIGNED!)** 
   - **All writes hit single shard** = major bottleneck
   - Unassigned shard = potential recovery issue

2. **Very High Operation Count**
   - **265.9M operations** (69.4% of all operations)
   - Even though efficient per operation, volume is massive
   - Consumes 41% of indexing time despite being 3.3x faster per op

3. **Immediate Flush Pattern**
   - Flushes **immediately** after each step start AND finish
   - No batching = constant write stream
   - Creates write pressure spikes

4. **High Document Volume**
   - **265.9M documents** (largest by count)
   - **33.5 GB total size** (largest by size)
   - 135.43 bytes per document

### Metrics:
- **Documents**: 265.9M
- **Size**: 33.5 GB
- **Operations**: 265.9M
- **Indexing Time**: 15,316s (41.0% of total)
- **Time per Operation**: 0.06ms (✅ Efficient, but volume is the problem)
- **Refreshes**: 17,065 (✅ Much lower than executions)
- **Shard Imbalance**: 100% (🔴 CRITICAL - unassigned shard)

### Why It's Not the Primary Problem:
- **Efficient writes** (0.06ms vs 0.19ms for executions)
- **Fewer refreshes** (17K vs 909K for executions)
- BUT: **Shard imbalance is critical** and needs immediate attention

---

## 🟢 MINOR ISSUE: `.workflows-step-executions`

**Impact**: **10.2% of total indexing time** (3,801 seconds)

### Status: ✅ Not a Major Problem

**Why It's Less Problematic:**
- **Efficient writes** (0.18ms per operation)
- **Good shard size** (8.93 GB - acceptable)
- **Low refresh count** (82,384 - reasonable)
- **Only 10.2% of indexing time** (minor contributor)

### Metrics:
- **Documents**: 38.0M
- **Size**: 17.9 GB
- **Operations**: 21.4M
- **Indexing Time**: 3,801s (10.2% of total)
- **Time per Operation**: 0.18ms
- **Refreshes**: 82,384
- **Shard Size**: 8.93 GB (✅ Good)

---

## Summary Table: Problem Ranking

| Rank | Index | % of Time | Primary Issues | Severity |
|------|-------|-----------|----------------|----------|
| **1** | `.workflows-executions` | **48.8%** | Slow writes, excessive refreshes, large shards | 🔴 **CRITICAL** |
| **2** | `.workflows-execution-data-stream-logs` | **41.0%** | Shard imbalance (unassigned), high volume | 🟡 **HIGH** |
| **3** | `.workflows-step-executions` | **10.2%** | None significant | 🟢 **LOW** |

---

## Critical Issues by Index

### `.workflows-executions` (🔴 CRITICAL)
1. ✅ **Excessive refreshes** (909K vs 17K for event logs)
2. ✅ **Large shards** (13.75 GB - should be <10GB)
3. ✅ **Slow writes** (0.19ms - 3.3x slower than event logs)
4. ✅ **Frequent updates** (1.64 ops/doc)

### `.workflows-execution-data-stream-logs` (🟡 HIGH)
1. ✅ **Shard imbalance** (100% - one shard unassigned) 🔴
2. ✅ **High operation volume** (265.9M operations)
3. ✅ **Immediate flushes** (no batching)

### `.workflows-step-executions` (🟢 LOW)
- No critical issues identified

---

## Recommended Fix Priority

### Priority 1: Fix `.workflows-executions` (48.8% impact)
1. **Increase flush interval** (500ms → 2-5s) - Reduces refreshes by 75-90%
2. **Reduce replicas to 0** - Halves write operations immediately
3. **Increase shard count** (requires reindexing) - Reduces shard size

### Priority 2: Fix `.workflows-execution-data-stream-logs` (41.0% impact)
1. **Fix unassigned shard** (CRITICAL) - Check cluster allocation
2. **Batch event log writes** (2-5s instead of immediate) - Reduces operation count
3. **Skip logs for skipped workflows** - 95% reduction in volume

### Priority 3: Monitor `.workflows-step-executions` (10.2% impact)
- No immediate action needed (already efficient)

---

## Root Cause of OOM Event

**Primary Contributor**: `.workflows-executions` index
- 661 running executions at OOM time
- All flushing every 500ms = 331 flushes/second
- Each flush triggers refresh operations
- Large shards (13.75 GB) require more memory per operation
- Excessive refreshes (909K total) create constant memory pressure

**Secondary Contributor**: `.workflows-execution-data-stream-logs` index
- High operation volume (265.9M operations)
- Shard imbalance (all writes to single shard)
- Immediate flushes create constant write stream

---

*Analysis based on actual performance metrics from cluster investigation*

