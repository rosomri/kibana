# Elasticsearch Cluster Resilience Guide
## Preventing JVM Memory Pressure from Node Departures

Based on the investigation of cluster `9a1c862d4fcb4acca037c5f0f9f86702`, here are preventive measures to avoid JVM memory pressure issues.

## Root Cause Summary
- Node departure triggered 645 replica shard recoveries
- Only 2 data nodes handling all recovery work
- Memory pressure from concurrent shard recoveries, segment merging, and cache building
- Small heap size (1.77GB) relative to workload

---

## 1. Cluster Configuration Improvements

### A. Recovery Throttling Settings

**Current Issue**: Too many concurrent recoveries overwhelming nodes

**Recommended Settings**:
```json
PUT /_cluster/settings
{
  "persistent": {
    "cluster.routing.allocation.node_concurrent_recoveries": "2",
    "cluster.routing.allocation.node_concurrent_incoming_recoveries": "2",
    "cluster.routing.allocation.node_concurrent_outgoing_recoveries": "2",
    "cluster.routing.allocation.cluster_concurrent_rebalance": "2",
    "indices.recovery.max_bytes_per_sec": "50mb"
  }
}
```

**Explanation**:
- `node_concurrent_recoveries`: Limits total recoveries per node (default: 2)
- `node_concurrent_incoming_recoveries`: Limits incoming recoveries (default: 2)
- `node_concurrent_outgoing_recoveries`: Limits outgoing recoveries (default: 2)
- `cluster_concurrent_rebalance`: Limits cluster-wide rebalancing (default: 2)
- `max_bytes_per_sec`: Throttles recovery speed to reduce memory pressure

**For High-Memory Nodes**: Can increase to 3-4, but monitor memory usage

### B. Circuit Breaker Settings

**Current Issue**: Circuit breakers may not be tuned for recovery scenarios

**Recommended Settings**:
```json
PUT /_cluster/settings
{
  "persistent": {
    "indices.breaker.total.limit": "95%",
    "indices.breaker.total.use_real_memory": true,
    "indices.breaker.fielddata.limit": "40%",
    "indices.breaker.request.limit": "60%",
    "network.breaker.inflight_requests.limit": "100%",
    "network.breaker.inflight_requests.overhead": "2.0"
  }
}
```

**Explanation**:
- `total.limit`: Overall memory limit (keep at 95%)
- `use_real_memory`: Use actual memory instead of heap (recommended)
- `fielddata.limit`: Field data cache limit (40% is safe)
- `request.limit`: Per-request limit (60% prevents single query overload)

### C. Index Settings - Replica Management

**Current Issue**: 645 indices with replicas, all needing recovery

**Recommended Actions**:

1. **Review Replica Count**:
```json
# For indices that don't need high availability
PUT /_settings
{
  "index.number_of_replicas": 0
}

# For critical indices, keep replicas but ensure adequate nodes
PUT /critical-index/_settings
{
  "index.number_of_replicas": 1
}
```

2. **Use Index Templates**:
```json
PUT /_index_template/default_template
{
  "index_patterns": ["*"],
  "template": {
    "settings": {
      "index.number_of_replicas": 0,
      "index.refresh_interval": "30s",
      "index.translog.durability": "async",
      "index.translog.sync_interval": "5s"
    }
  }
}
```

3. **Auto-Expand Replicas** (for dynamic scaling):
```json
PUT /_settings
{
  "index.auto_expand_replicas": "0-all"
}
```

---

## 2. Infrastructure Improvements

### A. Increase Heap Size

**Current**: 1.77GB per data node  
**Recommended**: 
- Minimum: 4GB for data nodes
- Optimal: 8-16GB (but not more than 50% of RAM, max 32GB)
- Follow the "50% rule": Heap should be ~50% of available RAM

**Cloud Configuration**:
- Upgrade instance type to have more RAM
- Ensure heap is properly sized (typically 50% of instance RAM)

### B. Add More Data Nodes

**Current**: 2 data nodes  
**Recommended**: 
- Minimum: 3 data nodes for production
- Optimal: 4-6 data nodes for better distribution

**Benefits**:
- Distributes recovery load across more nodes
- Reduces "thundering herd" effect
- Better fault tolerance (can lose 1 node without impact)

### C. Separate Master and Data Nodes

**Current**: Data nodes also serve as master-eligible  
**Recommended**: 
- Dedicated master nodes (3 nodes, voting-only)
- Data nodes without master role
- Better isolation and stability

---

## 3. Monitoring and Alerting

### A. Key Metrics to Monitor

1. **JVM Memory Pressure**:
   - Alert when heap usage > 75%
   - Alert when heap usage > 90% (critical)

2. **Circuit Breaker Trips**:
   - Alert on any circuit breaker trip
   - Monitor breaker usage percentage

3. **Shard Recovery**:
   - Alert when unassigned shards > 10
   - Alert when recovery time > 1 hour
   - Monitor active recoveries count

4. **GC Metrics**:
   - Alert when GC pause time > 500ms
   - Alert when GC frequency > 1000/min
   - Monitor old GC collections

5. **Node Health**:
   - Alert on node departures
   - Monitor node disk usage (>85%)
   - Monitor node CPU usage

### B. Elastic Cloud Monitoring

If using Elastic Cloud, set up:
- Stack Monitoring (built-in)
- Custom alerts via Kibana Alerting
- Cloud monitoring dashboards

### C. Example Alert Queries

```json
# Alert: High JVM Memory Pressure
GET /_nodes/stats/jvm?human
# Filter: jvm.mem.heap_used_percent > 85

# Alert: Circuit Breaker Trips
GET /_nodes/stats/breaker?human
# Filter: breakers.*.tripped > 0

# Alert: Unassigned Shards
GET /_cluster/health
# Filter: unassigned_shards > 10
```

---

## 4. Operational Best Practices

### A. Pre-Maintenance Checklist

Before any maintenance that might cause node restarts:

1. **Check Cluster Health**:
   ```bash
   GET /_cluster/health
   # Ensure status is green or yellow
   ```

2. **Review Unassigned Shards**:
   ```bash
   GET /_cluster/health?level=shards
   # Ensure no unassigned shards
   ```

3. **Check Disk Space**:
   ```bash
   GET /_nodes/stats/fs?human
   # Ensure >20% free on all nodes
   ```

4. **Temporarily Reduce Replicas** (if needed):
   ```bash
   PUT /_settings
   {
     "index.number_of_replicas": 0
   }
   ```

5. **Wait for Recovery** (after maintenance):
   ```bash
   # Monitor until all shards allocated
   GET /_cluster/health?wait_for_status=green&timeout=30m
   ```

### B. Gradual Node Replacement

When replacing nodes:

1. Add new node first
2. Wait for cluster to stabilize
3. Remove old node gracefully
4. Monitor recovery progress

### C. Index Lifecycle Management

Use ILM to:
- Automatically manage replica counts
- Delete old indices
- Optimize index settings
- Reduce cluster load

```json
PUT /_ilm/policy/optimized-policy
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
```

---

## 5. Emergency Response Procedures

### A. If Memory Pressure Occurs

1. **Immediate Actions**:
   ```bash
   # Throttle recoveries
   PUT /_cluster/settings
   {
     "transient": {
       "cluster.routing.allocation.node_concurrent_recoveries": "1",
       "indices.recovery.max_bytes_per_sec": "10mb"
     }
   }
   ```

2. **Reduce Replica Count** (temporary):
   ```bash
   PUT /_settings
   {
     "index.number_of_replicas": 0
   }
   ```

3. **Clear Caches** (if safe):
   ```bash
   POST /_cache/clear
   ```

4. **Force Allocation** (if shards stuck):
   ```bash
   POST /_cluster/reroute
   {
     "commands": [
       {
         "allocate_replica": {
           "index": "index-name",
           "shard": 0,
           "node": "node-name"
         }
       }
     ]
   }
   ```

### B. If Node Fails

1. **Check Node Status**:
   ```bash
   GET /_nodes
   ```

2. **Review Unassigned Shards**:
   ```bash
   GET /_cluster/allocation/explain
   ```

3. **Monitor Recovery**:
   ```bash
   GET /_recovery?active_only=true
   ```

4. **Scale Up** (if needed):
   - Add temporary nodes
   - Increase instance sizes
   - Distribute load

---

## 6. Configuration Validation Script

Run this periodically to validate cluster configuration:

```bash
# Check recovery settings
GET /_cluster/settings?include_defaults=true&filter_path=*.routing.allocation*

# Check circuit breakers
GET /_cluster/settings?include_defaults=true&filter_path=*.breaker*

# Check node resources
GET /_nodes/stats/jvm,fs,process?human

# Check shard distribution
GET /_cat/shards?v&h=index,shard,prirep,state,node,unassigned.reason
```

---

## 7. Recommended Cloud Instance Sizes

Based on your current workload (645 indices, ~64GB total data):

**Minimum Production Setup**:
- 3 data nodes: 8GB RAM, 4GB heap each
- 3 master nodes: 2GB RAM, 1GB heap each
- Total: ~30GB RAM cluster

**Optimal Setup**:
- 4-6 data nodes: 16GB RAM, 8GB heap each
- 3 master nodes: 4GB RAM, 2GB heap each
- Total: ~70-100GB RAM cluster

**Current Setup Issues**:
- Only 2 data nodes (insufficient redundancy)
- 1.77GB heap (too small for recovery workload)
- Master and data roles combined (less isolation)

---

## 8. Summary Checklist

- [ ] Increase heap size to 4-8GB per data node
- [ ] Add at least 1 more data node (minimum 3 total)
- [ ] Configure recovery throttling settings
- [ ] Review and optimize replica counts
- [ ] Set up monitoring and alerts
- [ ] Document node maintenance procedures
- [ ] Test node failure scenarios
- [ ] Review and optimize index settings
- [ ] Implement ILM policies
- [ ] Create runbooks for common scenarios

---

## Next Steps

1. **Immediate** (This Week):
   - Review and apply recovery throttling settings
   - Set up basic monitoring alerts
   - Document current cluster state

2. **Short-term** (This Month):
   - Plan infrastructure upgrades (more nodes, larger instances)
   - Optimize replica counts
   - Implement ILM policies

3. **Long-term** (This Quarter):
   - Separate master and data nodes
   - Implement comprehensive monitoring
   - Create disaster recovery procedures
   - Regular cluster health reviews

---

*Generated based on investigation of cluster: 9a1c862d4fcb4acca037c5f0f9f86702*  
*Date: 2026-01-19*

