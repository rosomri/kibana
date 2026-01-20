#!/usr/bin/env node

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 *
 * This script sets up Index Lifecycle Management (ILM) policies for workflow
 * execution indices to automatically manage data retention and prevent
 * indefinite growth.
 */

const { Client } = require('@elastic/elasticsearch');

// Configuration from command line or environment
const CLUSTER_URL = process.env.CLUSTER_URL || process.argv[2];
const API_KEY = process.env.API_KEY || process.argv[3];
const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || process.argv.find(arg => arg.startsWith('--retention='))?.split('=')[1] || '30', 10);

if (!CLUSTER_URL || !API_KEY) {
  console.error('Usage: node setup_workflow_ilm.js <cluster_url> <api_key> [options]');
  console.error('   or: CLUSTER_URL=<url> API_KEY=<key> node setup_workflow_ilm.js [options]');
  console.error('\nOptions:');
  console.error('  --dry-run              Show what would be created without applying');
  console.error('  --retention=<days>     Number of days to retain data (default: 30)');
  console.error('                         Example: --retention=90');
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

const ILM_POLICY_NAME = 'workflow-executions-policy';

/**
 * Creates an ILM policy that:
 * - Keeps data in hot phase (active use)
 * - Moves to warm phase after retention period
 * - Deletes data after retention period
 */
function createILMPolicy(retentionDays) {
  return {
    policy: {
      phases: {
        hot: {
          min_age: '0ms',
          actions: {
            set_priority: {
              priority: 100,
            },
          },
        },
        delete: {
          min_age: `${retentionDays}d`,
          actions: {
            delete: {},
          },
        },
      },
    },
  };
}

async function checkILMPolicyExists() {
  try {
    const response = await client.ilm.getLifecycle({
      name: ILM_POLICY_NAME,
    });
    return response[ILM_POLICY_NAME] !== undefined;
  } catch (error) {
    if (error.meta?.statusCode === 404) {
      return false;
    }
    throw error;
  }
}

async function getIndexILMSettings(indexName) {
  try {
    const response = await client.indices.getSettings({
      index: indexName,
      include_defaults: false,
    });
    const settings = response[indexName]?.settings?.index || {};
    return {
      lifecycleName: settings['lifecycle.name'],
      lifecycleRolloverAlias: settings['lifecycle.rollover_alias'],
    };
  } catch (error) {
    if (error.meta?.statusCode === 404) {
      return null;
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

async function setupILM() {
  console.log('='.repeat(80));
  console.log('Workflow Index Lifecycle Management (ILM) Setup');
  console.log('='.repeat(80));
  console.log(`Cluster URL: ${CLUSTER_URL}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'APPLY ILM POLICIES'}`);
  console.log(`Retention Period: ${RETENTION_DAYS} days`);
  console.log(`Policy Name: ${ILM_POLICY_NAME}\n`);

  try {
    // Step 1: Check if ILM policy exists
    console.log('1. Checking ILM Policy');
    console.log('-'.repeat(80));
    const policyExists = await checkILMPolicyExists();
    
    if (policyExists) {
      console.log(`   ✓ ILM policy "${ILM_POLICY_NAME}" already exists`);
      if (!DRY_RUN) {
        console.log('   → Will update existing policy\n');
      } else {
        console.log('   → Would update existing policy\n');
      }
    } else {
      console.log(`   → ILM policy "${ILM_POLICY_NAME}" does not exist`);
      if (!DRY_RUN) {
        console.log('   → Will create new policy\n');
      } else {
        console.log('   → Would create new policy\n');
      }
    }

    // Step 2: Create/Update ILM Policy
    console.log('2. ILM Policy Configuration');
    console.log('-'.repeat(80));
    const policy = createILMPolicy(RETENTION_DAYS);
    
    console.log('   Policy Structure:');
    console.log('   - Hot Phase:');
    console.log('     * Min Age: 0ms (immediate)');
    console.log('     * Priority: 100 (high priority for active data)');
    console.log('   - Delete Phase:');
    console.log(`     * Min Age: ${RETENTION_DAYS} days`);
    console.log('     * Action: Delete index');
    console.log(`   → Data older than ${RETENTION_DAYS} days will be automatically deleted\n`);

    if (!DRY_RUN) {
      try {
        await client.ilm.putLifecycle({
          name: ILM_POLICY_NAME,
          body: policy,
        });
        console.log(`   ✓ ILM policy "${ILM_POLICY_NAME}" ${policyExists ? 'updated' : 'created'} successfully\n`);
      } catch (error) {
        console.error(`   ✗ Failed to ${policyExists ? 'update' : 'create'} ILM policy: ${error.message}\n`);
        if (error.meta?.body) {
          console.error(`   Details: ${JSON.stringify(error.meta.body, null, 2)}\n`);
        }
        throw error;
      }
    } else {
      console.log('   [DRY RUN] Would create/update ILM policy\n');
    }

    // Step 3: Apply ILM to indices
    console.log('3. Applying ILM to Workflow Indices');
    console.log('-'.repeat(80));

    for (const indexName of WORKFLOW_INDICES) {
      console.log(`\n   Index: ${indexName}`);
      
      // Check if index exists
      const indexExists = await client.indices.exists({ index: indexName });
      if (!indexExists) {
        console.log(`   ⚠️  Index does not exist. Skipping.\n`);
        continue;
      }

      // Get current ILM settings
      const currentILM = await getIndexILMSettings(indexName);
      const hasILM = currentILM?.lifecycleName !== undefined;

      if (hasILM) {
        console.log(`   Current ILM Policy: ${currentILM.lifecycleName}`);
        if (currentILM.lifecycleName === ILM_POLICY_NAME) {
          console.log(`   ✓ Already using policy "${ILM_POLICY_NAME}"`);
        } else {
          console.log(`   → Will update to use policy "${ILM_POLICY_NAME}"`);
        }
      } else {
        console.log(`   Current ILM Policy: None`);
        console.log(`   → Will apply policy "${ILM_POLICY_NAME}"`);
      }

      // Get index stats
      const stats = await getIndexStats(indexName);
      if (stats) {
        const docCount = stats.total?.docs?.count || 0;
        const storeSize = stats.total?.store?.size_in_bytes || 0;
        console.log(`   Current Documents: ${docCount.toLocaleString()}`);
        console.log(`   Current Size: ${(storeSize / 1024 / 1024).toFixed(2)} MB`);
      }

      // Apply ILM policy
      if (!DRY_RUN) {
        try {
          await client.indices.putSettings({
            index: indexName,
            body: {
              index: {
                'lifecycle.name': ILM_POLICY_NAME,
              },
            },
          });
          console.log(`   ✓ ILM policy applied successfully`);
        } catch (error) {
          console.error(`   ✗ Failed to apply ILM policy: ${error.message}`);
          if (error.meta?.body) {
            console.error(`   Details: ${JSON.stringify(error.meta.body, null, 2)}`);
          }
        }
      } else {
        console.log(`   [DRY RUN] Would apply ILM policy`);
      }
      console.log('');
    }

    // Step 4: Explain how ILM works
    console.log('4. How ILM Works');
    console.log('-'.repeat(80));
    console.log('   ILM will automatically:');
    console.log(`   1. Keep data in "hot" phase for active use (priority: 100)`);
    console.log(`   2. Monitor document age based on @timestamp or createdAt field`);
    console.log(`   3. Delete data older than ${RETENTION_DAYS} days`);
    console.log('');
    console.log('   Note: ILM requires time-based indices or a date field to determine age.');
    console.log('   Since workflow indices are not time-based, ILM will use the');
    console.log('   index creation date. For better control, consider:');
    console.log('   - Using time-based indices (e.g., .workflows-executions-2026-01)');
    console.log('   - Or manually deleting old data based on createdAt field\n');

    // Step 5: Alternative approach for non-time-based indices
    console.log('5. Alternative: Manual Cleanup Script');
    console.log('-'.repeat(80));
    console.log('   Since workflow indices are not time-based, you may want to:');
    console.log('   1. Create a cleanup script that deletes old executions based on createdAt');
    console.log('   2. Run it periodically (e.g., daily via cron)');
    console.log('   3. This gives more control over what gets deleted\n');
    console.log('   Example query to find old executions:');
    console.log('   ```');
    console.log('   POST /.workflows-executions/_delete_by_query');
    console.log('   {');
    console.log('     "query": {');
    console.log(`       "range": { "createdAt": { "lt": "now-${RETENTION_DAYS}d" } }`);
    console.log('     }');
    console.log('   }');
    console.log('   ```\n');

    // Step 6: Recommendations
    console.log('6. Recommendations');
    console.log('-'.repeat(80));
    console.log('   For workflow execution indices, consider:');
    console.log('   1. Use delete_by_query for more precise control');
    console.log('   2. Or migrate to time-based indices for better ILM support');
    console.log('   3. Monitor index size after cleanup');
    console.log('   4. Adjust retention period based on business needs\n');

    console.log('='.repeat(80));
    console.log(DRY_RUN ? 'Dry run complete. Use without --dry-run to apply ILM policies.' : 'ILM setup complete');
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

setupILM().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

