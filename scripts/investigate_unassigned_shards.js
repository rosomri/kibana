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
  console.error('Usage: node investigate_unassigned_shards.js <cluster_url> <api_key>');
  console.error('   or: CLUSTER_URL=<url> API_KEY=<key> node investigate_unassigned_shards.js');
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

async function investigateUnassignedShards() {
  console.log('='.repeat(80));
  console.log('Unassigned Shards Investigation');
  console.log('='.repeat(80));
  console.log(`Cluster URL: ${CLUSTER_URL}\n`);

  try {
    // Get cluster allocation explanation
    console.log('1. CLUSTER ALLOCATION EXPLANATION');
    console.log('-'.repeat(80));
    
    const allocation = await client.cluster.allocationExplain({
      include_yes_decisions: false,
    });
    
    if (allocation) {
      console.log('Allocation Decision:', allocation.allocation_delay || 'N/A');
      if (allocation.unassigned_info) {
        console.log('Unassigned Info:');
        console.log('  Reason:', allocation.unassigned_info.reason);
        console.log('  At:', allocation.unassigned_info.at);
        console.log('  Details:', allocation.unassigned_info.details || 'N/A');
        console.log('  Last Allocation Attempt:', allocation.unassigned_info.last_allocation_status || 'N/A');
      }
      if (allocation.current_node) {
        console.log('Current Node:', allocation.current_node.id);
      }
      if (allocation.can_allocate) {
        console.log('Can Allocate:', allocation.can_allocate);
      }
      if (allocation.allocate_explanation) {
        console.log('Allocation Explanation:', allocation.allocate_explanation);
      }
    }
    console.log('');

    // Get cluster state with routing table
    console.log('2. UNASSIGNED SHARDS BY INDEX');
    console.log('-'.repeat(80));
    
    const clusterState = await client.cluster.state({
      metric: ['routing_table', 'nodes'],
      filter_path: [
        'routing_table.indices.*.shards.*',
        'nodes.*.name',
        'nodes.*.attributes',
      ],
    });

    const unassignedByIndex = {};
    const routingTable = clusterState.routing_table?.indices || {};

    for (const [indexName, indexData] of Object.entries(routingTable)) {
      const shards = indexData.shards || {};
      for (const [shardNum, shardArray] of Object.entries(shards)) {
        if (Array.isArray(shardArray)) {
          for (const shard of shardArray) {
            if (shard.state === 'UNASSIGNED') {
              if (!unassignedByIndex[indexName]) {
                unassignedByIndex[indexName] = [];
              }
              unassignedByIndex[indexName].push({
                shard: shardNum,
                primary: shard.primary,
                state: shard.state,
                unassigned_info: shard.unassigned_info,
              });
            }
          }
        }
      }
    }

    // Sort by number of unassigned shards
    const sortedIndices = Object.entries(unassignedByIndex)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 20); // Top 20 indices

    console.log(`Found ${Object.keys(unassignedByIndex).length} indices with unassigned shards\n`);
    console.log('Top 20 indices by unassigned shard count:');
    
    for (const [indexName, shards] of sortedIndices) {
      const primaryCount = shards.filter(s => s.primary).length;
      const replicaCount = shards.filter(s => !s.primary).length;
      console.log(`\n  ${indexName}:`);
      console.log(`    Total unassigned: ${shards.length} (${primaryCount} primary, ${replicaCount} replica)`);
      if (shards[0]?.unassigned_info) {
        const reason = shards[0].unassigned_info.reason;
        const details = shards[0].unassigned_info.details || '';
        console.log(`    Reason: ${reason}`);
        if (details) {
          console.log(`    Details: ${details.substring(0, 200)}`);
        }
      }
    }
    console.log('');

    // Get disk usage per node
    console.log('3. NODE DISK USAGE');
    console.log('-'.repeat(80));
    
    const nodeStats = await client.nodes.stats({
      metric: ['fs'],
      human: false,
    });

    const nodes = nodeStats.nodes;
    for (const [nodeId, node] of Object.entries(nodes)) {
      const fs = node.fs;
      const total = fs.total.total_in_bytes;
      const available = fs.total.available_in_bytes;
      const used = total - available;
      const usedPercent = (used / total) * 100;
      
      console.log(`\nNode: ${node.name || nodeId}`);
      console.log(`  Total: ${(total / 1024 / 1024 / 1024).toFixed(2)} GB`);
      console.log(`  Used: ${(used / 1024 / 1024 / 1024).toFixed(2)} GB (${usedPercent.toFixed(2)}%)`);
      console.log(`  Available: ${(available / 1024 / 1024 / 1024).toFixed(2)} GB`);
      
      if (usedPercent > 90) {
        console.log(`  ⚠️  WARNING: Disk usage above 90%`);
      } else if (usedPercent > 85) {
        console.log(`  ⚠️  CAUTION: Disk usage above 85%`);
      }
    }
    console.log('');

    // Get pending tasks
    console.log('4. PENDING CLUSTER TASKS');
    console.log('-'.repeat(80));
    
    const pendingTasks = await client.cluster.pendingTasks();
    if (pendingTasks.tasks && pendingTasks.tasks.length > 0) {
      console.log(`Found ${pendingTasks.tasks.length} pending tasks:\n`);
      for (const task of pendingTasks.tasks.slice(0, 10)) {
        console.log(`  ${task.source}:`);
        console.log(`    Priority: ${task.priority}`);
        console.log(`    Time in queue: ${task.time_in_queue_millis}ms`);
      }
    } else {
      console.log('No pending tasks');
    }
    console.log('');

    // Summary
    console.log('5. SUMMARY');
    console.log('-'.repeat(80));
    const totalUnassigned = Object.values(unassignedByIndex).reduce((sum, shards) => sum + shards.length, 0);
    console.log(`Total unassigned shards: ${totalUnassigned}`);
    console.log(`Indices with unassigned shards: ${Object.keys(unassignedByIndex).length}`);
    
    if (totalUnassigned > 0) {
      console.log('\n⚠️  Recommendations:');
      console.log('  - Check disk space on data nodes');
      console.log('  - Verify cluster allocation settings');
      console.log('  - Review index settings (number_of_replicas)');
      console.log('  - Check for node failures or network issues');
      console.log('  - Consider reducing replica count if disk space is low');
    }

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

investigateUnassignedShards().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

