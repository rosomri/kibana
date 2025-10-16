/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React from 'react';
import { toMountPoint } from '@kbn/react-kibana-mount';
import { KibanaContextProvider } from '@kbn/kibana-react-plugin/public';
import type { CoreStart } from '@kbn/core/public';
import type { DataTableRecord } from '@kbn/discover-utils/types';
import { i18n } from '@kbn/i18n';
import type { FlyoutActionItem } from '@kbn/discover-plugin/public/customizations';
import { WorkflowSelectorModal } from '../components/workflow_selector_modal';
import { executeWorkflowFromDocument } from './execute_workflow_from_document';

export interface CreateWorkflowFlyoutActionParams {
  /**
   * Kibana core services
   */
  core: CoreStart;
  
  /**
   * The document to execute workflows against
   */
  document: DataTableRecord;
  
  /**
   * Optional data view ID for additional context
   */
  dataViewId?: string;
  
  /**
   * Optional data view title for additional context
   */
  dataViewTitle?: string;
}

/**
 * Creates a flyout action for running workflows on documents in Discover
 * 
 * This function checks user permissions and returns a properly configured
 * FlyoutActionItem that can be added to Discover's flyout actions.
 * 
 * Permission Check:
 * The action is only enabled if the user has the 'workflowsManagement.execute'
 * capability, which corresponds to the workflow:execute privilege.
 */
export function createWorkflowFlyoutAction({
  core,
  document,
  dataViewId,
  dataViewTitle,
}: CreateWorkflowFlyoutActionParams): FlyoutActionItem {
  const { overlays, http, notifications, application } = core;
  
  // PERMISSION CHECK: Verify user has workflow:execute capability
  // This maps to the 'execute' UI capability defined in server/features.ts
  const hasExecutePermission = Boolean(
    application.capabilities.workflowsManagement?.execute
  );

  return {
    id: 'runWorkflow',
    enabled: hasExecutePermission,
    iconType: 'play',
    dataTestSubj: 'discoverRunWorkflowAction',
    label: i18n.translate('workflowsManagement.discover.runWorkflow.label', {
      defaultMessage: 'Run workflow',
    }),
    helpText: hasExecutePermission
      ? i18n.translate('workflowsManagement.discover.runWorkflow.helpText', {
          defaultMessage: 'Execute a workflow using this document as input',
        })
      : i18n.translate('workflowsManagement.discover.runWorkflow.noPermission', {
          defaultMessage: 'You do not have permission to execute workflows',
        }),
    onClick: () => {
      // Only open modal if user has permission (defensive check)
      if (!hasExecutePermission) {
        notifications.toasts.addWarning({
          title: i18n.translate('workflowsManagement.discover.runWorkflow.permissionDeniedTitle', {
            defaultMessage: 'Permission denied',
          }),
          text: i18n.translate('workflowsManagement.discover.runWorkflow.permissionDeniedMessage', {
            defaultMessage: 'You do not have permission to execute workflows. Please contact your administrator.',
          }),
        });
        return;
      }

      // Open the workflow selector modal
      const modal = overlays.openModal(
        toMountPoint(
          <KibanaContextProvider services={core}>
            <WorkflowSelectorModal
              onClose={() => modal.close()}
              onSelect={async (workflowId, workflowName) => {
                modal.close();
                
                try {
                  await executeWorkflowFromDocument({
                    document,
                    workflowId,
                    workflowName,
                    http,
                    notifications,
                    metadata: {
                      dataViewId,
                      dataViewTitle,
                    },
                  });
                } catch (error) {
                  // Error handling is done in executeWorkflowFromDocument
                  // This catch is just to prevent unhandled promise rejections
                }
              }}
            />
          </KibanaContextProvider>,
          core.rendering
        )
      );
    },
  };
}

