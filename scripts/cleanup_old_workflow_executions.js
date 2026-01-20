#!/usr/bin/env node

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 *
 * This script deletes old workflow executions based on the createdAt field.
 * Since workflow indices are not time-based, this provides more precise
 * control than ILM for data retention.
 */

const { Client } = require('@elastic/elasticsearch');

// Configuration from command line or environment
const CLUSTER_URL = process.env.CLUSTER_URL || process.argv[2];
const API_KEY = process.env.API_KEY || process.argv[3];
const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || process.argv.find(arg => arg.startsWith('--retention='))?.split('=')[1] || '30', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || process.argv.find(arg => arg.startsWith('--batch-size='))?.split('=')[1] || '1000', 10);

if (!CLUSTER_URL || !API_KEY) {
  console.error('Usage: node cleanup_old_workflow_executions.js <cluster_url> <api_key> [options]');
  console.error('   or: CLUSTER_URL=<url> API_KEY=<key> node cleanup_old_workflow_executions.js [options]');
  console.error('\nOptions:');
  console.error('  --dry-run              Show what would be deleted without deleting');
  console.error('  --retention=<days>     Number of days to retain data (default: 30)');
  console.error('  --batch-size=<num>     Number of documents to delete per batch (default: 1000)');
  console.error('\nExample:');
  console.error('  node cleanup_old_workflow_executions.js <url> <key> --retention=90 --dry-run');
  process.exit(1);
}

// Create Elasticsearch client
const client = new Client({
  node: CLUSTER_URL,
  auth: {
    apiKey: API_KEY,
  },
  requestTimeout: 300000, // 5 minutes for large deletions
  tls: {
    rejectUnauthorized: false,
  },
});

const WORKFLOW_INDICES = [
  '.workflows-executions',
  '.workflows-step-executions',
];

async function countOldDocuments(indexName, retentionDays) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffISO = cutoffDate.toISOString();

  try {
    const response = await client.count({
      index: indexName,
      query: {
        range: {
          createdAt: {
            lt: cutoffISO,
          },
        },
      },
    });
    return response.count;
  } catch (error) {
    if (error.meta?.statusCode === 404) {
      return 0;
    }
    throw error;
  }
}

async function deleteOldDocuments(indexName, retentionDays, batchSize) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffISO = cutoffDate.toISOString();

  try {
    const response = await client.deleteByQuery({
      index: indexName,
      query: {
        range: {
          createdAt: {
            lt: cutoffISO,
          },
        },
      },
      conflicts: 'proceed', // Continue even if there are version conflicts
      refresh: false, // Don't refresh after deletion (better performance)
      max_docs: batchSize, // Limit batch size
      wait_for_completion: true,
    });

    return {
      deleted: response.deleted || 0,
      batches: response.batches || 0,
      version_conflicts: response.version_conflicts || 0,
      total: response.total || 0,
    };
  } catch (error) {
    if (error.meta?.statusCode === 404) {
      return { deleted: 0, batches: 0, version_conflicts: 0, total: 0 };
    }
    throw error;
  }
}

async function cleanupOldExecutions() {
  console.log('='.repeat(80));
  console.log('Workflow Execution Cleanup');
  console.log('='.repeat(80));
  console.log(`Cluster URL: ${CLUSTER_URL}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no deletions will be made)' : 'DELETE OLD EXECUTIONS'}`);
  console.log(`Retention Period: ${RETENTION_DAYS} days`);
  console.log(`Batch Size: ${BATCH_SIZE} documents per batch\n`);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
  console.log(`Cutoff Date: ${cutoffDate.toISOString()}`);
  console.log(`   (Documents older than this will be ${DRY_RUN ? 'marked for deletion' : 'deleted'})\n`);

  try {
    let totalOldDocs = 0;
    let totalDeleted = 0;

    for (const indexName of WORKFLOW_INDICES) {
      console.log('='.repeat(80));
      console.log(`Index: ${indexName}`);
      console.log('='.repeat(80));

      // Check if index exists
      const exists = await client.indices.exists({ index: indexName });
      if (!exists) {
        console.log(`⚠️  Index does not exist. Skipping.\n`);
        continue;
      }

      // Count old documents
      console.log('1. Counting old documents...');
      const oldCount = await countOldDocuments(indexName, RETENTION_DAYS);
      totalOldDocs += oldCount;
      console.log(`   Found ${oldCount.toLocaleString()} documents older than ${RETENTION_DAYS} days`);

      if (oldCount === 0) {
        console.log('   ✓ No old documents to clean up\n');
        continue;
      }

      // Get total document count for context
      try {
        const stats = await client.indices.stats({ index: indexName });
        const totalDocs = stats.indices[indexName]?.total?.docs?.count || 0;
        const percentage = totalDocs > 0 ? ((oldCount / totalDocs) * 100).toFixed(2) : 0;
        console.log(`   (${percentage}% of total ${totalDocs.toLocaleString()} documents)`);
      } catch (error) {
        // Ignore stats errors
      }

      // Delete old documents
      if (!DRY_RUN) {
        console.log('\n2. Deleting old documents...');
        console.log(`   Processing in batches of ${BATCH_SIZE}...`);
        
        let deleted = 0;
        let batches = 0;
        let hasMore = true;

        while (hasMore) {
          const result = await deleteOldDocuments(indexName, RETENTION_DAYS, BATCH_SIZE);
          deleted += result.deleted;
          batches += result.batches;

          console.log(`   Batch ${batches}: Deleted ${result.deleted.toLocaleString()} documents`);
          
          // Check if we've deleted everything
          if (result.deleted === 0 || result.deleted < batchSize) {
            hasMore = false;
          }

          // Safety check: don't run forever
          if (batches > 1000) {
            console.log('   ⚠️  Reached maximum batch limit (1000). Stopping.');
            hasMore = false;
          }
        }

        totalDeleted += deleted;
        console.log(`\n   ✓ Deleted ${deleted.toLocaleString()} documents in ${batches} batches`);
      } else {
        console.log('\n2. [DRY RUN] Would delete old documents...');
        console.log(`   Would process approximately ${Math.ceil(oldCount / BATCH_SIZE)} batches`);
      }

      console.log('');
    }

    // Summary
    console.log('='.repeat(80));
    console.log('Summary');
    console.log('='.repeat(80));
    console.log(`Total old documents found: ${totalOldDocs.toLocaleString()}`);
    if (!DRY_RUN) {
      console.log(`Total documents deleted: ${totalDeleted.toLocaleString()}`);
    } else {
      console.log(`[DRY RUN] Would delete: ${totalOldDocs.toLocaleString()} documents`);
    }
    console.log('');

    if (totalOldDocs > 0 && !DRY_RUN) {
      console.log('💡 Recommendations:');
      console.log('   - Monitor index size after cleanup');
      console.log('   - Consider running this script regularly (e.g., daily via cron)');
      console.log('   - Adjust retention period based on business needs');
      console.log('   - Consider implementing ILM for automatic cleanup');
      console.log('');
    }

    console.log('='.repeat(80));
    console.log(DRY_RUN ? 'Dry run complete. Use without --dry-run to delete old executions.' : 'Cleanup complete');
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

cleanupOldExecutions().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

