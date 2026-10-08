/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { Logger } from '@kbn/core/server';
import type { EsWorkflowExecution } from '@kbn/workflows';
import { isTerminalStatus } from '@kbn/workflows';
import type { WorkflowTaskManager } from '../workflow_task_manager/workflow_task_manager';

/**
 * Returns true when no task needs to run for this execution again. A terminal execution with
 * pending identity-failure cleanup still relies on its runner to retry that cleanup.
 */
export const isExecutionFinished = (
  execution: Pick<EsWorkflowExecution, 'status' | 'context'>
): boolean =>
  isTerminalStatus(execution.status) &&
  execution.context?.serviceAccountFailureCleanupPending !== true;

/** Best-effort removal of a finished execution's remaining Task Manager tasks. */
export const releaseFinishedExecutionTasks = async ({
  workflowTaskManager,
  executionId,
  exceptTaskId,
  logger,
}: {
  workflowTaskManager?: WorkflowTaskManager;
  executionId: string;
  exceptTaskId?: string;
  logger: Logger;
}): Promise<void> => {
  if (!workflowTaskManager) return;
  try {
    await workflowTaskManager.removeTasksForExecution(executionId, { exceptTaskId });
  } catch (error) {
    logger.warn(
      `Failed to remove Task Manager tasks for finished workflow execution ${executionId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};
