/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { CoreStart } from '@kbn/core/public';
import type { CustomizationCallback } from '../../customizations';

export function createWorkflowCustomizationCallback(core: CoreStart): CustomizationCallback {
  return ({ customizations }) => {
    const executeWorkflowCapability =
      core.application.capabilities.workflowsManagement?.executeWorkflow;
    const hasWorkflowCapability =
      typeof executeWorkflowCapability === 'boolean'
        ? executeWorkflowCapability
        : Boolean(executeWorkflowCapability);

    if (!hasWorkflowCapability) {
      return;
    }

    // Dynamically import to avoid bundling if capability check fails
    import('.')
      .then(({ createRunWorkflowAction, openRunWorkflowModal }) => {
        const createAction = createRunWorkflowAction({
          application: core.application,
          openModal: (doc) => openRunWorkflowModal(doc, core),
        });

        const existingFlyout = customizations.get('flyout');
        const existingGetActionItems = existingFlyout?.actions?.getActionItems;

        // Only modify getActionItems, preserving all other flyout properties
        customizations.set({
          id: 'flyout',
          ...existingFlyout,
          actions: {
            ...existingFlyout?.actions,
            getActionItems: (doc) => {
              // Compose with existing action items
              const existingItems = existingGetActionItems?.(doc) ?? [];
              const workflowAction = createAction(doc);
              return [...existingItems, workflowAction];
            },
          },
        });
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('Failed to load workflow action:', error);
      });
  };
}
