# Elastic Workflows Integration (POC)

Local development package for the Elastic Workflows integration.

## Quick Start

### 1. Build the zip

```bash
cd dev_packages/workflows_integration
zip -r elastic_workflows-0.1.0.zip elastic_workflows-0.1.0/
```

### 2. Upload to your local Kibana

```bash
curl -X POST "http://localhost:5601/api/fleet/epm/packages" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/zip" \
  --data-binary @elastic_workflows-0.1.0.zip \
  -u elastic:changeme
```

### 3. Find it in the UI

Navigate to **Management > Integrations** — search for "Elastic Workflows".
The dashboard is installed automatically and can be found under **Analytics > Dashboards**.

## Package Structure

```
elastic_workflows-0.1.0/
├── manifest.yml                           # Package metadata
├── changelog.yml                          # Version history
├── docs/README.md                         # Integration detail page docs
├── img/logo.svg                           # Integration icon
└── kibana/
    └── dashboard/
        └── workflows-execution-overview.json   # Dashboard saved object
```

## Dashboard Panels

The "Execution Overview" dashboard includes:

| Panel | Type | Description |
|-------|------|-------------|
| Total Executions | Metric | Count of all non-test workflow runs |
| Success Rate | Metric | Percentage of completed executions |
| Avg Duration | Metric | Mean execution duration in ms |
| Failures | Metric | Count of failed + timed out executions |
| Executions Over Time | Stacked Bar | Execution volume by status over time |
| Status Breakdown | Donut | Proportional view of all statuses |
| Top Workflows | Table | Most executed workflows with avg duration |
| Top Failing Workflows | Table | Workflows with most failures |

All panels query `.workflows-executions` and filter out test runs (`isTestRun: false`).

## Updating the dashboard

The easiest way to iterate on the dashboard:

1. Install the package (steps above)
2. Edit the dashboard in the Kibana UI
3. Export it: **Dashboard > Share > Export > Copy to clipboard**
4. Replace the content in `kibana/dashboard/workflows-execution-overview.json`
5. Bump the version in `manifest.yml` and `changelog.yml`
6. Re-zip and re-upload

## Uninstall

```bash
curl -X DELETE "http://localhost:5601/api/fleet/epm/packages/elastic_workflows/0.1.0" \
  -H "kbn-xsrf: true" \
  -u elastic:changeme
```
