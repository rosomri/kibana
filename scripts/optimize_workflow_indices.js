#!/usr/bin/env node

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 *
 * This script optimizes workflow execution indices to reduce Elasticsearch load
 * and memory pressure.
 */

const { Client } = require('@elastic/elasticsearch');

// Configuration from command line or environment
const CLUSTER_URL = process.env.CLUSTER_URL || process.argv[2];
const API_KEY = process.env.API_KEY || process.argv[3];
const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const REDUCE_REPLICAS = process.env.REDUCE_REPLICAS !== 'false' && !process.argv.includes('--keep-replicas');

if (!CLUSTER_URL || !API_KEY) {
  console.error('Usage: node optimize_workflow_indices.js <cluster_url> <api_key> [options]');
  console.error('   or: CLUSTER_URL=<url> API_KEY=<key> node optimize_workflow_indices.js [options]');
  console.error('\nOptions:');
  console.error('  --dry-run        Show what would be changed without applying');
  console.error('  --keep-replicas  Keep current replica count (default: reduce to 0)');
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

const WORKFLOW_INDICES = [
  '.workflows-executions',
  '.workflows-step-executions',
];

// Optimization settings
const OPTIMIZATIONS = {
  refresh_interval: '1s', // Keep at 1s (maximum acceptable refresh interval)
  number_of_replicas: REDUCE_REPLICAS ? 0 : undefined, // Reduce replicas to 0 to halve writes
};

async function getIndexSettings(indexName) {
  try {
    const response = await client.indices.getSettings({
      index: indexName,
      include_defaults: false,
    });
    return response[indexName]?.settings?.index || {};
  } catch (error) {
    if (error.meta?.statusCode === 404) {
      return null; // Index doesn't exist
    }
    throw error;
  }
}

async function getIndexStats(indexName) {
  try {
    const response = await client.indices.stats({
      index: indexName,
      human: false,
    });
    return response.indices[indexName];
  } catch (error) {
    if (error.meta?.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

async function optimizeIndices() {
  console.log('='.repeat(80));
  console.log('Workflow Index Optimization');
  console.log('='.repeat(80));
  console.log(`Cluster URL: ${CLUSTER_URL}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'APPLY OPTIMIZATIONS'}`);
  console.log(`Reduce Replicas: ${REDUCE_REPLICAS ? 'Yes (to 0)' : 'No (keep current)'}\n`);

  try {
    for (const indexName of WORKFLOW_INDICES) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Index: ${indexName}`);
      console.log('='.repeat(80));

      // Check if index exists
      const exists = await client.indices.exists({ index: indexName });
      if (!exists) {
        console.log(`⚠️  Index ${indexName} does not exist. Skipping.\n`);
        continue;
      }

      // Get current settings
      console.log('1. Current Settings:');
      const currentSettings = await getIndexSettings(indexName);
      const currentRefresh = currentSettings.refresh_interval || '1s (default)';
      const currentReplicas = currentSettings.number_of_replicas || '1 (default)';
      
      console.log(`   Refresh Interval: ${currentRefresh}`);
      console.log(`   Number of Replicas: ${currentReplicas}`);

      // Get index stats
      console.log('\n2. Current Statistics:');
      const stats = await getIndexStats(indexName);
      if (stats) {
        const storeSize = stats.total?.store?.size_in_bytes || 0;
        const docCount = stats.total?.docs?.count || 0;
        const shardCount = stats.total?.shard_stats?.total_count || 0;
        
        console.log(`   Document Count: ${docCount.toLocaleString()}`);
        console.log(`   Store Size: ${(storeSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Shard Count: ${shardCount}`);
        
        if (stats.total?.indexing) {
          const indexTotal = stats.total.indexing.index_total || 0;
          const indexTime = stats.total.indexing.index_time_in_millis || 0;
          console.log(`   Total Indexing Operations: ${indexTotal.toLocaleString()}`);
          console.log(`   Total Indexing Time: ${(indexTime / 1000).toFixed(2)}s`);
        }
      }

      // Show proposed changes
      console.log('\n3. Proposed Optimizations:');
      const changes = [];
      
      // Check if refresh interval needs to be set explicitly (if it's not 1s)
      const currentRefreshValue = currentRefresh === '1s' || currentRefresh === '1s (default)' ? '1s' : currentRefresh;
      if (currentRefreshValue !== '1s') {
        console.log(`   → Refresh Interval: ${currentRefresh} → 1s (setting to maximum acceptable)`);
        changes.push({ setting: 'refresh_interval', from: currentRefresh, to: '1s' });
      } else {
        console.log(`   ✓ Refresh Interval: Already at maximum acceptable (1s)`);
      }

      if (REDUCE_REPLICAS) {
        const currentReplicasNum = parseInt(currentReplicas, 10) || 1;
        if (currentReplicasNum > 0) {
          console.log(`   → Number of Replicas: ${currentReplicas} → 0`);
          changes.push({ setting: 'number_of_replicas', from: currentReplicas, to: '0' });
        } else {
          console.log(`   ✓ Number of Replicas: Already optimized (0)`);
        }
      } else {
        console.log(`   → Number of Replicas: Keeping current (${currentReplicas})`);
      }

      if (changes.length === 0) {
        console.log('\n   ✓ No changes needed - index is already optimized\n');
        continue;
      }

      // Apply changes if not dry run
      if (!DRY_RUN) {
        console.log('\n4. Applying optimizations...');
        
        const settingsToApply = {};
        if (changes.find(c => c.setting === 'refresh_interval')) {
          settingsToApply['index.refresh_interval'] = '1s';
        }
        if (REDUCE_REPLICAS && changes.find(c => c.setting === 'number_of_replicas')) {
          settingsToApply['index.number_of_replicas'] = 0;
        }

        try {
          await client.indices.putSettings({
            index: indexName,
            body: {
              index: settingsToApply,
            },
          });
          console.log('   ✓ Settings applied successfully\n');

          // Verify changes
          console.log('5. Verifying changes...');
          const verifySettings = await getIndexSettings(indexName);
          const verifyRefresh = verifySettings.refresh_interval || '1s';
          const verifyReplicas = verifySettings.number_of_replicas || '1';
          
          let allApplied = true;
          if (changes.find(c => c.setting === 'refresh_interval')) {
            if (verifyRefresh === '1s') {
              console.log(`   ✓ Refresh interval verified: ${verifyRefresh}`);
            } else {
              console.log(`   ✗ Refresh interval mismatch: Expected 1s, got ${verifyRefresh}`);
              allApplied = false;
            }
          }
          
          if (REDUCE_REPLICAS && changes.find(c => c.setting === 'number_of_replicas')) {
            if (verifyReplicas === '0') {
              console.log(`   ✓ Replica count verified: ${verifyReplicas}`);
            } else {
              console.log(`   ✗ Replica count mismatch: Expected 0, got ${verifyReplicas}`);
              allApplied = false;
            }
          }
          
          if (allApplied) {
            console.log('   ✓ All optimizations verified\n');
          }
        } catch (error) {
          console.error(`   ✗ Failed to apply settings: ${error.message}\n`);
          if (error.meta?.body) {
            console.error(`   Details: ${JSON.stringify(error.meta.body, null, 2)}\n`);
          }
        }
      } else {
        console.log('\n4. [DRY RUN] Skipping application of settings\n');
      }
    }

    // Show ILM recommendation
    console.log('\n' + '='.repeat(80));
    console.log('Additional Recommendations');
    console.log('='.repeat(80));
    console.log('\n1. Index Lifecycle Management (ILM):');
    console.log('   Consider implementing ILM policies to automatically delete old execution data.');
    console.log('   This prevents indices from growing indefinitely.');
    console.log('   See: scripts/workflow_index_optimizations.md for ILM policy examples.\n');
    
    console.log('2. Code-Level Optimizations:');
    console.log('   - Increase flush interval from 500ms to 2-5 seconds');
    console.log('   - Batch step execution updates more aggressively');
    console.log('   - Use _source filtering in queries');
    console.log('   See: scripts/workflow_index_optimizations.md for details.\n');

    console.log('3. Expected Impact:');
    console.log('   - Write operations: ~50% reduction (from removing replicas)');
    console.log('   - Memory pressure: Reduction from fewer replica writes');
    console.log('   - Recovery time: Faster (fewer replica shards to recover)');
    console.log('   - Storage: 50% reduction (no replica data)');
    console.log('   - Search latency: No change (refresh interval stays at 1s)\n');

    console.log('='.repeat(80));
    console.log(DRY_RUN ? 'Dry run complete. Use without --dry-run to apply optimizations.' : 'Optimizations applied successfully');
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

optimizeIndices().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

