#!/usr/bin/env node

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 *
 * This script investigates recurring JVM memory pressure issues by analyzing
 * workflow execution patterns, write rates, and timing.
 */

const { Client } = require('@elastic/elasticsearch');

// Configuration from command line or environment
const CLUSTER_URL = process.env.CLUSTER_URL || process.argv[2];
const API_KEY = process.env.API_KEY || process.argv[3];
const HOURS_BACK = parseInt(process.env.HOURS_BACK || process.argv.find(arg => arg.startsWith('--hours='))?.split('=')[1] || '48', 10);

if (!CLUSTER_URL || !API_KEY) {
  console.error('Usage: node investigate_recurring_memory_issue.js <cluster_url> <api_key> [options]');
  console.error('   or: CLUSTER_URL=<url> API_KEY=<key> node investigate_recurring_memory_issue.js [options]');
  console.error('\nOptions:');
  console.error('  --hours=<num>    Number of hours to analyze (default: 48)');
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

async function analyzeExecutionPatterns() {
  console.log('='.repeat(80));
  console.log('Recurring Memory Pressure Investigation');
  console.log('='.repeat(80));
  console.log(`Cluster URL: ${CLUSTER_URL}`);
  console.log(`Analysis Period: Last ${HOURS_BACK} hours\n`);

  try {
    // 1. Analyze execution start times by hour
    console.log('1. WORKFLOW EXECUTION PATTERNS BY HOUR');
    console.log('-'.repeat(80));
    
    const now = new Date();
    const startTime = new Date(now.getTime() - (HOURS_BACK * 60 * 60 * 1000));
    
    const executionByHour = await client.search({
      index: WORKFLOWS_EXECUTIONS_INDEX,
      size: 0,
      query: {
        range: {
          createdAt: {
            gte: startTime.toISOString(),
          },
        },
      },
      aggs: {
        executions_by_hour: {
          date_histogram: {
            field: 'createdAt',
            calendar_interval: '1h',
            min_doc_count: 0,
            extended_bounds: {
              min: startTime.toISOString(),
              max: now.toISOString(),
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

    const buckets = executionByHour.aggregations?.executions_by_hour?.buckets || [];
    
    if (buckets.length === 0) {
      console.log('   No executions found in the specified time period.\n');
    } else {
      console.log('   Executions per hour (sorted by count):\n');
      
      // Sort by count descending
      const sortedBuckets = [...buckets].sort((a, b) => b.doc_count - a.doc_count);
      
      sortedBuckets.forEach((bucket, idx) => {
        const date = new Date(bucket.key_as_string);
        const hour = date.getHours();
        const day = date.toLocaleDateString();
        const count = bucket.doc_count;
        
        // Calculate percentage of total
        const total = buckets.reduce((sum, b) => sum + b.doc_count, 0);
        const percentage = ((count / total) * 100).toFixed(1);
        
        // Get top statuses
        const topStatus = bucket.by_status?.buckets?.[0];
        const topTrigger = bucket.by_trigger?.buckets?.[0];
        
        const marker = idx < 3 ? '🔴' : idx < 6 ? '🟡' : '  ';
        console.log(`${marker} ${day} ${String(hour).padStart(2, '0')}:00 - ${count.toLocaleString().padStart(8)} executions (${percentage}%)`);
        if (topStatus) {
          console.log(`     Top status: ${topStatus.key} (${topStatus.doc_count})`);
        }
        if (topTrigger) {
          console.log(`     Top trigger: ${topTrigger.key} (${topTrigger.doc_count})`);
        }
      });
      
      // Find peak hours
      const peakHours = sortedBuckets.slice(0, 5);
      console.log('\n   🔍 Peak Execution Hours:');
      peakHours.forEach((bucket, idx) => {
        const date = new Date(bucket.key_as_string);
        console.log(`   ${idx + 1}. ${date.toLocaleString()}: ${bucket.doc_count.toLocaleString()} executions`);
      });
    }
    console.log('');

    // 2. Analyze concurrent executions
    console.log('2. CONCURRENT EXECUTION ANALYSIS');
    console.log('-'.repeat(80));
    
    // Find time periods with high concurrent executions
    const concurrentAnalysis = await client.search({
      index: WORKFLOWS_EXECUTIONS_INDEX,
      size: 0,
      query: {
        range: {
          createdAt: {
            gte: startTime.toISOString(),
          },
        },
      },
      aggs: {
        executions_by_minute: {
          date_histogram: {
            field: 'createdAt',
            calendar_interval: '1m',
            min_doc_count: 0,
          },
        },
      },
    });

    const minuteBuckets = concurrentAnalysis.aggregations?.executions_by_minute?.buckets || [];
    const highConcurrencyMinutes = minuteBuckets
      .filter(b => b.doc_count > 100) // More than 100 executions per minute
      .sort((a, b) => b.doc_count - a.doc_count)
      .slice(0, 10);

    if (highConcurrencyMinutes.length > 0) {
      console.log('   High concurrency periods (>100 executions/minute):\n');
      highConcurrencyMinutes.forEach((bucket, idx) => {
        const date = new Date(bucket.key_as_string);
        console.log(`   ${idx + 1}. ${date.toLocaleString()}: ${bucket.doc_count.toLocaleString()} executions/min`);
      });
    } else {
      console.log('   No extremely high concurrency periods found (>100/min)');
      const maxPerMinute = Math.max(...minuteBuckets.map(b => b.doc_count));
      console.log(`   Maximum executions per minute: ${maxPerMinute}`);
    }
    console.log('');

    // 3. Analyze write patterns (step executions)
    console.log('3. STEP EXECUTION WRITE PATTERNS');
    console.log('-'.repeat(80));
    
    const stepExecutionsByHour = await client.search({
      index: WORKFLOWS_STEP_EXECUTIONS_INDEX,
      size: 0,
      query: {
        range: {
          startedAt: {
            gte: startTime.toISOString(),
          },
        },
      },
      aggs: {
        steps_by_hour: {
          date_histogram: {
            field: 'startedAt',
            calendar_interval: '1h',
            min_doc_count: 0,
          },
        },
      },
    });

    const stepBuckets = stepExecutionsByHour.aggregations?.steps_by_hour?.buckets || [];
    if (stepBuckets.length > 0) {
      const sortedStepBuckets = [...stepBuckets].sort((a, b) => b.doc_count - a.doc_count);
      console.log('   Step executions per hour (top 10):\n');
      sortedStepBuckets.slice(0, 10).forEach((bucket, idx) => {
        const date = new Date(bucket.key_as_string);
        const hour = date.getHours();
        const day = date.toLocaleDateString();
        console.log(`   ${idx + 1}. ${day} ${String(hour).padStart(2, '0')}:00 - ${bucket.doc_count.toLocaleString()} step executions`);
      });
    }
    console.log('');

    // 4. Analyze by workflow ID (find problematic workflows)
    console.log('4. TOP WORKFLOWS BY EXECUTION COUNT');
    console.log('-'.repeat(80));
    
    const topWorkflows = await client.search({
      index: WORKFLOWS_EXECUTIONS_INDEX,
      size: 0,
      query: {
        range: {
          createdAt: {
            gte: startTime.toISOString(),
          },
        },
      },
      aggs: {
        by_workflow: {
          terms: {
            field: 'workflowId',
            size: 20,
          },
        },
      },
    });

    const workflowBuckets = topWorkflows.aggregations?.by_workflow?.buckets || [];
    if (workflowBuckets.length > 0) {
      console.log('   Top workflows by execution count:\n');
      workflowBuckets.forEach((bucket, idx) => {
        console.log(`   ${idx + 1}. ${bucket.key}: ${bucket.doc_count.toLocaleString()} executions`);
      });
    }
    console.log('');

    // 5. Summary and recommendations
    console.log('5. SUMMARY & RECOMMENDATIONS');
    console.log('-'.repeat(80));
    
    const totalExecutions = buckets.reduce((sum, b) => sum + b.doc_count, 0);
    const avgPerHour = totalExecutions / (HOURS_BACK || 1);
    const maxPerHour = Math.max(...buckets.map(b => b.doc_count));
    
    console.log(`Total executions in ${HOURS_BACK} hours: ${totalExecutions.toLocaleString()}`);
    console.log(`Average per hour: ${avgPerHour.toFixed(0)}`);
    console.log(`Peak hour: ${maxPerHour.toLocaleString()} executions`);
    console.log(`Peak/Average ratio: ${(maxPerHour / avgPerHour).toFixed(1)}x\n`);

    if (maxPerHour / avgPerHour > 3) {
      console.log('⚠️  WARNING: Significant peak-to-average ratio detected!');
      console.log('   This suggests scheduled workflows causing spikes.\n');
    }

    console.log('💡 Recommendations:');
    console.log('   1. If peaks occur at specific times, consider:');
    console.log('      - Staggering scheduled workflow start times');
    console.log('      - Reducing flush frequency during peak hours');
    console.log('      - Increasing heap size for data nodes');
    console.log('');
    console.log('   2. If specific workflows cause spikes:');
    console.log('      - Optimize those workflows');
    console.log('      - Reduce their execution frequency');
    console.log('      - Batch their operations');
    console.log('');
    console.log('   3. Apply index optimizations:');
    console.log('      - Reduce replicas (halves write operations)');
    console.log('      - Clean up old execution data');
    console.log('      - Increase flush interval in code (500ms → 2-5s)');
    console.log('');

    console.log('='.repeat(80));
    console.log('Investigation complete');
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

analyzeExecutionPatterns().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

