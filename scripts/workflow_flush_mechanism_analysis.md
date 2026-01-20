# Workflow Execution Write & Flush Mechanism Analysis

## Summary

**Workflow execution state and step executions are flushed every 500ms (time-based), NOT per step invocation/completion.**

---

## Flush Mechanism

### 1. **Time-Based Flush (Primary Mechanism)**

**Location**: `persistence_loop.ts`

```typescript
export const FLUSH_INTERVAL_MS = 500; // 0.5 seconds

export async function persistenceLoop(params, persistenceAbortSignal) {
  while (workflowStatus === RUNNING) {
    await flushState(params);  // Flush accumulated changes
    await wait(FLUSH_INTERVAL_MS);  // Wait 500ms
  }
}
```

**What gets flushed every 500ms:**
1. **Workflow execution changes** (via `workflowExecutionState.flush()`)
   - Updates to workflow execution document (status, currentNodeId, scopeStack, etc.)
   - Single update per workflow execution
   
2. **Step execution changes** (via `workflowExecutionState.flush()`)
   - All accumulated step execution updates
   - Bulk upsert of all changed step executions
   
3. **Event logs** (via `workflowLogger.flushEvents()`)
   - All accumulated log events

### 2. **State Updates (Accumulate, Don't Flush Immediately)**

**Location**: `workflow_execution_state.ts`

```typescript
// These methods ONLY update in-memory state
updateWorkflowExecution(changes) {
  // Accumulates changes in workflowDocumentChanges
  // Does NOT flush to Elasticsearch
}

upsertStep(step) {
  // Accumulates changes in stepDocumentsChanges
  // Does NOT flush to Elasticsearch
}
```

**Key Point**: State updates accumulate in memory and are only flushed every 500ms.

### 3. **Event Log Flushes (Per Step)**

**Location**: `node_implementation.ts`

```typescript
public async run(): Promise<void> {
  this.stepExecutionRuntime.startStep();
  await this.stepExecutionRuntime.flushEventLogs();  // Flush after step start
  
  // ... execute step ...
  
  await this.stepExecutionRuntime.flushEventLogs();  // Flush after step finish
}
```

**What this flushes:**
- Only event logs (not execution state or step executions)
- Happens per step (after start and finish)

### 4. **Final Flush (On Completion)**

**Location**: `workflow_execution_loop.ts`

```typescript
finally {
  await flushState(params);  // Final flush of all accumulated changes
}

await params.workflowRuntime.saveState();  // Save final state
await params.workflowExecutionState.flush();  // Final flush
await params.workflowLogger.flushEvents();  // Final log flush
```

---

## Write Pattern Analysis

### Scenario: Workflow with 10 Steps

**Timeline:**
```
T=0ms:   Workflow starts
         - Creates execution document (with refresh: 'wait_for')
         - Flushes immediately

T=100ms: Step 1 starts
         - Updates step execution in memory
         - Flushes event logs only

T=200ms: Step 1 completes
         - Updates step execution in memory
         - Flushes event logs only

T=300ms: Step 2 starts
         - Updates step execution in memory
         - Flushes event logs only

T=400ms: Step 2 completes
         - Updates step execution in memory
         - Flushes event logs only

T=500ms: **PERSISTENCE LOOP FLUSH**
         - Flushes workflow execution changes (if any)
         - Flushes ALL accumulated step execution changes (Step 1, Step 2)
         - Flushes all accumulated event logs

T=600ms: Step 3 starts
         - Updates step execution in memory
         - Flushes event logs only

T=700ms: Step 3 completes
         - Updates step execution in memory
         - Flushes event logs only

T=1000ms: **PERSISTENCE LOOP FLUSH**
          - Flushes workflow execution changes (if any)
          - Flushes ALL accumulated step execution changes (Step 3)
          - Flushes all accumulated event logs
```

### Key Observations

1. **Step executions accumulate** until the next 500ms flush
2. **Multiple steps can complete** between flushes
3. **Bulk operations** happen every 500ms (more efficient)
4. **Event logs flush twice per step** (immediate) + every 500ms

---

## Impact on Write Volume

### Current Behavior

**For a workflow with 10 steps that completes in 2 seconds:**

- **Workflow execution updates**: ~4 writes (every 500ms + final)
- **Step execution updates**: ~4 bulk writes (every 500ms + final)
  - Each bulk write contains multiple step executions
- **Event log writes**: ~20 writes (2 per step) + ~4 bulk writes (every 500ms)

**Total**: ~28 writes per workflow execution

### With 261K Executions/Hour Peak

- **Workflow execution writes**: 261K × 4 = **1,044,000 writes/hour**
- **Step execution writes**: 261K × 4 = **1,044,000 writes/hour** (bulk, but still operations)
- **Event log writes**: 261K × 24 = **6,264,000 writes/hour**

**Total**: ~8.3M writes/hour during peak = **2,300 writes/second**

### The Problem

1. **Every 500ms flush** happens for ALL running workflows simultaneously
2. **With 261K executions/hour**, many workflows are running concurrently
3. **All flush at the same time** (every 500ms) = massive write spike
4. **Replica doubles writes** = 4,600 operations/second during peaks

---

## Why This Causes Memory Pressure

### Write Amplification

1. **Time-based flushing** means all workflows flush together
2. **No staggering** = thundering herd effect
3. **Large bulk operations** every 500ms
4. **Replica writes** double the load

### Memory Pressure Points

1. **Refresh operations**: Every write triggers refresh (1s interval)
2. **Bulk operation buffers**: Large bulk upserts need memory
3. **Replica writes**: Network + memory for replica operations
4. **GC pressure**: Frequent allocations from writes

---

## Optimization Opportunities

### 1. **Increase Flush Interval** (Easiest)

**Current**: 500ms
**Recommended**: 2-5 seconds

**Impact**:
- Reduces flush frequency by 75-90%
- Fewer write spikes
- More batching (more efficient)

**Trade-off**:
- Slightly higher risk of data loss on crash
- Last 2-5 seconds of state might be lost

### 2. **Stagger Flush Times** (Complex)

**Idea**: Add random jitter to flush intervals per workflow

```typescript
// Instead of fixed 500ms
const FLUSH_INTERVAL_MS = 500 + Math.random() * 1000; // 500-1500ms
```

**Impact**:
- Spreads write load over time
- Reduces simultaneous flushes
- Less memory pressure spikes

### 3. **Conditional Flushing** (Smart)

**Idea**: Only flush if there are significant changes

```typescript
if (hasSignificantChanges()) {
  await flushState(params);
}
```

**Impact**:
- Skips unnecessary flushes
- Reduces write volume
- Still maintains data safety

### 4. **Reduce Replicas** (Immediate)

**Impact**:
- Halves write operations
- Reduces memory pressure
- Faster operations

---

## Recommendations

### Immediate (This Week)
1. ✅ **Increase FLUSH_INTERVAL_MS to 2000-5000ms**
2. ✅ **Reduce replicas to 0**

### Short-term (This Month)
3. ✅ **Add jitter to flush intervals** (stagger flushes)
4. ✅ **Implement conditional flushing** (only flush if changes)

### Long-term
5. ✅ **Review workflow scheduling** (stagger start times)
6. ✅ **Optimize step execution batching** (batch more aggressively)

---

## Code Changes Needed

### Change Flush Interval

**File**: `src/platform/plugins/shared/workflows_execution_engine/server/workflow_execution_loop/persistence_loop.ts`

```typescript
// Current
export const FLUSH_INTERVAL_MS = 500;

// Recommended
export const FLUSH_INTERVAL_MS = process.env.WORKFLOW_FLUSH_INTERVAL_MS 
  ? parseInt(process.env.WORKFLOW_FLUSH_INTERVAL_MS, 10)
  : 2000; // 2 seconds default
```

### Add Jitter (Optional)

```typescript
// Add random jitter to spread flushes
const JITTER_MS = 1000; // ±1 second
const FLUSH_INTERVAL_MS = 2000 + (Math.random() * JITTER_MS * 2 - JITTER_MS);
```

---

## Conclusion

**The flush mechanism is time-based (500ms), not event-based (per step).**

This means:
- ✅ More efficient (batching)
- ❌ Creates write spikes (all workflows flush together)
- ❌ Amplifies memory pressure during peaks
- ❌ Replica doubles the problem

**Primary fix**: Increase flush interval to 2-5 seconds to reduce write frequency by 75-90%.

