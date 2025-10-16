/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { WorkflowsPlugin } from './plugin';

// This exports static code and TypeScript types,
// as well as, Kibana Platform `plugin()` initializer.
export function plugin() {
  return new WorkflowsPlugin();
}
export type { WorkflowsPublicPluginSetup, WorkflowsPublicPluginStart } from './types';

// Export hooks
export { useWorkflowSelector } from './hooks/use_workflow_selector';
export type {
  WorkflowOption,
  UseWorkflowSelectorOptions,
  UseWorkflowSelectorResult,
} from './hooks/use_workflow_selector';

// Export components
export { WorkflowSelectorModal } from './components/workflow_selector_modal';
export type { WorkflowSelectorModalProps } from './components/workflow_selector_modal';

// Export helpers
export { executeWorkflowFromDocument } from './helpers/execute_workflow_from_document';
export type {
  ExecuteWorkflowFromDocumentOptions,
  ExecuteWorkflowResult,
} from './helpers/execute_workflow_from_document';
export { createWorkflowFlyoutAction } from './helpers/create_workflow_flyout_action';
export type { CreateWorkflowFlyoutActionParams } from './helpers/create_workflow_flyout_action';
