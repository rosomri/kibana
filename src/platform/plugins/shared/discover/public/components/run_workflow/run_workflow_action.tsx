/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { i18n } from '@kbn/i18n';
import type { DataTableRecord } from '@kbn/discover-utils/types';
import type { ApplicationStart } from '@kbn/core/public';
import type { FlyoutActionItem } from '../../customizations/customization_types/flyout_customization';

export interface CreateRunWorkflowActionParams {
  application: ApplicationStart;
  openModal: (doc: DataTableRecord) => void;
}

/**
 * Creates a factory function that generates the "Run workflow" action item
 * for a specific document
 */
export function createRunWorkflowAction({ application, openModal }: CreateRunWorkflowActionParams) {
  const executeWorkflowCapability = application.capabilities.workflowsManagement?.executeWorkflow;
  const hasPermission =
    typeof executeWorkflowCapability === 'boolean'
      ? executeWorkflowCapability
      : Boolean(executeWorkflowCapability);

  return (doc: DataTableRecord): FlyoutActionItem => ({
    id: 'runWorkflow',
    enabled: hasPermission,
    label: i18n.translate('discover.flyout.actions.runWorkflow', {
      defaultMessage: 'Run workflow',
    }),
    iconType: 'play',
    dataTestSubj: 'discoverFlyoutRunWorkflowAction',
    helpText: !hasPermission
      ? i18n.translate('discover.flyout.actions.runWorkflow.noPermission', {
          defaultMessage: 'You do not have permission to execute workflows',
        })
      : i18n.translate('discover.flyout.actions.runWorkflow.helpText', {
          defaultMessage: 'Execute a workflow using this document as input',
        }),
    onClick: () => {
      openModal(doc);
    },
  });
}
