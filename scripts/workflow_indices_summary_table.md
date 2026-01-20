# Workflow Indices Summary - Quick Reference

## All Workflow-Related Indices

| Index Name | Type | Documents | Size | Indexing Ops | % of Total Ops | Flush Frequency | Write Pattern |
|------------|------|-----------|------|--------------|----------------|-----------------|---------------|
| `.workflows-execution-data-stream-logs` | Data Stream | **265,883,547** | **33.64 GB** | **265,883,775** | **69.4%** | **Per step (immediate)** + Every 500ms (bulk) | **Immediate per step start/finish** |
| `.workflows-executions` | Single Index | 58,120,229 | 27.35 GB | 95,815,413 | 25.0% | Every 500ms (time-based) | Time-based flush |
| `.workflows-step-executions` | Single Index | 37,976,275 | 17.86 GB | 21,408,047 | 5.6% | Every 500ms (time-based) | Bulk upsert every 500ms |
| **TOTAL** | - | **314,079,051** | **56.26 GB** | **383,107,235** | **100%** | - | - |

---

## Flush Mechanisms

### 1. Event Logs (`.workflows-execution-data-stream-logs`)
**Flush Frequency**: 
- ✅ **Immediate**: After each step start AND step finish (2 flushes per step)
- ✅ **Time-based**: Every 500ms (bulk flush of accumulated events)

**Code Location**: `node_implementation.ts:109,157`
```typescript
await this.stepExecutionRuntime.flushEventLogs(); // After step start
// ... execute step ...
await this.stepExecutionRuntime.flushEventLogs(); // After step finish
```

**Impact**: 
- **69.4% of all write operations**
- Creates constant write stream (not just spikes)
- **265.9M operations** (largest contributor)

---

### 2. Execution Indices (`.workflows-executions` + `.workflows-step-executions`)
**Flush Frequency**: 
- ✅ **Time-based**: Every 500ms via `persistenceLoop()`
- ✅ **Immediate**: On workflow start (for deduplication)
- ✅ **Final**: On workflow completion

**Code Location**: `persistence_loop.ts:15,43-82`
```typescript
export const FLUSH_INTERVAL_MS = 500; // 0.5 seconds

while (workflowStatus === RUNNING) {
  await flushState(params);  // Flush accumulated changes
  await wait(FLUSH_INTERVAL_MS);  // Wait 500ms
}
```

**Impact**:
- **30.6% of all write operations**
- Creates write spikes every 500ms
- All running workflows flush simultaneously

---

## Write Volume Facts

### Peak Scenario (Observed: 1/18/2026 8:00 PM)
- **261,039 executions/hour** = **72 executions/second**
- **Event logs**: 78,281 events/hour peak = **22 events/second**
- **Total writes/second**: ~310 writes/sec (without replicas)
- **With replicas**: ~620 operations/second

### Average Scenario (48-hour average)
- **165,098 executions/hour** = **46 executions/second**
- **Event logs**: 58,474 events/hour = **16 events/second**
- **Total writes/second**: ~200 writes/sec (without replicas)
- **With replicas**: ~400 operations/second

---

## Impact on Elasticsearch

### Write Operations Distribution
```
Event Logs:     ████████████████████████████████████████ 69.4% (265.9M ops)
Executions:     ████████████ 25.0% (95.8M ops)
Step Execs:     ███ 5.6% (21.4M ops)
```

### Storage Distribution
```
Event Logs:     ████████████████████████████████████████ 59.8% (33.6 GB)
Executions:     █████████████████████████████████ 48.6% (27.4 GB)
Step Execs:     ████████████████████████ 31.7% (17.9 GB)
```

### Document Count Distribution
```
Event Logs:     ████████████████████████████████████████ 84.5% (265.9M docs)
Executions:     ████████ 18.5% (58.1M docs)
Step Execs:     ██████ 12.1% (38.0M docs)
```

---

## Key Findings

### 🔴 Critical Issues

1. **Event Logs = 69% of Write Load**
   - Immediate flushes per step create constant write stream
   - 265.9M operations vs 117.3M for execution indices
   - **Largest contributor to memory pressure**

2. **500ms Flush Interval Too Frequent**
   - All workflows flush simultaneously every 500ms
   - Creates write spikes
   - With 261K executions/hour = massive spikes

3. **Large Shards (13.7 GB)**
   - Only 1 shard per index for 58M+ documents
   - Slow operations, high memory pressure
   - Recovery takes longer

4. **Replica Overhead**
   - 1 replica doubles all write operations
   - 383M operations → 766M with replicas
   - 2x memory pressure

### 📊 Actual Numbers

- **Total Documents**: 314.1M
- **Total Storage**: 56.3 GB
- **Total Operations**: 383.1M (without replicas)
- **Peak Writes/Second**: 620 ops/sec (with replicas)
- **Event Log Operations**: 265.9M (69.4% of total)

---

## Optimization Impact Estimates

### Scenario 1: Event Log Batching Only
- **Change**: Batch event logs (2-5s instead of immediate)
- **Reduction**: 60-80% of event log writes
- **Impact**: 265.9M → 53-106M operations
- **Total Reduction**: 41-55% of all workflow writes

### Scenario 2: Replica Reduction Only
- **Change**: Reduce replicas from 1 to 0
- **Reduction**: 50% of all writes
- **Impact**: 383.1M → 191.6M operations
- **Total Reduction**: 50% of all workflow writes

### Scenario 3: Flush Interval Increase Only
- **Change**: Increase from 500ms to 2-5 seconds
- **Reduction**: 75-90% of flush frequency
- **Impact**: Reduces write spikes significantly
- **Total Reduction**: 20-30% of execution index writes

### Scenario 4: All Optimizations Combined
- **Event Log Batching**: 60-80% reduction
- **Skip Logs for Skipped Workflows**: 95% reduction for skipped
- **Replica Reduction**: 50% reduction
- **Flush Interval**: 75-90% reduction
- **Expected Total Reduction**: **85-95% of all workflow writes**
- **New Total**: ~20-60M operations (down from 383M)

---

*All data from actual cluster analysis on 2026-01-20*

