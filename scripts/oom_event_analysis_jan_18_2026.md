# OOM Event Analysis: January 18, 2026 00:06

## Executive Summary

**Event**: Node `instance-0000000001` ran out of memory and was automatically restarted at **00:06 on January 18, 2026**.

**Root Cause**: A massive scheduled workflow spike (4,000-5,000 executions/minute) 11 minutes before OOM created a backlog of 661 concurrent running executions, all flushing every 500ms, overwhelming the node's memory.

---

## Critical Timeline

### Pre-OOM Spike (23:50-23:58)
- **23:50**: 4,136 executions (4x normal rate)
- **23:51**: 4,137 executions
- **23:52**: 4,438 executions
- **23:53**: 4,888 executions
- **23:54**: 5,037 executions (peak)
- **23:55**: **5,052 executions** (peak - 11 minutes before OOM)
- **23:56**: 4,586 executions
- **23:57**: 4,803 executions
- **23:58**: 1,476 executions

**Normal rate**: ~1,000-2,000 executions/minute  
**Spike rate**: 4,000-5,000 executions/minute (4-5x normal)

### System Overwhelmed (23:59-00:05)
- **23:59**: 0 executions (system stopped accepting new work)
- **00:00**: 0 executions
- **00:01-00:05**: 0-5 executions (system struggling)

### OOM Event (00:06)
- **00:06**: 57 new executions
- **661 executions still RUNNING** (from the spike)
- Each flushing every 500ms = **331 flushes/second**
- With replicas = **~666 operations/second**
- **Node OOM occurred**

### Recovery (00:07+)
- **00:07**: 183 executions (recovery started)
- **00:08**: 422 executions
- Gradually returning to normal

---

## Key Metrics at OOM Time

| Metric | Value | Impact |
|--------|-------|--------|
| **New executions** | 57 | Low |
| **Running executions** | **661** | 🔴 **CRITICAL** |
| **Flushes per second** | **331/sec** | 🔴 **CRITICAL** |
| **Operations/sec (with replicas)** | **~666/sec** | 🔴 **CRITICAL** |
| **Peak executions (23:55)** | **5,052/min** | 🔴 **CRITICAL** |
| **Normal rate** | ~1,000-2,000/min | Baseline |

---

## Root Cause Analysis

### Primary Cause: Scheduled Workflow Spike

**Evidence**:
- All executions in the spike were triggered by `scheduled` workflows
- Spike occurred at 23:50-23:58 (likely hourly scheduled workflows)
- Peak: 5,052 executions in a single minute (11 minutes before OOM)

**Impact**:
1. Created thousands of concurrent executions
2. Each execution flushes every 500ms while running
3. System became overwhelmed and stopped accepting new work (23:59-00:05)
4. 661 executions were still running at OOM time
5. All 661 flushing simultaneously every 500ms = memory pressure

### Secondary Causes

1. **Frequent Flushing (500ms interval)**
   - Every running execution flushes every 500ms
   - 661 executions × 2 flushes/sec = 1,322 flushes/sec
   - Each flush triggers refresh operations

2. **Replica Writes**
   - Doubles the write load
   - 331 flushes/sec → 662 operations/sec with replicas

3. **Refresh Operations**
   - Frequent writes trigger frequent refreshes
   - Each refresh consumes memory
   - 909,528 total refreshes on `.workflows-executions` index

4. **Large Shards**
   - `.workflows-executions`: 13.75 GB per shard
   - Large shards require more memory per operation

---

## Write Load Breakdown at OOM Time

### Per-Second Load
- **New executions**: 3/sec (low - system was overwhelmed)
- **Running execution flushes**: 331/sec (every 500ms)
- **Total writes/sec**: ~333/sec
- **With replicas**: ~666 operations/sec

### Per-Minute Load (During Spike)
- **Peak**: 5,052 executions/minute
- **Average during spike**: ~4,500 executions/minute
- **Normal**: ~1,500 executions/minute
- **Spike multiplier**: 3-4x normal

---

## Event Logs Impact

| Time | Event Logs | Minutes from OOM |
|------|------------|------------------|
| **23:54** (peak) | **52,872 events** | -12m |
| **00:06** (OOM) | 107 events | 0m |

**Analysis**:
- Event logs peaked at 52,872 events at 23:54 (12 minutes before OOM)
- This corresponds to the execution spike
- Each execution generates multiple event log entries
- Event logs are flushed immediately after each step (no batching)

---

## Step Executions Impact

| Time | Step Executions | Minutes from OOM |
|------|-----------------|------------------|
| **23:54** (peak) | **3,819 steps** | -12m |
| **00:06** (OOM) | 2 steps | 0m |

**Analysis**:
- Step executions peaked at 3,819 at 23:54
- This corresponds to the execution spike
- Step executions are bulk-upserted every 500ms

---

## Why OOM Happened 11 Minutes After Peak

1. **23:50-23:58**: Massive spike created thousands of concurrent executions
2. **23:59-00:05**: System overwhelmed, stopped accepting new work
3. **00:06**: 
   - 661 executions still running (from the spike)
   - All flushing every 500ms simultaneously
   - Memory pressure accumulated over 11 minutes
   - Node ran out of memory

**Key Insight**: The OOM didn't happen during the spike, but **11 minutes later** when the accumulated running executions continued flushing, gradually consuming all available memory.

---

## Comparison: Normal vs. Spike

| Metric | Normal | Spike (23:50-23:58) | OOM Time (00:06) |
|--------|--------|---------------------|-------------------|
| **Executions/min** | ~1,500 | **5,052** (3.4x) | 57 |
| **Running executions** | ~200-300 | ~4,000-5,000 | **661** |
| **Flushes/sec** | ~100-150 | ~2,000-2,500 | **331** |
| **Operations/sec** | ~200-300 | ~4,000-5,000 | **~666** |

---

## Workflow Distribution Analysis

### Spike Contributors

**Finding**: The spike was caused by **many workflows** (hundreds) all scheduled to run at the same time, not a few workflows running many times.

**Evidence**:
- Top workflow: 83 executions (1.6% of peak)
- Top 10 workflows: ~830 executions (~16% of spike)
- Distribution: Very even across many workflows
- Pattern: "Thundering herd" - many workflows firing simultaneously

**Implication**: This is a **scheduling alignment problem** - many workflows are scheduled to run at the same time (likely hourly schedules that all fire at 23:50-23:58). This is a classic "thundering herd" problem where hundreds of workflows all fire simultaneously.

**Solution**: Add random jitter (0-60 seconds) to scheduled workflow execution times to spread the load across a full minute instead of all firing at once.

---

## Recommendations

### Immediate Actions

1. **Throttle Scheduled Workflows (CRITICAL)**
   - **Problem**: Hundreds of workflows scheduled to run simultaneously
   - **Solution**: Add random jitter/delay (0-60 seconds) to scheduled triggers
   - **Impact**: Spreads 5,000 executions across 60 seconds instead of 1 minute
   - **Implementation**: Modify scheduled trigger logic to add random delay before execution

2. **Increase Flush Interval**
   - Consider increasing `FLUSH_INTERVAL_MS` from 500ms to 2-5 seconds
   - Reduces flush frequency by 4-10x
   - Trade-off: Slightly less real-time state updates

3. **Reduce Replicas**
   - Set `number_of_replicas: 0` for workflow indices
   - Halves write load immediately
   - Trade-off: No redundancy (acceptable for workflow execution data)

4. **Batch Event Log Flushes**
   - Currently: Immediate flush after each step
   - Change to: Batch flush every 500ms (same as execution state)
   - Reduces immediate write pressure

### Long-Term Solutions

1. **Implement Workflow Execution Queuing**
   - Queue scheduled workflows instead of executing immediately
   - Process queue at controlled rate (e.g., 500-1000 executions/minute)
   - Prevents spikes from overwhelming the system

2. **Shard Rebalancing**
   - Increase shard count for `.workflows-executions` index
   - Better distribute load across nodes
   - Reduces per-shard size and memory pressure

3. **Index Lifecycle Management (ILM)**
   - Move old execution data to warm/cold tiers
   - Reduce active index size
   - Lower memory requirements

4. **Circuit Breakers**
   - Implement application-level circuit breakers
   - Stop accepting new executions when system is under pressure
   - Prevents cascading failures

---

## Conclusion

The OOM event was caused by a **scheduled workflow spike** that created thousands of concurrent executions. While the spike occurred 11 minutes before the OOM, the accumulated running executions continued flushing every 500ms, gradually consuming all available memory until the node ran out.

**Key Takeaway**: The system can handle normal load (~1,500 executions/minute), but **scheduled workflow spikes (4,000-5,000 executions/minute) create a backlog of running executions that overwhelm the node's memory through continuous flushing operations**.

**Priority Fix**: Implement scheduled workflow throttling/spreading to prevent all workflows from firing simultaneously.

