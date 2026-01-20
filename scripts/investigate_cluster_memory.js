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
  console.error('Usage: node investigate_cluster_memory.js <cluster_url> <api_key>');
  console.error('   or: CLUSTER_URL=<url> API_KEY=<key> node investigate_cluster_memory.js');
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
    rejectUnauthorized: false, // For cloud clusters
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

// Main diagnostic function
async function investigateCluster() {
  console.log('='.repeat(80));
  console.log('Elasticsearch Cluster Memory Pressure Investigation');
  console.log('='.repeat(80));
  console.log(`Cluster URL: ${CLUSTER_URL}\n`);

  try {
    // 1. Cluster Health
    console.log('1. CLUSTER HEALTH');
    console.log('-'.repeat(80));
    const health = await client.cluster.health({
      level: 'indices',
    });
    console.log(`Status: ${health.status}`);
    console.log(`Number of nodes: ${health.number_of_nodes}`);
    console.log(`Number of data nodes: ${health.number_of_data_nodes}`);
    console.log(`Active primary shards: ${health.active_primary_shards}`);
    console.log(`Active shards: ${health.active_shards}`);
    console.log(`Relocating shards: ${health.relocating_shards}`);
    console.log(`Initializing shards: ${health.initializing_shards}`);
    console.log(`Unassigned shards: ${health.unassigned_shards}`);
    if (health.timed_out) {
      console.log('⚠️  WARNING: Health check timed out');
    }
    console.log('');

    // 2. Cluster Stats
    console.log('2. CLUSTER STATS');
    console.log('-'.repeat(80));
    const clusterStats = await client.cluster.stats();
    console.log(`Cluster name: ${clusterStats.cluster_name}`);
    console.log(`Cluster UUID: ${clusterStats.cluster_uuid}`);
    console.log(`Elasticsearch version: ${clusterStats.nodes.versions.join(', ')}`);
    console.log(`Total nodes: ${clusterStats.nodes.count.total}`);
    console.log(`Data nodes: ${clusterStats.nodes.count.data}`);
    console.log(`Master nodes: ${clusterStats.nodes.count.master}`);
    console.log('');

    // 3. Node Stats - JVM Memory
    console.log('3. NODE STATS - JVM MEMORY');
    console.log('-'.repeat(80));
    const nodeStats = await client.nodes.stats({
      metric: ['jvm', 'os', 'process'],
      human: false,
    });

    const nodes = nodeStats.nodes;
    const nodeIds = Object.keys(nodes);

    for (const nodeId of nodeIds) {
      const node = nodes[nodeId];
      const jvm = node.jvm;
      const os = node.os;
      const process = node.process;

      console.log(`\nNode: ${node.name || nodeId}`);
      console.log(`  Host: ${node.host}`);
      console.log(`  Roles: ${node.roles.join(', ')}`);
      
      // JVM Memory Details
      console.log(`  JVM Memory:`);
      console.log(`    Heap Used: ${formatBytes(jvm.mem.heap_used_in_bytes)} / ${formatBytes(jvm.mem.heap_max_in_bytes)} (${formatPercent(jvm.mem.heap_used_percent / 100)})`);
      console.log(`    Heap Committed: ${formatBytes(jvm.mem.heap_committed_in_bytes)}`);
      console.log(`    Non-Heap Used: ${formatBytes(jvm.mem.non_heap_used_in_bytes)}`);
      console.log(`    Non-Heap Committed: ${formatBytes(jvm.mem.non_heap_committed_in_bytes)}`);
      
      // Memory Pressure Indicators
      const heapUsedPercent = jvm.mem.heap_used_percent;
      let pressureStatus = '✅ OK';
      if (heapUsedPercent > 90) {
        pressureStatus = '🔴 CRITICAL';
      } else if (heapUsedPercent > 75) {
        pressureStatus = '🟡 WARNING';
      }
      console.log(`    Memory Pressure: ${pressureStatus} (${heapUsedPercent}%)`);
      
      // GC Stats
      console.log(`  Garbage Collection:`);
      if (jvm.gc && jvm.gc.collectors) {
        for (const [collectorName, collector] of Object.entries(jvm.gc.collectors)) {
          console.log(`    ${collectorName}:`);
          console.log(`      Collections: ${collector.collection_count}`);
          console.log(`      Total Time: ${collector.collection_time_in_millis}ms`);
          if (collector.collection_count > 0) {
            const avgTime = collector.collection_time_in_millis / collector.collection_count;
            console.log(`      Avg Time: ${avgTime.toFixed(2)}ms`);
          }
        }
      }
      
      // OS Memory
      console.log(`  OS Memory:`);
      console.log(`    Total: ${formatBytes(os.mem.total_in_bytes)}`);
      console.log(`    Free: ${formatBytes(os.mem.free_in_bytes)}`);
      console.log(`    Used: ${formatBytes(os.mem.used_in_bytes)}`);
      console.log(`    Free Percent: ${formatPercent((os.mem.free_in_bytes / os.mem.total_in_bytes))}`);
      
      // Process Memory
      if (process && process.mem) {
        console.log(`  Process Memory:`);
        console.log(`    Virtual: ${formatBytes(process.mem.total_virtual_in_bytes)}`);
      }
    }
    console.log('');

    // 4. Cluster Settings - Memory-related
    console.log('4. CLUSTER SETTINGS (Memory-related)');
    console.log('-'.repeat(80));
    try {
      const settings = await client.cluster.getSettings({
        include_defaults: true,
        filter_path: [
          '*.cluster.routing.allocation.disk.*',
          '*.indices.breaker.*',
          '*.network.breaker.*',
          '*.script.*',
        ],
      });
      console.log(JSON.stringify(settings, null, 2));
    } catch (err) {
      console.log(`Could not retrieve cluster settings: ${err.message}`);
    }
    console.log('');

    // 5. Circuit Breakers
    console.log('5. CIRCUIT BREAKERS');
    console.log('-'.repeat(80));
    try {
      const circuitBreakers = await client.cluster.getSettings({
        include_defaults: true,
        filter_path: [
          '*.indices.breaker.*',
          '*.network.breaker.*',
        ],
      });
      console.log(JSON.stringify(circuitBreakers, null, 2));
    } catch (err) {
      console.log(`Could not retrieve circuit breaker settings: ${err.message}`);
    }
    console.log('');

    // 6. Hot Threads (if available)
    console.log('6. HOT THREADS (Top 10)');
    console.log('-'.repeat(80));
    try {
      const hotThreads = await client.nodes.hotThreads({
        threads: 10,
        interval: '500ms',
        type: 'cpu',
        timeout: '5s',
      });
      if (hotThreads && hotThreads.length > 0) {
        console.log(hotThreads.substring(0, 2000)); // First 2000 chars
        if (hotThreads.length > 2000) {
          console.log('\n... (truncated)');
        }
      } else {
        console.log('No hot threads detected');
      }
    } catch (err) {
      console.log(`Could not retrieve hot threads: ${err.message}`);
    }
    console.log('');

    // 7. Summary and Recommendations
    console.log('7. SUMMARY & RECOMMENDATIONS');
    console.log('-'.repeat(80));
    
    let maxHeapUsed = 0;
    let nodesWithPressure = [];
    
    for (const nodeId of nodeIds) {
      const node = nodes[nodeId];
      const heapUsedPercent = node.jvm.mem.heap_used_percent;
      if (heapUsedPercent > maxHeapUsed) {
        maxHeapUsed = heapUsedPercent;
      }
      if (heapUsedPercent > 75) {
        nodesWithPressure.push({
          name: node.name || nodeId,
          heapUsedPercent,
        });
      }
    }
    
    console.log(`Maximum heap usage across all nodes: ${maxHeapUsed.toFixed(2)}%`);
    
    if (nodesWithPressure.length > 0) {
      console.log(`\n⚠️  Nodes with memory pressure (>75%):`);
      nodesWithPressure.forEach(({ name, heapUsedPercent }) => {
        console.log(`  - ${name}: ${heapUsedPercent.toFixed(2)}%`);
      });
    } else {
      console.log('\n✅ No nodes currently showing memory pressure (>75%)');
    }
    
    if (maxHeapUsed < 50) {
      console.log('\n✅ Current memory usage is healthy. The previous pressure may have been:');
      console.log('   - A temporary spike that has since been resolved');
      console.log('   - Related to a specific operation that completed');
      console.log('   - Caused by a node restart or scaling event');
    }
    
    console.log('\nRecommendations:');
    console.log('  - Monitor heap usage trends over time');
    console.log('  - Check for large queries or aggregations');
    console.log('  - Review index sizes and shard distribution');
    console.log('  - Consider increasing heap size if pressure persists');
    console.log('  - Review GC logs for frequent or long GC pauses');
    
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

// Run the investigation
investigateCluster().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

