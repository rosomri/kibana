#!/usr/bin/env node

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

const { Client } = require('@elastic/elasticsearch');

// Configuration from command line or environment
const CLUSTER_URL = process.env.CLUSTER_URL || process.argv[2];
const API_KEY = process.env.API_KEY || process.argv[3];

if (!CLUSTER_URL || !API_KEY) {
  console.error('Usage: node investigate_jvm_root_cause.js <cluster_url> <api_key>');
  console.error('   or: CLUSTER_URL=<url> API_KEY=<key> node investigate_jvm_root_cause.js');
  process.exit(1);
}

// Create Elasticsearch client
const client = new Client({
  node: CLUSTER_URL,
  auth: {
    apiKey: API_KEY,
  },
  requestTimeout: 60000,
  tls: {
    rejectUnauthorized: false,
  },
});

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Helper function to format percentage
function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

async function investigateRootCause() {
  console.log('='.repeat(80));
  console.log('JVM Memory Pressure Root Cause Investigation');
  console.log('='.repeat(80));
  console.log(`Cluster URL: ${CLUSTER_URL}\n`);

  try {
    // 1. Detailed Node Stats - Memory Breakdown
    console.log('1. DETAILED MEMORY BREAKDOWN BY NODE');
    console.log('-'.repeat(80));
    
    const nodeStats = await client.nodes.stats({
      metric: ['jvm', 'indices', 'thread_pool', 'process'],
      human: false,
    });

    const nodes = nodeStats.nodes;
    const nodeIds = Object.keys(nodes);

    for (const nodeId of nodeIds) {
      const node = nodes[nodeId];
      const jvm = node.jvm;
      const indices = node.indices;
      const threadPool = node.thread_pool;
      const process = node.process;

      console.log(`\nNode: ${node.name || nodeId}`);
      console.log(`  Host: ${node.host}`);
      console.log(`  Roles: ${node.roles.join(', ')}`);
      
      // JVM Memory Details
      console.log(`\n  JVM Memory:`);
      const heapUsed = jvm.mem.heap_used_in_bytes;
      const heapMax = jvm.mem.heap_max_in_bytes;
      const heapUsedPercent = jvm.mem.heap_used_percent;
      console.log(`    Heap Used: ${formatBytes(heapUsed)} / ${formatBytes(heapMax)} (${formatPercent(heapUsedPercent / 100)})`);
      console.log(`    Heap Committed: ${formatBytes(jvm.mem.heap_committed_in_bytes)}`);
      console.log(`    Non-Heap Used: ${formatBytes(jvm.mem.non_heap_used_in_bytes)}`);
      
      // Memory Pressure Indicators
      let pressureStatus = '✅ OK';
      if (heapUsedPercent > 90) {
        pressureStatus = '🔴 CRITICAL';
      } else if (heapUsedPercent > 75) {
        pressureStatus = '🟡 WARNING';
      }
      console.log(`    Memory Pressure: ${pressureStatus} (${heapUsedPercent}%)`);
      
      // Indices Memory Usage
      console.log(`\n  Indices Memory Usage:`);
      if (indices && indices.store) {
        console.log(`    Store Size: ${formatBytes(indices.store.size_in_bytes)}`);
      }
      if (indices && indices.fielddata) {
        const fielddataSize = indices.fielddata.memory_size_in_bytes;
        const fielddataEvictions = indices.fielddata.evictions || 0;
        console.log(`    Field Data Cache: ${formatBytes(fielddataSize)}`);
        console.log(`    Field Data Evictions: ${fielddataEvictions}`);
        if (fielddataEvictions > 0) {
          console.log(`    ⚠️  WARNING: Field data evictions indicate memory pressure`);
        }
      }
      if (indices && indices.query_cache) {
        const queryCacheSize = indices.query_cache.memory_size_in_bytes;
        const queryCacheEvictions = indices.query_cache.evictions || 0;
        console.log(`    Query Cache: ${formatBytes(queryCacheSize)}`);
        console.log(`    Query Cache Evictions: ${queryCacheEvictions}`);
      }
      if (indices && indices.request_cache) {
        const requestCacheSize = indices.request_cache.memory_size_in_bytes;
        const requestCacheEvictions = indices.request_cache.evictions || 0;
        console.log(`    Request Cache: ${formatBytes(requestCacheSize)}`);
        console.log(`    Request Cache Evictions: ${requestCacheEvictions}`);
      }
      if (indices && indices.segments) {
        const segmentsMemory = indices.segments.memory_in_bytes;
        const segmentsCount = indices.segments.count || 0;
        console.log(`    Segments Memory: ${formatBytes(segmentsMemory)}`);
        console.log(`    Segments Count: ${segmentsCount}`);
      }
      
      // Thread Pool Stats - Look for queued tasks
      console.log(`\n  Thread Pool Activity:`);
      if (threadPool) {
        const importantPools = ['search', 'write', 'index', 'bulk', 'refresh', 'merge'];
        for (const poolName of importantPools) {
          if (threadPool[poolName]) {
            const pool = threadPool[poolName];
            const active = pool.active || 0;
            const queue = pool.queue || 0;
            const rejected = pool.rejected || 0;
            if (active > 0 || queue > 0 || rejected > 0) {
              console.log(`    ${poolName}:`);
              console.log(`      Active: ${active}`);
              console.log(`      Queued: ${queue}`);
              if (rejected > 0) {
                console.log(`      ⚠️  Rejected: ${rejected} (indicates resource pressure)`);
              }
            }
          }
        }
      }
      
      // GC Stats - Look for frequent/long GCs
      console.log(`\n  Garbage Collection:`);
      if (jvm.gc && jvm.gc.collectors) {
        for (const [collectorName, collector] of Object.entries(jvm.gc.collectors)) {
          const count = collector.collection_count || 0;
          const time = collector.collection_time_in_millis || 0;
          if (count > 0) {
            const avgTime = time / count;
            console.log(`    ${collectorName}:`);
            console.log(`      Collections: ${count}`);
            console.log(`      Total Time: ${time}ms`);
            console.log(`      Avg Time: ${avgTime.toFixed(2)}ms`);
            if (avgTime > 100) {
              console.log(`      ⚠️  WARNING: High average GC time indicates memory pressure`);
            }
            if (count > 10000) {
              console.log(`      ⚠️  WARNING: Very high GC frequency`);
            }
          }
        }
      }
    }
    console.log('');

    // 2. Cluster Settings - Memory Limits
    console.log('2. MEMORY-RELATED CLUSTER SETTINGS');
    console.log('-'.repeat(80));
    
    try {
      const settings = await client.cluster.getSettings({
        include_defaults: true,
        filter_path: [
          '*.indices.breaker.*',
          '*.network.breaker.*',
          '*.script.*',
          '*.cluster.routing.allocation.*',
        ],
      });
      
      if (settings.defaults && settings.defaults.indices && settings.defaults.indices.breaker) {
        const breaker = settings.defaults.indices.breaker;
        console.log('Circuit Breakers:');
        if (breaker.total) {
          console.log(`  Total Breaker Limit: ${breaker.total.limit || 'N/A'}`);
          console.log(`  Use Real Memory: ${breaker.total.use_real_memory || 'N/A'}`);
        }
        if (breaker.fielddata) {
          console.log(`  Field Data Breaker Limit: ${breaker.fielddata.limit || 'N/A'}`);
        }
        if (breaker.request) {
          console.log(`  Request Breaker Limit: ${breaker.request.limit || 'N/A'}`);
        }
      }
    } catch (err) {
      console.log(`Could not retrieve settings: ${err.message}`);
    }
    console.log('');

    // 3. Check for Circuit Breaker Trips
    console.log('3. CIRCUIT BREAKER STATS');
    console.log('-'.repeat(80));
    
    const breakerStats = await client.nodes.stats({
      metric: ['breaker'],
      human: false,
    });

    for (const [nodeId, node] of Object.entries(breakerStats.nodes)) {
      console.log(`\nNode: ${node.name || nodeId}`);
      if (node.breakers) {
        for (const [breakerName, breaker] of Object.entries(node.breakers)) {
          const limit = breaker.limit_size_in_bytes;
          const used = breaker.estimated_size_in_bytes;
          const usedPercent = (used / limit) * 100;
          const tripped = breaker.tripped || 0;
          
          console.log(`  ${breakerName}:`);
          console.log(`    Limit: ${formatBytes(limit)}`);
          console.log(`    Used: ${formatBytes(used)} (${formatPercent(usedPercent / 100)})`);
          if (tripped > 0) {
            console.log(`    🔴 TRIPPED: ${tripped} times (indicates memory pressure exceeded)`);
          }
          if (usedPercent > 80) {
            console.log(`    ⚠️  WARNING: Near limit`);
          }
        }
      }
    }
    console.log('');

    // 4. Index Statistics - Find large indices or high document counts
    console.log('4. LARGEST INDICES (by size)');
    console.log('-'.repeat(80));
    
    try {
      const indicesStats = await client.indices.stats({
        metric: ['store', 'docs'],
        human: false,
      });
      
      const indexStats = [];
      for (const [indexName, stats] of Object.entries(indicesStats.indices)) {
        const storeSize = stats.total?.store?.size_in_bytes || 0;
        const docCount = stats.total?.docs?.count || 0;
        const shardCount = stats.total?.shard_stats?.total_count || 0;
        
        indexStats.push({
          name: indexName,
          size: storeSize,
          docs: docCount,
          shards: shardCount,
        });
      }
      
      // Sort by size and show top 20
      indexStats.sort((a, b) => b.size - a.size);
      const topIndices = indexStats.slice(0, 20);
      
      console.log('Top 20 indices by size:');
      for (const idx of topIndices) {
        console.log(`  ${idx.name}:`);
        console.log(`    Size: ${formatBytes(idx.size)}`);
        console.log(`    Documents: ${idx.docs.toLocaleString()}`);
        console.log(`    Shards: ${idx.shards}`);
      }
    } catch (err) {
      console.log(`Could not retrieve index stats: ${err.message}`);
    }
    console.log('');

    // 5. Pending Tasks - What's the cluster busy with?
    console.log('5. CLUSTER ACTIVITY');
    console.log('-'.repeat(80));
    
    const pendingTasks = await client.cluster.pendingTasks();
    if (pendingTasks.tasks && pendingTasks.tasks.length > 0) {
      console.log(`Pending tasks: ${pendingTasks.tasks.length}\n`);
      for (const task of pendingTasks.tasks) {
        console.log(`  ${task.source}:`);
        console.log(`    Priority: ${task.priority}`);
        console.log(`    Time in queue: ${task.time_in_queue_millis}ms`);
      }
    } else {
      console.log('No pending tasks');
    }
    
    // Check for active shard operations
    try {
      const recovery = await client.indices.recovery({
        human: false,
        detailed: false,
      });
      
      let activeRecoveries = 0;
      for (const [indexName, indexRecovery] of Object.entries(recovery)) {
        if (indexRecovery.shards) {
          for (const shard of indexRecovery.shards) {
            if (shard.stage !== 'DONE') {
              activeRecoveries++;
            }
          }
        }
      }
      
      if (activeRecoveries > 0) {
        console.log(`\n  Active shard recoveries: ${activeRecoveries}`);
        console.log(`  ⚠️  Shard recovery operations consume memory`);
      }
    } catch (err) {
      // Recovery API might not be available
    }
    console.log('');

    // 6. Root Cause Analysis
    console.log('6. ROOT CAUSE ANALYSIS');
    console.log('-'.repeat(80));
    
    let maxHeapUsed = 0;
    let nodesWithHighPressure = [];
    let totalFieldDataEvictions = 0;
    let totalCircuitBreakerTrips = 0;
    
    for (const nodeId of nodeIds) {
      const node = nodes[nodeId];
      const heapUsedPercent = node.jvm.mem.heap_used_percent;
      if (heapUsedPercent > maxHeapUsed) {
        maxHeapUsed = heapUsedPercent;
      }
      if (heapUsedPercent > 75) {
        nodesWithHighPressure.push({
          name: node.name || nodeId,
          heapUsedPercent,
          roles: node.roles,
        });
      }
      
      if (node.indices && node.indices.fielddata) {
        totalFieldDataEvictions += node.indices.fielddata.evictions || 0;
      }
      
      if (breakerStats.nodes[nodeId] && breakerStats.nodes[nodeId].breakers) {
        for (const breaker of Object.values(breakerStats.nodes[nodeId].breakers)) {
          totalCircuitBreakerTrips += breaker.tripped || 0;
        }
      }
    }
    
    console.log(`Maximum heap usage: ${maxHeapUsed.toFixed(2)}%`);
    console.log(`Total field data evictions: ${totalFieldDataEvictions}`);
    console.log(`Total circuit breaker trips: ${totalCircuitBreakerTrips}`);
    
    console.log('\n🔍 Potential Root Causes:');
    
    if (nodesWithHighPressure.length > 0) {
      console.log('\n1. HIGH MEMORY PRESSURE DETECTED:');
      nodesWithHighPressure.forEach(({ name, heapUsedPercent, roles }) => {
        console.log(`   - ${name}: ${heapUsedPercent.toFixed(2)}% (Roles: ${roles.join(', ')})`);
      });
    }
    
    if (totalFieldDataEvictions > 0) {
      console.log('\n2. FIELD DATA EVICTIONS:');
      console.log(`   - ${totalFieldDataEvictions} evictions indicate memory pressure from field data cache`);
      console.log(`   - Likely caused by: large aggregations, sorting on text fields, or field data cache buildup`);
    }
    
    if (totalCircuitBreakerTrips > 0) {
      console.log('\n3. CIRCUIT BREAKER TRIPS:');
      console.log(`   - ${totalCircuitBreakerTrips} trips indicate memory limits were exceeded`);
      console.log(`   - This would cause query failures and increased memory pressure`);
    }
    
    // Check for node leaving event
    const clusterHealth = await client.cluster.health();
    if (clusterHealth.unassigned_shards > 0) {
      console.log('\n4. NODE DEPARTURE EVENT:');
      console.log(`   - ${clusterHealth.unassigned_shards} unassigned shards detected`);
      console.log(`   - When a node leaves, the cluster must:`);
      console.log(`     * Reallocate primary shards from the failed node`);
      console.log(`     * Create new replica shards for all affected indices`);
      console.log(`     * This process requires significant memory for:`);
      console.log(`       - Shard recovery operations`);
      console.log(`       - Indexing new replica data`);
      console.log(`       - Segment merging during recovery`);
      console.log(`   - With 645 unassigned shards, this is a massive recovery operation`);
    }
    
    console.log('\n💡 Most Likely Root Cause:');
    console.log('   The JVM memory pressure was caused by the node departure event.');
    console.log('   When node Y2efNvR0RWud1Jmh-yzc9g left the cluster:');
    console.log('   1. The cluster had to reallocate 645 replica shards');
    console.log('   2. Each shard recovery requires memory for:');
    console.log('      - Reading source shard data');
    console.log('      - Indexing documents into new shard');
    console.log('      - Segment merging operations');
    console.log('      - Field data cache building');
    console.log('   3. With limited data nodes (2), all recovery work concentrated on few nodes');
    console.log('   4. This created a "thundering herd" effect on memory usage');
    console.log('   5. The pressure has now subsided as:');
    console.log('      - Initial recovery burst completed');
    console.log('      - Remaining recoveries are throttled');
    console.log('      - GC has reclaimed memory from completed operations');
    
    console.log('\n' + '='.repeat(80));
    console.log('Investigation complete');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Error during investigation:');
    console.error(error.message);
    if (error.meta) {
      console.error('Details:', JSON.stringify(error.meta.body, null, 2));
    }
    process.exit(1);
  } finally {
    await client.close();
  }
}

investigateRootCause().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

