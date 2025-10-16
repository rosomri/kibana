/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { HttpStart, NotificationsStart } from '@kbn/core/public';
import type { DataTableRecord } from '@kbn/discover-utils/types';
import { i18n } from '@kbn/i18n';

export interface ExecuteWorkflowFromDocumentOptions {
  /**
   * The document to pass to the workflow
   */
  document: DataTableRecord;
  
  /**
   * The workflow ID to execute
   */
  workflowId: string;
  
  /**
   * The workflow name (for user feedback)
   */
  workflowName: string;
  
  /**
   * Optional additional metadata
   */
  metadata?: Record<string, any>;
  
  /**
   * Kibana HTTP service
   */
  http: HttpStart;
  
  /**
   * Kibana notifications service
   */
  notifications: NotificationsStart;
}

export interface ExecuteWorkflowResult {
  /**
   * The ID of the workflow execution
   */
  workflowExecutionId: string;
}

/**
 * Execute a workflow using a document from Discover as input
 * 
 * Calls POST /api/workflows/{id}/run and structures the document
 * data properly for workflow consumption.
 */
export async function executeWorkflowFromDocument(
  options: ExecuteWorkflowFromDocumentOptions
): Promise<ExecuteWorkflowResult> {
  const { document, workflowId, workflowName, metadata = {}, http, notifications } = options;

  try {
    // Structure the inputs according to the API schema
    const result = await http.post<ExecuteWorkflowResult>(`/api/workflows/${workflowId}/run`, {
      body: JSON.stringify({
        inputs: {
          // The document will be available in workflows as {{ document }}
          document: {
            _id: document.id,
            _index: document.raw._index,
            _source: document.raw._source,
            fields: document.flattened,
          },
          // Metadata will be available as {{ metadata }}
          metadata: {
            source: 'discover',
            timestamp: new Date().toISOString(),
            ...metadata,
          },
        },
      }),
    });

    // Show success notification
    notifications.toasts.addSuccess({
      title: i18n.translate('workflowsManagement.executeWorkflow.successTitle', {
        defaultMessage: 'Workflow execution started',
      }),
      text: i18n.translate('workflowsManagement.executeWorkflow.successMessage', {
        defaultMessage: 'Workflow "{workflowName}" is now running (ID: {executionId})',
        values: {
          workflowName,
          executionId: result.workflowExecutionId,
        },
      }),
    });

    return result;
  } catch (error) {
    // Show error notification
    notifications.toasts.addError(error as Error, {
      title: i18n.translate('workflowsManagement.executeWorkflow.errorTitle', {
        defaultMessage: 'Failed to start workflow',
      }),
      toastMessage: i18n.translate('workflowsManagement.executeWorkflow.errorMessage', {
        defaultMessage: 'Workflow "{workflowName}" could not be started: {error}',
        values: {
          workflowName,
          error: (error as Error).message,
        },
      }),
    });

    throw error;
  }
}

