# Summary: JVM Memory Pressure Issue

## What We Found

### Root Cause (One-Time Event)
- **Node departure** triggered 645 replica shard recoveries
- Only 2 data nodes handling all recovery work
- Memory pressure from concurrent shard recoveries, segment merging, and cache building
- Small heap size (1.77GB) relative to workload

### Current State
- **52.3M workflow execution documents** (26GB)
- **37.8M step execution documents** (18GB)
- **92.7M indexing operations** on executions index
- **High write volume** from frequent workflow state flushes (every 0.5s)

---

## The Recurring Issue (Twice Daily)

If JVM memory pressure happens **twice a day**, this suggests a **recurring pattern**, not just one-time node failures.

### Possible Causes

#### 1. **Scheduled Workflows Running at Specific Times**
- Many workflows scheduled to run at the same time (e.g., 9 AM, 5 PM)
- All workflows start simultaneously
- Each workflow:
  - Creates execution document
  - Flushes state every 0.5 seconds
  - Creates multiple step execution documents
  - Generates execution logs
- **Thundering herd effect**: Hundreds/thousands of workflows starting at once

#### 2. **Periodic Data Operations**
- Large batch queries running twice daily
- Aggregations across 52M+ documents
- Field data cache building
- Memory spikes during these operations

#### 3. **Index Refresh Bursts**
- Default refresh interval (1s) causes frequent refreshes
- With high write volume, refresh operations consume memory
- If writes spike twice daily, refresh operations spike too

#### 4. **Garbage Collection Patterns**
- GC runs more frequently under load
- Long GC pauses during high write periods
- Memory not reclaimed fast enough

#### 5. **Concurrent Workflow Executions**
- Many workflows running simultaneously
- Each workflow updates its execution document frequently
- Bulk operations competing for memory

---

## What We Need to Investigate

1. **When exactly does it happen?** (specific times)
2. **What's running at those times?** (scheduled workflows, batch jobs, etc.)
3. **How many workflows execute simultaneously?**
4. **What's the write rate during those periods?**
5. **Are there specific workflows that cause the spike?**

