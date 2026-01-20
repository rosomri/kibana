#!/usr/bin/env node

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 *
 * This script applies recommended resilience settings to prevent JVM memory
 * pressure issues from node departures and shard recovery operations.
 */

const { Client } = require('@elastic/elasticsearch');

// Configuration from command line or environment
const CLUSTER_URL = process.env.CLUSTER_URL || process.argv[2];
const API_KEY = process.env.API_KEY || process.argv[3];
const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');

if (!CLUSTER_URL || !API_KEY) {
  console.error('Usage: node apply_resilience_settings.js <cluster_url> <api_key> [--dry-run]');
  console.error('   or: CLUSTER_URL=<url> API_KEY=<key> DRY_RUN=true node apply_resilience_settings.js');
  console.error('\nOptions:');
  console.error('  --dry-run    Show what would be changed without applying');
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

// Recommended settings
const RESILIENCE_SETTINGS = {
  // Recovery throttling - prevent overwhelming nodes during recovery
  recovery: {
    'cluster.routing.allocation.node_concurrent_recoveries': '2',
    'cluster.routing.allocation.node_concurrent_incoming_recoveries': '2',
    'cluster.routing.allocation.node_concurrent_outgoing_recoveries': '2',
    'cluster.routing.allocation.cluster_concurrent_rebalance': '2',
    'indices.recovery.max_bytes_per_sec': '50mb',
  },
  
  // Circuit breakers - prevent memory overload
  circuit_breakers: {
    'indices.breaker.total.limit': '95%',
    'indices.breaker.total.use_real_memory': 'true',
    'indices.breaker.fielddata.limit': '40%',
    'indices.breaker.request.limit': '60%',
    'network.breaker.inflight_requests.limit': '100%',
    'network.breaker.inflight_requests.overhead': '2.0',
  },
};

async function getCurrentSettings() {
  try {
    const response = await client.cluster.getSettings({
      include_defaults: false,
      flat_settings: true,
    });
    return response.persistent || {};
  } catch (error) {
    console.error('Error fetching current settings:', error.message);
    return {};
  }
}

async function applySettings() {
  console.log('='.repeat(80));
  console.log('Elasticsearch Cluster Resilience Settings');
  console.log('='.repeat(80));
  console.log(`Cluster URL: ${CLUSTER_URL}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'APPLY SETTINGS'}\n`);

  try {
    // Get current settings
    console.log('1. Fetching current cluster settings...');
    const currentSettings = await getCurrentSettings();
    console.log('   ✓ Current settings retrieved\n');

    // Prepare settings to apply
    const settingsToApply = {
      persistent: {
        ...RESILIENCE_SETTINGS.recovery,
        ...RESILIENCE_SETTINGS.circuit_breakers,
      },
    };

    // Show what will change
    console.log('2. Settings to apply:\n');
    console.log('   Recovery Throttling:');
    for (const [key, value] of Object.entries(RESILIENCE_SETTINGS.recovery)) {
      const current = currentSettings[key] || '(default)';
      const changed = current !== value;
      const marker = changed ? '→' : '✓';
      console.log(`   ${marker} ${key}`);
      console.log(`     Current: ${current}`);
      console.log(`     New:     ${value}`);
      if (changed) {
        console.log(`     ${DRY_RUN ? 'Would change' : 'Will change'}`);
      }
      console.log('');
    }

    console.log('   Circuit Breakers:');
    for (const [key, value] of Object.entries(RESILIENCE_SETTINGS.circuit_breakers)) {
      const current = currentSettings[key] || '(default)';
      const changed = current !== value;
      const marker = changed ? '→' : '✓';
      console.log(`   ${marker} ${key}`);
      console.log(`     Current: ${current}`);
      console.log(`     New:     ${value}`);
      if (changed) {
        console.log(`     ${DRY_RUN ? 'Would change' : 'Will change'}`);
      }
      console.log('');
    }

    // Apply settings if not dry run
    if (!DRY_RUN) {
      console.log('3. Applying settings...');
      const response = await client.cluster.putSettings({
        body: settingsToApply,
      });
      
      if (response.acknowledged) {
        console.log('   ✓ Settings applied successfully\n');
        
        // Verify settings
        console.log('4. Verifying applied settings...');
        const verifySettings = await getCurrentSettings();
        
        let allApplied = true;
        for (const [key, expectedValue] of Object.entries(settingsToApply.persistent)) {
          const actual = verifySettings[key];
          if (actual !== expectedValue) {
            console.log(`   ✗ ${key}: Expected ${expectedValue}, got ${actual || '(not set)'}`);
            allApplied = false;
          }
        }
        
        if (allApplied) {
          console.log('   ✓ All settings verified\n');
        } else {
          console.log('   ⚠ Some settings may not have been applied correctly\n');
        }
      } else {
        console.log('   ✗ Settings were not acknowledged\n');
      }
    } else {
      console.log('3. [DRY RUN] Skipping application of settings\n');
    }

    // Show recommendations
    console.log('5. Additional Recommendations:\n');
    console.log('   - Review replica counts: Consider reducing replicas for non-critical indices');
    console.log('   - Monitor cluster health: Set up alerts for JVM memory pressure > 75%');
    console.log('   - Add more data nodes: Minimum 3 data nodes recommended for production');
    console.log('   - Increase heap size: Consider 4-8GB heap per data node');
    console.log('   - Set up ILM policies: Automate index lifecycle management');
    console.log('');

    console.log('='.repeat(80));
    console.log(DRY_RUN ? 'Dry run complete. Use without --dry-run to apply settings.' : 'Settings applied successfully');
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

// Run the script
applySettings().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

