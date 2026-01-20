#!/usr/bin/env node

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 *
 * This script analyzes write efficiency, shard distribution, and actual performance
 * impact of workflow indices, not just raw operation counts.
 */

const { Client } = require('@elastic/elasticsearch');

// Configuration from command line or environment
const CLUSTER_URL = process.env.CLUSTER_URL || process.argv[2];
const API_KEY = process.env.API_KEY || process.argv[3];

if (!CLUSTER_URL || !API_KEY) {
  console.error('Usage: node analyze_write_efficiency.js <cluster_url> <api_key>');
  console.error('   or: CLUSTER_URL=<url> API_KEY=<key> node analyze_write_efficiency.js');
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
const EVENT_LOGS_DATA_STREAM = '.workflows-execution-data-stream-logs';

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatTime(ms) {
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function analyzeWriteEfficiency() {
  console.log('='.repeat(80));
  console.log('Write Efficiency & Performance Analysis');
  console.log('='.repeat(80));
  console.log(`Cluster URL: ${CLUSTER_URL}\n`);

  try {
    // 1. Detailed Index Statistics with Performance Metrics
    console.log('1. INDEX PERFORMANCE METRICS');
    console.log('-'.repeat(80));
    
    const indices = [
      { name: WORKFLOWS_EXECUTIONS_INDEX, type: 'Single Index' },
      { name: WORKFLOWS_STEP_EXECUTIONS_INDEX, type: 'Single Index' },
      { name: EVENT_LOGS_DATA_STREAM, type: 'Data Stream' },
    ];
    
    const indexAnalysis = [];
    
    for (const indexInfo of indices) {
      try {
        const stats = await client.indices.stats({
          index: indexInfo.name,
          human: false,
          level: 'indices',
        });
        
        const indexStats = Object.values(stats.indices)[0];
        if (!indexStats) continue;
        
        const total = indexStats.total || {};
        const indexing = total.indexing || {};
        const refresh = total.refresh || {};
        const store = total.store || {};
        const docs = total.docs || {};
        const segments = total.segments || {};
        
        const docCount = docs.count || 0;
        const storeSize = store.size_in_bytes || 0;
        const indexingOps = indexing.index_total || 0;
        const indexingTime = indexing.index_time_in_millis || 0;
        const refreshCount = refresh.total || 0;
        const refreshTime = refresh.total_time_in_millis || 0;
        const segmentsCount = segments.count || 0;
        const segmentsMemory = segments.memory_in_bytes || 0;
        
        // Calculate efficiency metrics
        const avgIndexTime = indexingOps > 0 ? indexingTime / indexingOps : 0;
        const avgRefreshTime = refreshCount > 0 ? refreshTime / refreshCount : 0;
        const opsPerDoc = indexingOps > 0 ? indexingOps / docCount : 0;
        const sizePerDoc = docCount > 0 ? storeSize / docCount : 0;
        
        // Get shard information
        const shardStats = await client.cat.shards({
          index: indexInfo.name,
          format: 'json',
          bytes: 'b',
        });
        
        const shardCount = shardStats.length;
        const shardSizes = shardStats.map(s => parseInt(s.store || '0'));
        const totalShardSize = shardSizes.reduce((sum, size) => sum + size, 0);
        const avgShardSize = shardCount > 0 ? totalShardSize / shardCount : 0;
        const maxShardSize = Math.max(...shardSizes, 0);
        const minShardSize = Math.min(...shardSizes, Infinity);
        const shardSizeVariance = shardCount > 1 
          ? shardSizes.reduce((sum, size) => sum + Math.pow(size - avgShardSize, 2), 0) / shardCount
          : 0;
        const shardSizeStdDev = Math.sqrt(shardSizeVariance);
        const shardImbalance = avgShardSize > 0 ? (shardSizeStdDev / avgShardSize) * 100 : 0;
        
        // Check node distribution
        const nodeDistribution = {};
        shardStats.forEach(shard => {
          const node = shard.node || 'unassigned';
          nodeDistribution[node] = (nodeDistribution[node] || 0) + 1;
        });
        const nodesWithShards = Object.keys(nodeDistribution).length;
        const shardsPerNode = shardCount > 0 ? shardCount / nodesWithShards : 0;
        
        indexAnalysis.push({
          name: indexInfo.name,
          type: indexInfo.type,
          docCount,
          storeSize,
          indexingOps,
          indexingTime,
          avgIndexTime,
          refreshCount,
          refreshTime,
          avgRefreshTime,
          opsPerDoc,
          sizePerDoc,
          shardCount,
          avgShardSize,
          maxShardSize,
          minShardSize,
          shardImbalance,
          nodesWithShards,
          shardsPerNode,
          segmentsCount,
          segmentsMemory,
          nodeDistribution,
        });
        
      } catch (error) {
        if (error.meta?.statusCode !== 404) {
          console.error(`Error analyzing ${indexInfo.name}: ${error.message}`);
        }
      }
    }
    
    // Display analysis
    for (const analysis of indexAnalysis) {
      console.log(`\n${analysis.name} (${analysis.type})`);
      console.log('─'.repeat(80));
      
      console.log(`\n  Documents & Storage:`);
      console.log(`    Documents: ${analysis.docCount.toLocaleString()}`);
      console.log(`    Storage: ${formatBytes(analysis.storeSize)}`);
      console.log(`    Size per Document: ${formatBytes(analysis.sizePerDoc)}`);
      
      console.log(`\n  Write Performance:`);
      console.log(`    Total Operations: ${analysis.indexingOps.toLocaleString()}`);
      console.log(`    Total Indexing Time: ${formatTime(analysis.indexingTime)}`);
      console.log(`    Avg Time per Operation: ${formatTime(analysis.avgIndexTime)}`);
      console.log(`    Operations per Document: ${analysis.opsPerDoc.toFixed(2)}`);
      
      // Efficiency rating
      let efficiencyRating = '🟢 EXCELLENT';
      if (analysis.avgIndexTime > 5) {
        efficiencyRating = '🔴 POOR';
      } else if (analysis.avgIndexTime > 2) {
        efficiencyRating = '🟡 MODERATE';
      } else if (analysis.avgIndexTime > 1) {
        efficiencyRating = '🟢 GOOD';
      }
      console.log(`    Efficiency: ${efficiencyRating} (${formatTime(analysis.avgIndexTime)}/op)`);
      
      console.log(`\n  Refresh Performance:`);
      console.log(`    Total Refreshes: ${analysis.refreshCount.toLocaleString()}`);
      console.log(`    Total Refresh Time: ${formatTime(analysis.refreshTime)}`);
      console.log(`    Avg Refresh Time: ${formatTime(analysis.avgRefreshTime)}`);
      console.log(`    Refresh Frequency: ${analysis.refreshCount > 0 ? (3600000 / (analysis.refreshTime / analysis.refreshCount)).toFixed(0) : 0} refreshes/hour`);
      
      console.log(`\n  Shard Configuration:`);
      console.log(`    Shard Count: ${analysis.shardCount}`);
      console.log(`    Nodes with Shards: ${analysis.nodesWithShards}`);
      console.log(`    Shards per Node: ${analysis.shardsPerNode.toFixed(1)}`);
      console.log(`    Avg Shard Size: ${formatBytes(analysis.avgShardSize)}`);
      console.log(`    Max Shard Size: ${formatBytes(analysis.maxShardSize)}`);
      console.log(`    Min Shard Size: ${formatBytes(analysis.minShardSize)}`);
      console.log(`    Shard Size Imbalance: ${analysis.shardImbalance.toFixed(1)}%`);
      
      if (analysis.shardImbalance > 20) {
        console.log(`    ⚠️  WARNING: High shard size imbalance (>20%)`);
      }
      
      if (analysis.avgShardSize > 50 * 1024 * 1024 * 1024) { // >50GB
        console.log(`    🔴 CRITICAL: Very large shards (>50GB)`);
      } else if (analysis.avgShardSize > 20 * 1024 * 1024 * 1024) { // >20GB
        console.log(`    🟡 WARNING: Large shards (>20GB)`);
      }
      
      console.log(`\n  Shard Distribution:`);
      Object.entries(analysis.nodeDistribution).forEach(([node, count]) => {
        console.log(`    ${node}: ${count} shard(s)`);
      });
      
      if (analysis.nodesWithShards === 1) {
        console.log(`    ⚠️  WARNING: All shards on single node (no distribution)`);
      }
      
      console.log(`\n  Segments:`);
      console.log(`    Segment Count: ${analysis.segmentsCount.toLocaleString()}`);
      console.log(`    Segments Memory: ${formatBytes(analysis.segmentsMemory)}`);
      
      if (analysis.segmentsCount > 10000) {
        console.log(`    ⚠️  WARNING: High segment count (may need optimization)`);
      }
    }
    
    // 2. Comparative Analysis
    console.log('\n\n2. COMPARATIVE EFFICIENCY ANALYSIS');
    console.log('-'.repeat(80));
    
    if (indexAnalysis.length >= 2) {
      const executions = indexAnalysis.find(a => a.name === WORKFLOWS_EXECUTIONS_INDEX);
      const stepExecutions = indexAnalysis.find(a => a.name === WORKFLOWS_STEP_EXECUTIONS_INDEX);
      const eventLogs = indexAnalysis.find(a => a.name === EVENT_LOGS_DATA_STREAM);
      
      if (executions && stepExecutions && eventLogs) {
        console.log('\n  Write Efficiency (Time per Operation):');
        console.log(`    Event Logs: ${formatTime(eventLogs.avgIndexTime)}/op`);
        console.log(`    Executions: ${formatTime(executions.avgIndexTime)}/op`);
        console.log(`    Step Executions: ${formatTime(stepExecutions.avgIndexTime)}/op`);
        
        const fastest = [eventLogs, executions, stepExecutions].sort((a, b) => a.avgIndexTime - b.avgIndexTime)[0];
        console.log(`    ✅ Most Efficient: ${fastest.name} (${formatTime(fastest.avgIndexTime)}/op)`);
        
        console.log('\n  Operations per Document:');
        console.log(`    Event Logs: ${eventLogs.opsPerDoc.toFixed(2)} ops/doc`);
        console.log(`    Executions: ${executions.opsPerDoc.toFixed(2)} ops/doc`);
        console.log(`    Step Executions: ${stepExecutions.opsPerDoc.toFixed(2)} ops/doc`);
        console.log(`    → Lower is better (fewer updates per document)`);
        
        console.log('\n  Shard Efficiency:');
        console.log(`    Event Logs: ${eventLogs.shardCount} shards, ${formatBytes(eventLogs.avgShardSize)}/shard`);
        console.log(`    Executions: ${executions.shardCount} shards, ${formatBytes(executions.avgShardSize)}/shard`);
        console.log(`    Step Executions: ${stepExecutions.shardCount} shards, ${formatBytes(stepExecutions.avgShardSize)}/shard`);
        
        const bestSharded = [eventLogs, executions, stepExecutions]
          .filter(a => a.shardCount > 0)
          .sort((a, b) => {
            // Prefer more shards, but smaller average size
            const aScore = a.shardCount / (a.avgShardSize / (1024 * 1024 * 1024)); // shards per GB
            const bScore = b.shardCount / (b.avgShardSize / (1024 * 1024 * 1024));
            return bScore - aScore;
          })[0];
        console.log(`    ✅ Best Sharded: ${bestSharded.name} (${bestSharded.shardCount} shards, ${formatBytes(bestSharded.avgShardSize)}/shard)`);
        
        console.log('\n  Refresh Efficiency:');
        console.log(`    Event Logs: ${formatTime(eventLogs.avgRefreshTime)}/refresh`);
        console.log(`    Executions: ${formatTime(executions.avgRefreshTime)}/refresh`);
        console.log(`    Step Executions: ${formatTime(stepExecutions.avgRefreshTime)}/refresh`);
        
        const fastestRefresh = [eventLogs, executions, stepExecutions].sort((a, b) => a.avgRefreshTime - b.avgRefreshTime)[0];
        console.log(`    ✅ Fastest Refresh: ${fastestRefresh.name} (${formatTime(fastestRefresh.avgRefreshTime)}/refresh)`);
      }
    }
    
    // 3. Data Stream vs Single Index Comparison
    console.log('\n\n3. DATA STREAM vs SINGLE INDEX EFFICIENCY');
    console.log('-'.repeat(80));
    
    const eventLogs = indexAnalysis.find(a => a.name === EVENT_LOGS_DATA_STREAM);
    const executions = indexAnalysis.find(a => a.name === WORKFLOWS_EXECUTIONS_INDEX);
    
    if (eventLogs && executions) {
      console.log('\n  Data Stream Advantages:');
      console.log(`    ✅ Automatic time-based rollover (better for large datasets)`);
      console.log(`    ✅ Better ILM support (easier data retention)`);
      console.log(`    ✅ Distributed across multiple backing indices`);
      
      console.log('\n  Performance Comparison:');
      const eventLogsEfficiency = eventLogs.indexingOps > 0 
        ? (eventLogs.indexingTime / eventLogs.indexingOps) 
        : 0;
      const executionsEfficiency = executions.indexingOps > 0
        ? (executions.indexingTime / executions.indexingOps)
        : 0;
      
      console.log(`    Event Logs (Data Stream): ${formatTime(eventLogsEfficiency)}/op`);
      console.log(`    Executions (Single Index): ${formatTime(executionsEfficiency)}/op`);
      
      if (eventLogsEfficiency < executionsEfficiency) {
        const improvement = ((executionsEfficiency - eventLogsEfficiency) / executionsEfficiency) * 100;
        console.log(`    ✅ Data Stream is ${improvement.toFixed(1)}% faster per operation`);
      } else {
        const slowdown = ((eventLogsEfficiency - executionsEfficiency) / executionsEfficiency) * 100;
        console.log(`    ⚠️  Data Stream is ${slowdown.toFixed(1)}% slower per operation`);
      }
      
      console.log('\n  Shard Distribution:');
      console.log(`    Event Logs: ${eventLogs.shardCount} shards across ${eventLogs.nodesWithShards} nodes`);
      console.log(`    Executions: ${executions.shardCount} shards across ${executions.nodesWithShards} nodes`);
      
      if (eventLogs.shardCount > executions.shardCount) {
        console.log(`    ✅ Event Logs has better shard distribution (more shards)`);
      } else {
        console.log(`    ⚠️  Executions has fewer shards (potential bottleneck)`);
      }
    }
    
    // 4. Actual Memory/CPU Impact
    console.log('\n\n4. ACTUAL RESOURCE IMPACT');
    console.log('-'.repeat(80));
    
    // Calculate weighted impact (operations × time per operation)
    for (const analysis of indexAnalysis) {
      const totalTime = analysis.indexingTime;
      const totalOps = analysis.indexingOps;
      const weightedImpact = totalTime; // Total time spent indexing
      
      console.log(`\n  ${analysis.name}:`);
      console.log(`    Total Indexing Time: ${formatTime(totalTime)}`);
      console.log(`    % of Total Indexing Time: ${indexAnalysis.reduce((sum, a) => sum + a.indexingTime, 0) > 0 
        ? ((totalTime / indexAnalysis.reduce((sum, a) => sum + a.indexingTime, 0)) * 100).toFixed(1) 
        : 0}%`);
      console.log(`    Operations: ${totalOps.toLocaleString()}`);
      console.log(`    Time per 1M Operations: ${formatTime((totalTime / totalOps) * 1000000)}`);
    }
    
    // 5. Write Pattern Impact
    console.log('\n\n5. WRITE PATTERN IMPACT ANALYSIS');
    console.log('-'.repeat(80));
    
    const eventLogsAnalysis = indexAnalysis.find(a => a.name === EVENT_LOGS_DATA_STREAM);
    const executionsAnalysis = indexAnalysis.find(a => a.name === WORKFLOWS_EXECUTIONS_INDEX);
    
    if (eventLogsAnalysis && executionsAnalysis) {
      console.log('\n  Event Logs (Immediate per-step flushes):');
      console.log(`    - Write Pattern: Immediate, constant stream`);
      console.log(`    - Advantage: Low latency (events visible immediately)`);
      console.log(`    - Disadvantage: No batching, constant write load`);
      console.log(`    - Efficiency: ${formatTime(eventLogsAnalysis.avgIndexTime)}/op`);
      console.log(`    - Impact: Constant background writes`);
      
      console.log('\n  Executions (Batched every 500ms):');
      console.log(`    - Write Pattern: Batched, periodic spikes`);
      console.log(`    - Advantage: Batching efficiency, fewer operations`);
      console.log(`    - Disadvantage: Write spikes every 500ms`);
      console.log(`    - Efficiency: ${formatTime(executionsAnalysis.avgIndexTime)}/op`);
      console.log(`    - Impact: Periodic write spikes`);
      
      const eventLogsTotalTime = eventLogsAnalysis.indexingTime;
      const executionsTotalTime = executionsAnalysis.indexingTime;
      const eventLogsOps = eventLogsAnalysis.indexingOps;
      const executionsOps = executionsAnalysis.indexingOps;
      
      console.log('\n  Efficiency Comparison:');
      console.log(`    Event Logs: ${eventLogsOps.toLocaleString()} ops in ${formatTime(eventLogsTotalTime)}`);
      console.log(`    Executions: ${executionsOps.toLocaleString()} ops in ${formatTime(executionsTotalTime)}`);
      
      const eventLogsTimePerMillion = (eventLogsTotalTime / eventLogsOps) * 1000000;
      const executionsTimePerMillion = (executionsTotalTime / executionsOps) * 1000000;
      
      console.log(`    Event Logs: ${formatTime(eventLogsTimePerMillion)} per 1M operations`);
      console.log(`    Executions: ${formatTime(executionsTimePerMillion)} per 1M operations`);
      
      if (eventLogsTimePerMillion < executionsTimePerMillion) {
        const improvement = ((executionsTimePerMillion - eventLogsTimePerMillion) / executionsTimePerMillion) * 100;
        console.log(`    ✅ Event Logs are ${improvement.toFixed(1)}% more efficient per operation`);
      } else {
        const slowdown = ((eventLogsTimePerMillion - executionsTimePerMillion) / executionsTimePerMillion) * 100;
        console.log(`    ⚠️  Event Logs are ${slowdown.toFixed(1)}% less efficient per operation`);
      }
    }
    
    // 6. Final Conclusions
    console.log('\n\n6. CORRECTED CONCLUSIONS');
    console.log('-'.repeat(80));
    
    const totalIndexingTime = indexAnalysis.reduce((sum, a) => sum + a.indexingTime, 0);
    
    console.log('\n  Actual Resource Impact (by total indexing time):');
    for (const analysis of indexAnalysis) {
      const percentage = totalIndexingTime > 0 ? (analysis.indexingTime / totalIndexingTime) * 100 : 0;
      console.log(`    ${analysis.name}: ${percentage.toFixed(1)}% of total indexing time`);
    }
    
    console.log('\n  Key Insights:');
    const eventLogsFinal = indexAnalysis.find(a => a.name === EVENT_LOGS_DATA_STREAM);
    const executionsFinal = indexAnalysis.find(a => a.name === WORKFLOWS_EXECUTIONS_INDEX);
    
    if (eventLogsFinal && executionsFinal) {
      const eventLogsImpact = totalIndexingTime > 0 ? (eventLogsFinal.indexingTime / totalIndexingTime) * 100 : 0;
      const executionsImpact = totalIndexingTime > 0 ? (executionsFinal.indexingTime / totalIndexingTime) * 100 : 0;
      
      console.log(`    1. Event Logs: ${eventLogsFinal.indexingOps.toLocaleString()} operations (${eventLogsImpact.toFixed(1)}% of indexing time)`);
      console.log(`    2. Executions: ${executionsFinal.indexingOps.toLocaleString()} operations (${executionsImpact.toFixed(1)}% of indexing time)`);
      
      if (eventLogsImpact > executionsImpact) {
        console.log(`    → Event Logs consume more indexing time despite being data stream`);
      } else {
        console.log(`    → Executions consume more indexing time (less efficient writes)`);
      }
      
      console.log(`\n    3. Shard Efficiency:`);
      if (eventLogsFinal.shardCount > executionsFinal.shardCount) {
        console.log(`       → Event Logs has better shard distribution (${eventLogsFinal.shardCount} vs ${executionsFinal.shardCount} shards)`);
      } else {
        console.log(`       → Both have same shard count, but executions shards are larger`);
      }
      
      console.log(`\n    4. Write Efficiency:`);
      if (eventLogsFinal.avgIndexTime < executionsFinal.avgIndexTime) {
        console.log(`       → Event Logs writes are faster (${formatTime(eventLogsFinal.avgIndexTime)} vs ${formatTime(executionsFinal.avgIndexTime)})`);
      } else {
        console.log(`       → Executions writes are faster (${formatTime(executionsFinal.avgIndexTime)} vs ${formatTime(eventLogsFinal.avgIndexTime)})`);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('Analysis complete');
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

analyzeWriteEfficiency().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

