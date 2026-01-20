#!/usr/bin/env node

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 *
 * This script checks if the event logs index contributes to Elasticsearch load.
 */

const { Client } = require('@elastic/elasticsearch');

// Configuration from command line or environment
const CLUSTER_URL = process.env.CLUSTER_URL || process.argv[2];
const API_KEY = process.env.API_KEY || process.argv[3];

if (!CLUSTER_URL || !API_KEY) {
  console.error('Usage: node check_event_logs_impact.js <cluster_url> <api_key>');
  console.error('   or: CLUSTER_URL=<url> API_KEY=<key> node check_event_logs_impact.js');
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

const EVENT_LOGS_DATA_STREAM = '.workflows-execution-data-stream-logs';
const WORKFLOWS_EXECUTIONS_INDEX = '.workflows-executions';
const WORKFLOWS_STEP_EXECUTIONS_INDEX = '.workflows-step-executions';

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

async function checkEventLogsImpact() {
  console.log('='.repeat(80));
  console.log('Event Logs Index Impact Analysis');
  console.log('='.repeat(80));
  console.log(`Cluster URL: ${CLUSTER_URL}\n`);

  try {
    // 1. Check if event logs data stream exists
    console.log('1. EVENT LOGS DATA STREAM STATUS');
    console.log('-'.repeat(80));
    
    let eventLogsExists = false;
    let eventLogsStats = null;
    
    try {
      // Check if data stream exists
      const dataStreams = await client.indices.getDataStream({
        name: EVENT_LOGS_DATA_STREAM,
      });
      
      if (dataStreams.data_streams && dataStreams.data_streams.length > 0) {
        eventLogsExists = true;
        console.log(`   ✓ Data stream exists: ${EVENT_LOGS_DATA_STREAM}`);
        
        // Get actual indices in the data stream
        const backingIndices = dataStreams.data_streams[0].indices || [];
        console.log(`   Backing indices: ${backingIndices.length}`);
        if (backingIndices.length > 0) {
          console.log(`   Latest index: ${backingIndices[backingIndices.length - 1].index_name}`);
        }
        
        // Get stats for the data stream
        const stats = await client.indices.stats({
          index: EVENT_LOGS_DATA_STREAM,
          human: false,
        });
        
        // Aggregate stats across all backing indices
        let totalDocs = 0;
        let totalSize = 0;
        let totalIndexingOps = 0;
        let totalIndexingTime = 0;
        
        for (const [indexName, indexStats] of Object.entries(stats.indices)) {
          totalDocs += indexStats.total?.docs?.count || 0;
          totalSize += indexStats.total?.store?.size_in_bytes || 0;
          totalIndexingOps += indexStats.total?.indexing?.index_total || 0;
          totalIndexingTime += indexStats.total?.indexing?.index_time_in_millis || 0;
        }
        
        eventLogsStats = {
          docCount: totalDocs,
          storeSize: totalSize,
          indexingOps: totalIndexingOps,
          indexingTime: totalIndexingTime,
        };
      }
    } catch (error) {
      if (error.meta?.statusCode === 404) {
        console.log(`   ⚠️  Data stream does not exist: ${EVENT_LOGS_DATA_STREAM}`);
        console.log(`   → Event logs may not be enabled or no logs have been written yet\n`);
      } else {
        throw error;
      }
    }
    
    if (!eventLogsExists) {
      console.log('\n   📊 Impact: NONE (data stream does not exist)\n');
    } else {
      console.log(`\n   Document Count: ${eventLogsStats.docCount.toLocaleString()}`);
      console.log(`   Store Size: ${formatBytes(eventLogsStats.storeSize)}`);
      console.log(`   Total Indexing Operations: ${eventLogsStats.indexingOps.toLocaleString()}`);
      console.log(`   Total Indexing Time: ${(eventLogsStats.indexingTime / 1000).toFixed(2)}s\n`);
    }

    // 2. Compare with execution indices
    console.log('2. COMPARISON WITH EXECUTION INDICES');
    console.log('-'.repeat(80));
    
    const executionStats = await client.indices.stats({
      index: [WORKFLOWS_EXECUTIONS_INDEX, WORKFLOWS_STEP_EXECUTIONS_INDEX],
      human: false,
    });
    
    let totalExecutionDocs = 0;
    let totalExecutionSize = 0;
    let totalExecutionOps = 0;
    
    for (const [indexName, indexStats] of Object.entries(executionStats.indices)) {
      totalExecutionDocs += indexStats.total?.docs?.count || 0;
      totalExecutionSize += indexStats.total?.store?.size_in_bytes || 0;
      totalExecutionOps += indexStats.total?.indexing?.index_total || 0;
    }
    
    console.log(`Execution Indices:`);
    console.log(`   Documents: ${totalExecutionDocs.toLocaleString()}`);
    console.log(`   Size: ${formatBytes(totalExecutionSize)}`);
    console.log(`   Indexing Operations: ${totalExecutionOps.toLocaleString()}\n`);
    
    if (eventLogsStats) {
      console.log(`Event Logs Index:`);
      console.log(`   Documents: ${eventLogsStats.docCount.toLocaleString()}`);
      console.log(`   Size: ${formatBytes(eventLogsStats.storeSize)}`);
      console.log(`   Indexing Operations: ${eventLogsStats.indexingOps.toLocaleString()}\n`);
      
      const docRatio = (eventLogsStats.docCount / totalExecutionDocs) * 100;
      const sizeRatio = (eventLogsStats.storeSize / totalExecutionSize) * 100;
      const opsRatio = (eventLogsStats.indexingOps / totalExecutionOps) * 100;
      
      console.log(`Comparison:`);
      console.log(`   Event Logs / Execution Docs: ${docRatio.toFixed(1)}%`);
      console.log(`   Event Logs / Execution Size: ${sizeRatio.toFixed(1)}%`);
      console.log(`   Event Logs / Execution Ops: ${opsRatio.toFixed(1)}%\n`);
    }

    // 3. Analyze write patterns (last 24 hours)
    console.log('3. WRITE PATTERNS (Last 24 Hours)');
    console.log('-'.repeat(80));
    
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    if (eventLogsExists) {
      try {
        const eventLogsByHour = await client.search({
          index: EVENT_LOGS_DATA_STREAM,
          size: 0,
          query: {
            range: {
              '@timestamp': {
                gte: twentyFourHoursAgo.toISOString(),
              },
            },
          },
          aggs: {
            events_by_hour: {
              date_histogram: {
                field: '@timestamp',
                calendar_interval: '1h',
                min_doc_count: 0,
              },
            },
          },
        });
        
        const buckets = eventLogsByHour.aggregations?.events_by_hour?.buckets || [];
        if (buckets.length > 0) {
          const totalEvents = buckets.reduce((sum, b) => sum + b.doc_count, 0);
          const avgPerHour = totalEvents / buckets.length;
          const maxPerHour = Math.max(...buckets.map(b => b.doc_count));
          
          console.log(`   Total Events (24h): ${totalEvents.toLocaleString()}`);
          console.log(`   Average per Hour: ${avgPerHour.toFixed(0)}`);
          console.log(`   Peak Hour: ${maxPerHour.toLocaleString()}`);
          console.log(`   Events per Second (peak): ${(maxPerHour / 3600).toFixed(0)}\n`);
        } else {
          console.log(`   No events found in last 24 hours\n`);
        }
      } catch (error) {
        console.log(`   ⚠️  Could not analyze write patterns: ${error.message}\n`);
      }
    } else {
      console.log(`   N/A (data stream does not exist)\n`);
    }

    // 4. Impact Assessment
    console.log('4. IMPACT ASSESSMENT');
    console.log('-'.repeat(80));
    
    if (!eventLogsExists) {
      console.log('   ✅ Event logs data stream does not exist');
      console.log('   → No impact on Elasticsearch load\n');
    } else if (eventLogsStats) {
      const opsRatio = (eventLogsStats.indexingOps / totalExecutionOps) * 100;
      const sizeRatio = (eventLogsStats.storeSize / totalExecutionSize) * 100;
      
      console.log(`   Event Logs Contribution:`);
      console.log(`   - Indexing Operations: ${opsRatio.toFixed(1)}% of total`);
      console.log(`   - Storage Size: ${sizeRatio.toFixed(1)}% of total\n`);
      
      if (opsRatio > 50) {
        console.log('   🔴 HIGH IMPACT: Event logs account for >50% of indexing operations');
        console.log('   → Significant contributor to write load\n');
      } else if (opsRatio > 25) {
        console.log('   🟡 MODERATE IMPACT: Event logs account for 25-50% of indexing operations');
        console.log('   → Noticeable contributor to write load\n');
      } else if (opsRatio > 10) {
        console.log('   🟢 LOW-MODERATE IMPACT: Event logs account for 10-25% of indexing operations');
        console.log('   → Minor contributor to write load\n');
      } else {
        console.log('   ✅ LOW IMPACT: Event logs account for <10% of indexing operations');
        console.log('   → Minimal contributor to write load\n');
      }
      
      // Check if event logs are being written frequently
      if (eventLogsStats.indexingOps > 0) {
        const avgOpsPerDoc = eventLogsStats.indexingOps / eventLogsStats.docCount;
        console.log(`   Average Operations per Document: ${avgOpsPerDoc.toFixed(2)}`);
        if (avgOpsPerDoc > 1.5) {
          console.log('   ⚠️  WARNING: High operations per document (frequent updates?)\n');
        }
      }
    }

    // 5. Recommendations
    console.log('5. RECOMMENDATIONS');
    console.log('-'.repeat(80));
    
    if (!eventLogsExists) {
      console.log('   - Event logs are not being written (data stream does not exist)');
      console.log('   - No optimization needed for event logs\n');
    } else if (eventLogsStats) {
      const opsRatio = (eventLogsStats.indexingOps / totalExecutionOps) * 100;
      
      if (opsRatio > 25) {
        console.log('   ⚠️  Event logs are a significant contributor to write load');
        console.log('   Recommendations:');
        console.log('   1. Consider reducing event log verbosity (fewer log events)');
        console.log('   2. Batch event log writes more aggressively');
        console.log('   3. Consider disabling event logs for non-critical workflows');
        console.log('   4. Use ILM to automatically delete old event logs\n');
      } else {
        console.log('   ✅ Event logs have minimal impact on write load');
        console.log('   - Current write volume is acceptable');
        console.log('   - Focus optimization efforts on execution indices\n');
      }
    }

    console.log('='.repeat(80));
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

checkEventLogsImpact().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

