#!/usr/bin/env node

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 *
 * This script investigates the OOM event that occurred at 00:06 on January 18, 2026
 * when node instance-0000000001 ran out of memory and was restarted.
 */

const { Client } = require('@elastic/elasticsearch');

// Configuration from command line or environment
const CLUSTER_URL = process.env.CLUSTER_URL || process.argv[2];
const API_KEY = process.env.API_KEY || process.argv[3];
const OOM_TIME = '2026-01-18T00:06:00Z';
const ANALYSIS_WINDOW_HOURS = 2; // 1 hour before and after

if (!CLUSTER_URL || !API_KEY) {
  console.error('Usage: node investigate_oom_event.js <cluster_url> <api_key>');
  console.error('   or: CLUSTER_URL=<url> API_KEY=<key> node investigate_oom_event.js');
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

async function investigateOOMEvent() {
  console.log('='.repeat(80));
  console.log('OOM Event Investigation: January 18, 2026 00:06');
  console.log('='.repeat(80));
  console.log(`Cluster URL: ${CLUSTER_URL}`);
  console.log(`OOM Time: ${OOM_TIME}`);
  console.log(`Analysis Window: ±${ANALYSIS_WINDOW_HOURS} hours\n`);

  const oomTime = new Date(OOM_TIME);
  const startTime = new Date(oomTime.getTime() - ANALYSIS_WINDOW_HOURS * 60 * 60 * 1000);
  const endTime = new Date(oomTime.getTime() + ANALYSIS_WINDOW_HOURS * 60 * 60 * 1000);

  try {
    // 1. Workflow Executions Around OOM Time
    console.log('1. WORKFLOW EXECUTIONS AROUND OOM TIME');
    console.log('-'.repeat(80));
    
    const executionsByMinute = await client.search({
      index: WORKFLOWS_EXECUTIONS_INDEX,
      size: 0,
      query: {
        range: {
          createdAt: {
            gte: startTime.toISOString(),
            lte: endTime.toISOString(),
          },
        },
      },
      aggs: {
        executions_by_minute: {
          date_histogram: {
            field: 'createdAt',
            calendar_interval: '1m',
            min_doc_count: 0,
            extended_bounds: {
              min: startTime.toISOString(),
              max: endTime.toISOString(),
            },
          },
          aggs: {
            by_status: {
              terms: {
                field: 'status',
                size: 10,
              },
            },
            by_trigger: {
              terms: {
                field: 'triggeredBy',
                size: 10,
              },
            },
          },
        },
      },
    });

    const buckets = executionsByMinute.aggregations?.executions_by_minute?.buckets || [];
    
    console.log(`\n  Executions per minute around OOM time:\n`);
    
    // Find the minute of OOM
    const oomMinute = new Date(oomTime);
    oomMinute.setSeconds(0, 0);
    
    buckets.forEach((bucket) => {
      const bucketTime = new Date(bucket.key_as_string);
      const minutesFromOOM = (bucketTime - oomMinute) / (60 * 1000);
      const count = bucket.doc_count;
      
      const marker = Math.abs(minutesFromOOM) <= 5 ? '🔴' : Math.abs(minutesFromOOM) <= 15 ? '🟡' : '  ';
      const timeLabel = minutesFromOOM === 0 ? 'OOM TIME' : 
                       minutesFromOOM > 0 ? `+${minutesFromOOM}m` : `${minutesFromOOM}m`;
      
      console.log(`${marker} ${bucketTime.toISOString()} (${timeLabel}): ${count.toLocaleString()} executions`);
      
      if (Math.abs(minutesFromOOM) <= 10) {
        const topStatus = bucket.by_status?.buckets?.[0];
        const topTrigger = bucket.by_trigger?.buckets?.[0];
        if (topStatus) {
          console.log(`     Status: ${topStatus.key} (${topStatus.doc_count})`);
        }
        if (topTrigger) {
          console.log(`     Trigger: ${topTrigger.key} (${topTrigger.doc_count})`);
        }
      }
    });
    
    // Find peak around OOM
    const peakBucket = buckets.reduce((max, b) => b.doc_count > max.doc_count ? b : max, buckets[0]);
    if (peakBucket) {
      const peakTime = new Date(peakBucket.key_as_string);
      const minutesFromOOM = (peakTime - oomMinute) / (60 * 1000);
      console.log(`\n  Peak execution minute: ${peakTime.toISOString()} (${minutesFromOOM > 0 ? '+' : ''}${minutesFromOOM.toFixed(0)}m from OOM)`);
      console.log(`  Peak count: ${peakBucket.doc_count.toLocaleString()} executions`);
    }
    console.log('');

    // 2. Step Executions Around OOM Time
    console.log('2. STEP EXECUTIONS AROUND OOM TIME');
    console.log('-'.repeat(80));
    
    const stepExecutionsByMinute = await client.search({
      index: WORKFLOWS_STEP_EXECUTIONS_INDEX,
      size: 0,
      query: {
        range: {
          startedAt: {
            gte: startTime.toISOString(),
            lte: endTime.toISOString(),
          },
        },
      },
      aggs: {
        steps_by_minute: {
          date_histogram: {
            field: 'startedAt',
            calendar_interval: '1m',
            min_doc_count: 0,
          },
        },
      },
    });

    const stepBuckets = stepExecutionsByMinute.aggregations?.steps_by_minute?.buckets || [];
    
    // Find step executions around OOM time
    const oomStepBucket = stepBuckets.find(b => {
      const bucketTime = new Date(b.key_as_string);
      return Math.abs(bucketTime - oomMinute) < 60000; // Within 1 minute
    });
    
    if (oomStepBucket) {
      console.log(`  Step executions at OOM time: ${oomStepBucket.doc_count.toLocaleString()}`);
    }
    
    // Find peak
    const peakStepBucket = stepBuckets.reduce((max, b) => b.doc_count > max.doc_count ? b : max, stepBuckets[0]);
    if (peakStepBucket) {
      const peakTime = new Date(peakStepBucket.key_as_string);
      const minutesFromOOM = (peakTime - oomMinute) / (60 * 1000);
      console.log(`  Peak step executions: ${peakStepBucket.doc_count.toLocaleString()} at ${peakTime.toISOString()} (${minutesFromOOM > 0 ? '+' : ''}${minutesFromOOM.toFixed(0)}m from OOM)`);
    }
    console.log('');

    // 3. Event Logs Around OOM Time
    console.log('3. EVENT LOGS AROUND OOM TIME');
    console.log('-'.repeat(80));
    
    const eventLogsByMinute = await client.search({
      index: EVENT_LOGS_DATA_STREAM,
      size: 0,
      query: {
        range: {
          '@timestamp': {
            gte: startTime.toISOString(),
            lte: endTime.toISOString(),
          },
        },
      },
      aggs: {
        events_by_minute: {
          date_histogram: {
            field: '@timestamp',
            calendar_interval: '1m',
            min_doc_count: 0,
          },
        },
      },
    });

    const eventBuckets = eventLogsByMinute.aggregations?.events_by_minute?.buckets || [];
    
    // Find event logs around OOM time
    const oomEventBucket = eventBuckets.find(b => {
      const bucketTime = new Date(b.key_as_string);
      return Math.abs(bucketTime - oomMinute) < 60000; // Within 1 minute
    });
    
    if (oomEventBucket) {
      console.log(`  Event logs at OOM time: ${oomEventBucket.doc_count.toLocaleString()} events`);
    }
    
    // Find peak
    const peakEventBucket = eventBuckets.reduce((max, b) => b.doc_count > max.doc_count ? b : max, eventBuckets[0]);
    if (peakEventBucket) {
      const peakTime = new Date(peakEventBucket.key_as_string);
      const minutesFromOOM = (peakTime - oomMinute) / (60 * 1000);
      console.log(`  Peak event logs: ${peakEventBucket.doc_count.toLocaleString()} at ${peakTime.toISOString()} (${minutesFromOOM > 0 ? '+' : ''}${minutesFromOOM.toFixed(0)}m from OOM)`);
    }
    console.log('');

    // 4. Concurrent Executions Analysis
    console.log('4. CONCURRENT EXECUTIONS AT OOM TIME');
    console.log('-'.repeat(80));
    
    // Find executions that were RUNNING at OOM time
    const runningAtOOM = await client.search({
      index: WORKFLOWS_EXECUTIONS_INDEX,
      size: 0,
      query: {
        bool: {
          must: [
            {
              range: {
                startedAt: {
                  lte: oomTime.toISOString(),
                },
              },
            },
            {
              bool: {
                should: [
                  { term: { status: 'running' } },
                  { term: { status: 'pending' } },
                ],
                minimum_should_match: 1,
              },
            },
          ],
          must_not: [
            {
              range: {
                finishedAt: {
                  lt: oomTime.toISOString(),
                },
              },
            },
          ],
        },
      },
    });
    
    const runningCount = runningAtOOM.hits.total;
    const runningValue = typeof runningCount === 'number' ? runningCount : runningCount?.value || 0;
    
    console.log(`  Executions RUNNING at OOM time: ${runningValue.toLocaleString()}`);
    console.log(`  → Each running execution flushes every 500ms`);
    console.log(`  → Estimated flushes per second: ${(runningValue / 2).toFixed(0)} (every 500ms)`);
    console.log('');

    // 5. Write Spike Analysis
    console.log('5. WRITE SPIKE ANALYSIS');
    console.log('-'.repeat(80));
    
    // Analyze write patterns in 5-minute windows around OOM
    const writePattern = await client.search({
      index: WORKFLOWS_EXECUTIONS_INDEX,
      size: 0,
      query: {
        range: {
          createdAt: {
            gte: new Date(oomTime.getTime() - 30 * 60 * 1000).toISOString(),
            lte: new Date(oomTime.getTime() + 30 * 60 * 1000).toISOString(),
          },
        },
      },
      aggs: {
        writes_by_5min: {
          date_histogram: {
            field: 'createdAt',
            fixed_interval: '5m',
            min_doc_count: 0,
          },
        },
      },
    });

    const writeBuckets = writePattern.aggregations?.writes_by_5min?.buckets || [];
    
    console.log(`  Write volume in 5-minute windows:\n`);
    writeBuckets.forEach((bucket) => {
      const bucketTime = new Date(bucket.key_as_string);
      const minutesFromOOM = (bucketTime - oomMinute) / (60 * 1000);
      const writesPerSecond = bucket.doc_count / 300; // 5 minutes = 300 seconds
      
      const marker = Math.abs(minutesFromOOM) <= 5 ? '🔴' : Math.abs(minutesFromOOM) <= 15 ? '🟡' : '  ';
      const timeLabel = minutesFromOOM === 0 ? 'OOM TIME' : 
                       minutesFromOOM > 0 ? `+${minutesFromOOM.toFixed(0)}m` : `${minutesFromOOM.toFixed(0)}m`;
      
      console.log(`${marker} ${bucketTime.toISOString()} (${timeLabel}): ${bucket.doc_count.toLocaleString()} writes (${writesPerSecond.toFixed(0)}/sec)`);
    });
    console.log('');

    // 6. Node-Specific Analysis (if possible)
    console.log('6. NODE-SPECIFIC ANALYSIS');
    console.log('-'.repeat(80));
    
    try {
      // Check shard allocation for instance-0000000001
      const shardAllocation = await client.cat.shards({
        index: [WORKFLOWS_EXECUTIONS_INDEX, WORKFLOWS_STEP_EXECUTIONS_INDEX, EVENT_LOGS_DATA_STREAM],
        format: 'json',
        h: 'index,shard,prirep,state,node,store',
      });
      
      const nodeShards = shardAllocation.filter(s => s.node === 'instance-0000000001');
      
      console.log(`  Shards on instance-0000000001 (OOM node):\n`);
      let totalSize = 0;
      nodeShards.forEach(shard => {
        const size = parseInt(shard.store || '0');
        totalSize += size;
        console.log(`    ${shard.index}: ${shard.shard} (${shard.prirep}) - ${formatBytes(size)}`);
      });
      
      console.log(`\n  Total shard size on OOM node: ${formatBytes(totalSize)}`);
      
      if (totalSize > 20 * 1024 * 1024 * 1024) { // >20GB
        console.log(`  ⚠️  WARNING: Large shard size on OOM node (>20GB)`);
      }
    } catch (error) {
      console.log(`  Could not analyze node-specific shards: ${error.message}`);
    }
    console.log('');

    // 7. Timeline Analysis
    console.log('7. TIMELINE AROUND OOM EVENT');
    console.log('-'.repeat(80));
    
    // Create a detailed timeline
    const timelineStart = new Date(oomTime.getTime() - 30 * 60 * 1000); // 30 min before
    const timelineEnd = new Date(oomTime.getTime() + 30 * 60 * 1000); // 30 min after
    
    const timelineExecutions = await client.search({
      index: WORKFLOWS_EXECUTIONS_INDEX,
      size: 0,
      query: {
        range: {
          createdAt: {
            gte: timelineStart.toISOString(),
            lte: timelineEnd.toISOString(),
          },
        },
      },
      aggs: {
        timeline: {
          date_histogram: {
            field: 'createdAt',
            calendar_interval: '1m',
            min_doc_count: 0,
          },
        },
      },
    });

    const timelineBuckets = timelineExecutions.aggregations?.timeline?.buckets || [];
    
    console.log(`  Execution timeline (30 min before/after OOM):\n`);
    console.log(`  Time                  | Executions | Minutes from OOM`);
    console.log(`  ${'-'.repeat(70)}`);
    
    timelineBuckets.forEach((bucket) => {
      const bucketTime = new Date(bucket.key_as_string);
      const minutesFromOOM = (bucketTime - oomMinute) / (60 * 1000);
      const timeStr = bucketTime.toISOString().substring(11, 16); // HH:MM
      const marker = Math.abs(minutesFromOOM) <= 1 ? '🔴' : Math.abs(minutesFromOOM) <= 5 ? '🟡' : '  ';
      
      console.log(`  ${marker} ${timeStr} | ${String(bucket.doc_count).padStart(10)} | ${minutesFromOOM > 0 ? '+' : ''}${minutesFromOOM.toFixed(0)}m`);
    });
    console.log('');

    // 8. Workflow ID Analysis (Which workflows caused the spike?)
    console.log('8. WORKFLOW ID ANALYSIS (Spike Contributors)');
    console.log('-'.repeat(80));
    
    // Analyze which workflow IDs were most active during the spike
    const spikeStart = new Date(oomTime.getTime() - 16 * 60 * 1000); // 23:50
    const spikeEnd = new Date(oomTime.getTime() - 8 * 60 * 1000); // 23:58
    
    const workflowAnalysis = await client.search({
      index: WORKFLOWS_EXECUTIONS_INDEX,
      size: 0,
      query: {
        bool: {
          must: [
            {
              range: {
                createdAt: {
                  gte: spikeStart.toISOString(),
                  lte: spikeEnd.toISOString(),
                },
              },
            },
            {
              term: {
                triggeredBy: 'scheduled',
              },
            },
          ],
        },
      },
      aggs: {
        by_workflow_id: {
          terms: {
            field: 'workflowId',
            size: 20,
            order: {
              _count: 'desc',
            },
          },
          aggs: {
            by_status: {
              terms: {
                field: 'status',
                size: 5,
              },
            },
          },
        },
      },
    });

    const topWorkflows = workflowAnalysis.aggregations?.by_workflow_id?.buckets || [];
    
    // Calculate total spike executions
    const totalSpikeExecutions = topWorkflows.reduce((sum, w) => sum + w.doc_count, 0);
    const peakCount = peakBucket?.doc_count || 5052; // Use known peak from earlier analysis
    
    console.log(`  Top workflows during spike (23:50-23:58):\n`);
    topWorkflows.forEach((workflow, index) => {
      const percentage = ((workflow.doc_count / peakCount) * 100).toFixed(1);
      const spikePercentage = totalSpikeExecutions > 0 ? ((workflow.doc_count / totalSpikeExecutions) * 100).toFixed(1) : '0.0';
      console.log(`  ${index + 1}. Workflow ID: ${workflow.key}`);
      console.log(`     Executions: ${workflow.doc_count.toLocaleString()} (${percentage}% of peak, ${spikePercentage}% of spike)`);
      
      const statuses = workflow.by_status?.buckets || [];
      if (statuses.length > 0) {
        const statusList = statuses.map(s => `${s.key}: ${s.doc_count}`).join(', ');
        console.log(`     Statuses: ${statusList}`);
      }
      console.log('');
    });
    
    if (topWorkflows.length > 0) {
      const topWorkflow = topWorkflows[0];
      const topPercentage = totalSpikeExecutions > 0 ? ((topWorkflow.doc_count / totalSpikeExecutions) * 100).toFixed(1) : '0.0';
      console.log(`  Total spike executions analyzed: ${totalSpikeExecutions.toLocaleString()}`);
      console.log(`  Unique workflows in top 20: ${topWorkflows.length}`);
      console.log(`  Top workflow contribution: ${topPercentage}% of spike`);
      if (topWorkflows.length >= 5) {
        console.log(`  Top 5 workflows contribution: ${((topWorkflows.slice(0, 5).reduce((sum, w) => sum + w.doc_count, 0) / totalSpikeExecutions) * 100).toFixed(1)}%`);
      }
      if (topWorkflows.length >= 10) {
        console.log(`  Top 10 workflows contribution: ${((topWorkflows.slice(0, 10).reduce((sum, w) => sum + w.doc_count, 0) / totalSpikeExecutions) * 100).toFixed(1)}%`);
      }
      console.log(`  Average executions per workflow (top 20): ${(totalSpikeExecutions / topWorkflows.length).toFixed(0)}`);
    }
    console.log('');

    // 9. Root Cause Analysis
    console.log('9. ROOT CAUSE ANALYSIS');
    console.log('-'.repeat(80));
    
    // Calculate write load at OOM time
    const oomWindowStart = new Date(oomTime.getTime() - 5 * 60 * 1000); // 5 min before
    const oomWindowEnd = new Date(oomTime.getTime() + 5 * 60 * 1000); // 5 min after
    
    const oomWindowExecutions = await client.count({
      index: WORKFLOWS_EXECUTIONS_INDEX,
      query: {
        range: {
          createdAt: {
            gte: oomWindowStart.toISOString(),
            lte: oomWindowEnd.toISOString(),
          },
        },
      },
    });
    
    const executionsInWindow = oomWindowExecutions.count;
    const executionsPerSecond = executionsInWindow / 600; // 10 minutes = 600 seconds
    
    console.log(`  Executions in 10-minute window around OOM: ${executionsInWindow.toLocaleString()}`);
    console.log(`  Average executions per second: ${executionsPerSecond.toFixed(0)}/sec`);
    console.log(`  Running executions at OOM: ${runningValue.toLocaleString()}`);
    
    // Calculate estimated write load
    const estimatedWritesPerSecond = runningValue / 2; // Every 500ms
    console.log(`\n  Estimated write load at OOM time:`);
    console.log(`    - New executions: ${executionsPerSecond.toFixed(0)}/sec`);
    console.log(`    - Running execution flushes: ${estimatedWritesPerSecond.toFixed(0)}/sec (every 500ms)`);
    console.log(`    - Total writes/sec: ~${(executionsPerSecond + estimatedWritesPerSecond).toFixed(0)}/sec`);
    console.log(`    - With replicas: ~${((executionsPerSecond + estimatedWritesPerSecond) * 2).toFixed(0)} operations/sec`);
    
    console.log('\n  🔍 Likely Root Causes:');
    console.log(`    1. High concurrent executions (${runningValue.toLocaleString()} running)`);
    console.log(`    2. All flushing every 500ms simultaneously`);
    console.log(`    3. Replica writes doubling the load`);
    console.log(`    4. Large shards on instance-0000000001`);
    console.log(`    5. Refresh operations from frequent writes`);
    console.log('');

    console.log('='.repeat(80));
    console.log('OOM Investigation complete');
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

investigateOOMEvent().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

