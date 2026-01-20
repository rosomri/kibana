# Problematic Indices During OOM Restart (Jan 18, 2026 00:06)

## Context: Node `instance-0000000001` OOM and Restart

**Event Time**: 00:06 on January 18, 2026  
**Trigger**: Massive scheduled workflow spike 11 minutes earlier (23:50-23:58)

---

## 🔴 PRIMARY PROBLEM: `.workflows-executions` Index

### At OOM Time (00:06):

| Metric | Value | Impact |
|--------|-------|--------|
| **Running Executions** | **661** | 🔴 **CRITICAL** |
| **Flushes per Second** | **331/sec** | 🔴 **CRITICAL** |
| **Operations/sec (with replicas)** | **~666/sec** | 🔴 **CRITICAL** |
| **New Executions** | 57 | Low (system overwhelmed) |

### Why This Index Caused the OOM:

1. **661 Running Executions**
   - All from the spike 11 minutes earlier (23:50-23:58)
   - Each execution flushes **every 500ms** while running
   - 661 executions × 2 flushes/sec = **1,322 flushes/second**

2. **Continuous Memory Pressure**
   - Each flush triggers:
     - Write operation to `.workflows-executions` index
     - Write operation to replica (doubles load)
     - Refresh operation (consumes memory)
   - **909,528 total refreshes** on this index (53x more than event logs)
   - Each refresh takes **76.19ms** on average

3. **Large Shard Size**
   - **13.75 GB per shard** on this index
   - Large shards require more memory per operation
   - Slower operations = memory held longer

4. **Accumulated Load**
   - Spike created 4,000-5,000 executions in 8 minutes
   - System stopped accepting new work (23:59-00:05)
   - 661 executions still running and flushing continuously
   - Memory pressure accumulated over 11 minutes until OOM

### Timeline Impact:

| Time | Executions | Running Executions | Impact |
|------|------------|-------------------|--------|
| **23:50-23:58** (Spike) | 4,000-5,000/min | ~4,000-5,000 | 🔴 Massive spike |
| **23:59-00:05** (Overwhelmed) | 0-5/min | ~661 | 🟡 System struggling |
| **00:06** (OOM) | 57 | **661** | 🔴 **OOM occurred** |
| **00:07+** (Recovery) | 183-422/min | Decreasing | 🟢 Recovery |

---

## 🟡 SECONDARY CONTRIBUTOR: `.workflows-execution-data-stream-logs` Index

### At OOM Time (00:06):

| Metric | Value | Impact |
|--------|-------|--------|
| **Event Logs** | **107 events** | Low (at OOM time) |
| **Peak (23:54)** | **52,872 events** | 🔴 Massive (12 min before OOM) |

### Why This Index Contributed:

1. **Peak During Spike (23:54)**
   - **52,872 events** at 23:54 (12 minutes before OOM)
   - Corresponds to execution spike (5,037 executions)
   - Each execution generates multiple event log entries
   - Immediate flushes (no batching) = constant write stream

2. **Shard Imbalance (Critical)**
   - **100% shard imbalance**
   - One shard: 33.54 GB (all data)
   - One shard: **UNASSIGNED** (0 GB)
   - All writes hit single shard = bottleneck

3. **Low at OOM Time But...**
   - Only 107 events at 00:06 (system was overwhelmed)
   - BUT: The spike 12 minutes earlier contributed to initial memory pressure
   - Shard imbalance means all writes go to one shard = ongoing bottleneck

### Timeline Impact:

| Time | Event Logs | Impact |
|------|------------|--------|
| **23:54** (Peak) | **52,872** | 🔴 Massive spike |
| **00:06** (OOM) | 107 | Low (system overwhelmed) |

---

## 🟢 MINOR CONTRIBUTOR: `.workflows-step-executions` Index

### At OOM Time (00:06):

| Metric | Value | Impact |
|--------|-------|--------|
| **Step Executions** | **2** | Very Low |
| **Peak (23:54)** | **3,819 steps** | Moderate (12 min before OOM) |

### Why This Index Was Less Problematic:

1. **Low at OOM Time**
   - Only 2 step executions at 00:06
   - System was overwhelmed, so step executions were minimal

2. **Efficient Writes**
   - 0.18ms per operation (efficient)
   - Good shard size (8.93 GB)
   - Bulk-upserted every 500ms (batched)

3. **Not the Bottleneck**
   - Only 10.2% of total indexing time
   - Not a major contributor to OOM

### Timeline Impact:

| Time | Step Executions | Impact |
|------|----------------|--------|
| **23:54** (Peak) | **3,819** | Moderate |
| **00:06** (OOM) | 2 | Very Low |

---

## Summary: Indices During OOM Restart

### Primary Culprit: `.workflows-executions`

**At OOM Time (00:06)**:
- ✅ **661 running executions** (all flushing every 500ms)
- ✅ **331 flushes/second** (with replicas: ~666 ops/sec)
- ✅ **Large shards** (13.75 GB) requiring more memory
- ✅ **Excessive refreshes** (909K total, 76ms each)
- ✅ **Memory pressure accumulated over 11 minutes**

**This index directly caused the OOM** because:
- 661 executions were still running from the spike
- All flushing simultaneously every 500ms
- Each flush triggers refresh operations
- Large shards require more memory per operation
- Memory gradually consumed until OOM

---

### Secondary Contributor: `.workflows-execution-data-stream-logs`

**During Spike (23:54)**:
- ✅ **52,872 events** (massive spike)
- ✅ **Shard imbalance** (100% - unassigned shard)
- ✅ **Immediate flushes** (no batching)

**At OOM Time (00:06)**:
- Only 107 events (system overwhelmed)
- BUT: Shard imbalance still causes bottleneck
- Spike 12 minutes earlier contributed to initial pressure

**This index contributed to the problem** because:
- Massive spike during execution surge
- Shard imbalance means all writes hit one shard
- Immediate flushes create constant write stream

---

### Minor Contributor: `.workflows-step-executions`

**At OOM Time (00:06)**:
- Only 2 step executions (very low)
- Not a major contributor

**This index was NOT a major problem** because:
- Low volume at OOM time
- Efficient writes (0.18ms/op)
- Good shard size (8.93 GB)
- Only 10.2% of indexing time

---

## Root Cause Chain

1. **23:50-23:58**: Scheduled workflow spike
   - 4,000-5,000 executions/minute
   - All writing to `.workflows-executions` index
   - Event logs spike: 52,872 events at 23:54

2. **23:59-00:05**: System overwhelmed
   - System stopped accepting new work
   - 661 executions still running
   - All flushing every 500ms to `.workflows-executions`

3. **00:06**: OOM Event
   - **661 running executions** still flushing
   - **331 flushes/second** to `.workflows-executions`
   - Each flush triggers refresh (memory pressure)
   - Large shards (13.75 GB) require more memory
   - **Node ran out of memory**

---

## Key Insight

**The OOM didn't happen during the spike, but 11 minutes later** when:
- 661 executions were still running (from the spike)
- All flushing every 500ms to `.workflows-executions` index
- Each flush triggers refresh operations
- Memory pressure accumulated gradually
- Node eventually ran out of memory

**Primary Problem**: `.workflows-executions` index with 661 running executions flushing every 500ms

**Secondary Problem**: `.workflows-execution-data-stream-logs` with shard imbalance and spike 12 minutes earlier

---

## Recommended Fixes (Priority Order)

### 1. Fix `.workflows-executions` (Primary Culprit)
- ✅ **Add jitter to scheduled workflows** (prevent spikes)
- ✅ **Increase flush interval** (500ms → 2-5s)
- ✅ **Reduce replicas to 0** (halves writes)
- ✅ **Increase shard count** (reduces shard size)

### 2. Fix `.workflows-execution-data-stream-logs` (Secondary)
- ✅ **Fix unassigned shard** (critical - check allocation)
- ✅ **Batch event log writes** (2-5s instead of immediate)
- ✅ **Skip logs for skipped workflows** (95% reduction)

### 3. Monitor `.workflows-step-executions` (Minor)
- ✅ No immediate action needed (already efficient)

---

*Analysis based on OOM event investigation at 00:06 on January 18, 2026*

