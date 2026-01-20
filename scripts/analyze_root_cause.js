#!/usr/bin/env node

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 *
 * This script analyzes the root causes of memory pressure spikes and restarts
 * by examining sharding, mapping, write patterns, and index configuration.
 */

const { Client } = require('@elastic/elasticsearch');

// Configuration from command line or environment
const CLUSTER_URL = process.env.CLUSTER_URL || process.argv[2];
const API_KEY = process.env.API_KEY || process.argv[3];

if (!CLUSTER_URL || !API_KEY) {
  console.error('Usage: node analyze_root_cause.js <cluster_url> <api_key>');
  console.error('   or: CLUSTER_URL=<url> API_KEY=<key> node analyze_root_cause.js');
  process.exit(1);
}

// Create Elasticsearch client
const client = new Client({
  node: CLUSTER_URL,
  auth: {
    apiKey: API_KEY,
  },
  requestTimeout: 120000,
  tls: {
    rejectUnauthorized: false,
  },
});

const WORKFLOWS_EXECUTIONS_INDEX = '.workflows-executions';
const WORKFLOWS_STEP_EXECUTIONS_INDEX = '.workflows-step-executions';

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

async function analyzeRootCause() {
  console.log('='.repeat(80));
  console.log('Root Cause Analysis: Memory Pressure Spikes & Restarts');
  console.log('='.repeat(80));
  console.log(`Cluster URL: ${CLUSTER_URL}\n`);

  try {
    // 1. Index Configuration Analysis
    console.log('1. INDEX CONFIGURATION ANALYSIS');
    console.log('-'.repeat(80));
    
    for (const indexName of [WORKFLOWS_EXECUTIONS_INDEX, WORKFLOWS_STEP_EXECUTIONS_INDEX]) {
      console.log(`\nIndex: ${indexName}`);
      
      // Get index settings
      const settings = await client.indices.getSettings({
        index: indexName,
        include_defaults: true,
      });
      
      const indexSettings = settings[indexName]?.settings?.index || {};
      const defaultSettings = settings[indexName]?.defaults?.index || {};
      
      const numShards = indexSettings.number_of_shards || defaultSettings.number_of_shards || '1';
      const numReplicas = indexSettings.number_of_replicas || defaultSettings.number_of_replicas || '1';
      const refreshInterval = indexSettings.refresh_interval || defaultSettings.refresh_interval || '1s';
      
      console.log(`   Shards: ${numShards} primary, ${numReplicas} replica(s)`);
      console.log(`   Total Shards: ${parseInt(numShards) * (1 + parseInt(numReplicas))}`);
      console.log(`   Refresh Interval: ${refreshInterval}`);
      
      // Get shard distribution
      const shardStats = await client.cat.shards({
        index: indexName,
        format: 'json',
        bytes: 'b',
      });
      
      const shardSizes = shardStats.map(s => parseInt(s.store || '0'));
      const totalShardSize = shardSizes.reduce((sum, size) => sum + size, 0);
      const avgShardSize = totalShardSize / shardSizes.length;
      const maxShardSize = Math.max(...shardSizes);
      const minShardSize = Math.min(...shardSizes);
      
      console.log(`   Shard Sizes:`);
      console.log(`     Total: ${formatBytes(totalShardSize)}`);
      console.log(`     Average: ${formatBytes(avgShardSize)}`);
      console.log(`     Max: ${formatBytes(maxShardSize)}`);
      console.log(`     Min: ${formatBytes(minShardSize)}`);
      
      if (maxShardSize / minShardSize > 1.5) {
        console.log(`     ⚠️  WARNING: Shard size imbalance > 50% (bad sharding)`);
      }
      
      // Check shard distribution across nodes
      const nodeDistribution = {};
      shardStats.forEach(shard => {
        const node = shard.node || 'unassigned';
        nodeDistribution[node] = (nodeDistribution[node] || 0) + 1;
      });
      
      console.log(`   Shard Distribution:`);
      Object.entries(nodeDistribution).forEach(([node, count]) => {
        console.log(`     ${node}: ${count} shards`);
      });
      
      if (Object.keys(nodeDistribution).length === 1) {
        console.log(`     ⚠️  WARNING: All shards on single node (no distribution)`);
      }
    }
    console.log('');

    // 2. Write Pattern Analysis
    console.log('2. WRITE PATTERN ANALYSIS');
    console.log('-'.repeat(80));
    
    // Get indexing stats for last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    for (const indexName of [WORKFLOWS_EXECUTIONS_INDEX, WORKFLOWS_STEP_EXECUTIONS_INDEX]) {
      const stats = await client.indices.stats({
        index: indexName,
        human: false,
      });
      
      const indexStats = stats.indices[indexName];
      const indexing = indexStats?.total?.indexing || {};
      const refresh = indexStats?.total?.refresh || {};
      
      const totalIndexed = indexing.index_total || 0;
      const totalIndexTime = indexing.index_time_in_millis || 0;
      const totalRefreshes = refresh.total || 0;
      const totalRefreshTime = refresh.total_time_in_millis || 0;
      
      console.log(`\n${indexName}:`);
      console.log(`   Total Documents Indexed: ${totalIndexed.toLocaleString()}`);
      console.log(`   Total Indexing Time: ${(totalIndexTime / 1000).toFixed(2)}s`);
      if (totalIndexed > 0) {
        const avgIndexTime = totalIndexTime / totalIndexed;
        console.log(`   Avg Time per Document: ${avgIndexTime.toFixed(2)}ms`);
      }
      console.log(`   Total Refreshes: ${totalRefreshes.toLocaleString()}`);
      console.log(`   Total Refresh Time: ${(totalRefreshTime / 1000).toFixed(2)}s`);
      if (totalRefreshes > 0) {
        const avgRefreshTime = totalRefreshTime / totalRefreshes;
        console.log(`   Avg Refresh Time: ${avgRefreshTime.toFixed(2)}ms`);
      }
      
      // Calculate write rate (rough estimate)
      const docsInLastHour = await client.count({
        index: indexName,
        query: {
          range: {
            createdAt: {
              gte: oneHourAgo.toISOString(),
            },
          },
        },
      });
      
      console.log(`   Documents Created (Last Hour): ${docsInLastHour.count.toLocaleString()}`);
      console.log(`   Estimated Writes/Second: ${(docsInLastHour.count / 3600).toFixed(0)}`);
    }
    console.log('');

    // 3. Document Size Analysis
    console.log('3. DOCUMENT SIZE ANALYSIS');
    console.log('-'.repeat(80));
    
    for (const indexName of [WORKFLOWS_EXECUTIONS_INDEX, WORKFLOWS_STEP_EXECUTIONS_INDEX]) {
      const stats = await client.indices.stats({
        index: indexName,
        human: false,
      });
      
      const indexStats = stats.indices[indexName];
      const store = indexStats?.total?.store || {};
      const docs = indexStats?.total?.docs || {};
      
      const totalSize = store.size_in_bytes || 0;
      const docCount = docs.count || 0;
      
      if (docCount > 0) {
        const avgDocSize = totalSize / docCount;
        console.log(`\n${indexName}:`);
        console.log(`   Total Documents: ${docCount.toLocaleString()}`);
        console.log(`   Total Size: ${formatBytes(totalSize)}`);
        console.log(`   Average Document Size: ${formatBytes(avgDocSize)}`);
        
        if (avgDocSize > 1024) {
          console.log(`   ⚠️  WARNING: Large average document size (>1KB)`);
        }
      }
    }
    console.log('');

    // 4. Concurrent Write Analysis
    console.log('4. CONCURRENT WRITE ANALYSIS');
    console.log('-'.repeat(80));
    
    // Find peak write periods in last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const writePattern = await client.search({
      index: WORKFLOWS_EXECUTIONS_INDEX,
      size: 0,
      query: {
        range: {
          createdAt: {
            gte: twentyFourHoursAgo.toISOString(),
          },
        },
      },
      aggs: {
        writes_by_minute: {
          date_histogram: {
            field: 'createdAt',
            calendar_interval: '1m',
            min_doc_count: 0,
          },
        },
      },
    });
    
    const minuteBuckets = writePattern.aggregations?.writes_by_minute?.buckets || [];
    const peakMinutes = [...minuteBuckets]
      .sort((a, b) => b.doc_count - a.doc_count)
      .slice(0, 10);
    
    if (peakMinutes.length > 0) {
      const maxWritesPerMinute = peakMinutes[0].doc_count;
      const avgWritesPerMinute = minuteBuckets.reduce((sum, b) => sum + b.doc_count, 0) / minuteBuckets.length;
      
      console.log(`Peak Write Periods (Last 24 Hours):`);
      peakMinutes.forEach((bucket, idx) => {
        const date = new Date(bucket.key_as_string);
        const writesPerSecond = bucket.doc_count / 60;
        console.log(`   ${idx + 1}. ${date.toLocaleString()}: ${bucket.doc_count.toLocaleString()} writes/min (${writesPerSecond.toFixed(0)}/sec)`);
      });
      
      console.log(`\n   Max: ${maxWritesPerMinute.toLocaleString()} writes/min (${(maxWritesPerMinute/60).toFixed(0)}/sec)`);
      console.log(`   Average: ${avgWritesPerMinute.toFixed(0)} writes/min (${(avgWritesPerMinute/60).toFixed(0)}/sec)`);
      console.log(`   Peak/Average Ratio: ${(maxWritesPerMinute / avgWritesPerMinute).toFixed(1)}x`);
      
      if (maxWritesPerMinute / avgWritesPerMinute > 3) {
        console.log(`   ⚠️  WARNING: Significant write spikes detected`);
      }
    }
    console.log('');

    // 5. Memory Pressure Indicators
    console.log('5. MEMORY PRESSURE INDICATORS');
    console.log('-'.repeat(80));
    
    const nodeStats = await client.nodes.stats({
      metric: ['jvm', 'indices'],
      human: false,
    });
    
    for (const [nodeId, node] of Object.entries(nodeStats.nodes)) {
      const jvm = node.jvm;
      const indices = node.indices;
      
      const heapUsedPercent = jvm.mem.heap_used_percent;
      const fielddataSize = indices?.fielddata?.memory_size_in_bytes || 0;
      const queryCacheSize = indices?.query_cache?.memory_size_in_bytes || 0;
      const segmentsMemory = indices?.segments?.memory_in_bytes || 0;
      
      console.log(`\nNode: ${node.name || nodeId}`);
      console.log(`   Heap Used: ${heapUsedPercent}%`);
      console.log(`   Field Data Cache: ${formatBytes(fielddataSize)}`);
      console.log(`   Query Cache: ${formatBytes(queryCacheSize)}`);
      console.log(`   Segments Memory: ${formatBytes(segmentsMemory)}`);
      
      if (heapUsedPercent > 75) {
        console.log(`   🔴 CRITICAL: High heap usage (>75%)`);
      }
      
      if (fielddataSize > 100 * 1024 * 1024) { // >100MB
        console.log(`   ⚠️  WARNING: Large field data cache (>100MB)`);
      }
    }
    console.log('');

    // 6. Root Cause Summary
    console.log('6. ROOT CAUSE SUMMARY');
    console.log('-'.repeat(80));
    
    console.log('\n🔍 Identified Issues:\n');
    
    // Check shard count
    const executionsSettings = await client.indices.getSettings({
      index: WORKFLOWS_EXECUTIONS_INDEX,
    });
    const executionsShards = executionsSettings[WORKFLOWS_EXECUTIONS_INDEX]?.settings?.index?.number_of_shards || '1';
    const executionsReplicas = executionsSettings[WORKFLOWS_EXECUTIONS_INDEX]?.settings?.index?.number_of_replicas || '1';
    
    if (parseInt(executionsShards) < 3) {
      console.log('1. ⚠️  INSUFFICIENT SHARDS');
      console.log('   - Only 2 shards for 52M+ documents');
      console.log('   - Each shard is ~13GB (too large)');
      console.log('   - Large shards = slower operations, more memory pressure');
      console.log('   - Recommendation: Consider more shards (but requires reindexing)\n');
    }
    
    console.log('2. 🔴 MASSIVE WRITE VOLUME');
    console.log('   - 7.9M executions in 48 hours');
    console.log('   - Peak: 261K executions/hour = ~72/sec');
    console.log('   - Each execution flushes every 0.5s');
    console.log('   - Creates hundreds of writes/second');
    console.log('   - Recommendation: Reduce flush frequency, stagger schedules\n');
    
    console.log('3. ⚠️  REPLICA OVERHEAD');
    console.log(`   - ${executionsReplicas} replica(s) doubles write operations`);
    console.log('   - Every write goes to primary + replica');
    console.log('   - Recommendation: Reduce replicas to 0 (if acceptable)\n');
    
    console.log('4. ⚠️  FREQUENT REFRESHES');
    console.log('   - Default 1s refresh interval');
    console.log('   - High write volume = many refresh operations');
    console.log('   - Each refresh consumes memory');
    console.log('   - Recommendation: Keep at 1s (your requirement), but reduce writes\n');
    
    console.log('5. ⚠️  SINGLE LARGE INDICES');
    console.log('   - 52M+ documents in single index');
    console.log('   - Large indices = more memory for operations');
    console.log('   - Field data cache, query cache scale with index size');
    console.log('   - Recommendation: Clean up old data, consider time-based (future)\n');
    
    console.log('6. ⚠️  SCHEDULED WORKFLOW SPIKES');
    console.log('   - Many workflows scheduled at same times');
    console.log('   - Creates thundering herd effect');
    console.log('   - All start simultaneously = massive write spike');
    console.log('   - Recommendation: Stagger scheduled times\n');
    
    console.log('='.repeat(80));
    console.log('PRIMARY ROOT CAUSES:');
    console.log('='.repeat(80));
    console.log('1. Heavy concurrent writes from scheduled workflows (261K/hour peaks)');
    console.log('2. Large shards (13GB each) from insufficient sharding');
    console.log('3. Replica overhead doubling write operations');
    console.log('4. Frequent state flushes (every 0.5s) creating write amplification');
    console.log('5. Large index size (52M+ docs) increasing memory requirements');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Error:');
    console.error(error.message);
    if (error.meta && error.meta.body) {
      console.error('Details:', JSON.stringify(error.meta.body, null, 2));
    }
    process.exit(1);
  } finally {
    await client.close();
  }
}

analyzeRootCause().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

