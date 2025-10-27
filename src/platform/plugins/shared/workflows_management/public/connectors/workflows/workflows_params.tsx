/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React, { useCallback, useEffect } from 'react';
import type { ActionParamsProps } from '@kbn/triggers-actions-ui-plugin/public';
import type { WorkflowsActionParams } from './types';
import { WorkflowSelector } from '../../components/workflow_selector';
import type {
  WorkflowFilterFunction,
  WorkflowOption,
  WorkflowSortFunction,
  WorkflowValidationFunction,
} from '../../components/workflow_selector/types';

// Helper function for connector context
const hasAlertTriggerType = (workflow: WorkflowOption): boolean => {
  return (workflow.definition?.triggers ?? []).some((trigger) => trigger.type === 'alert');
};

// Connector-specific sort function
const connectorSortFunction: WorkflowSortFunction = (workflows) => {
  return workflows.sort((a, b) => {
    const aHasAlertTrigger = hasAlertTriggerType(a);
    const bHasAlertTrigger = hasAlertTriggerType(b);

    if (aHasAlertTrigger && !bHasAlertTrigger) return -1;
    if (!aHasAlertTrigger && bHasAlertTrigger) return 1;
    return a.name.localeCompare(b.name);
  });
};

// Default filter function
const defaultFilterFunction: WorkflowFilterFunction = (workflows, searchTerm) => {
  if (!searchTerm) return workflows;

  const term = searchTerm.toLowerCase();
  return workflows.filter(
    (workflow) =>
      workflow.name.toLowerCase().includes(term) ||
      workflow.description?.toLowerCase().includes(term) ||
      workflow.tags.some((tag) => tag.toLowerCase().includes(term))
  );
};

// Connector-specific validation function
const connectorValidationFunction: WorkflowValidationFunction = (workflow) => {
  if (!workflow.enabled) {
    return {
      isValid: false,
      errorMessage: 'This workflow is currently disabled',
      severity: 'error',
    };
  }

  return { isValid: true, severity: 'info' };
};

const WorkflowsParamsFields: React.FunctionComponent<ActionParamsProps<WorkflowsActionParams>> = ({
  actionParams,
  editAction,
  index,
  errors,
}) => {
  const { workflowId } = actionParams.subActionParams ?? {};

  // Ensure proper initialization of action parameters
  useEffect(() => {
    if (!actionParams?.subAction) {
      editAction('subAction', 'run', index);
    }
    if (!actionParams?.subActionParams) {
      editAction('subActionParams', { workflowId: '' }, index);
    }
  }, [actionParams, editAction, index]);

  const editSubActionParams = useCallback(
    (key: string, value: unknown) => {
      const oldParams = actionParams.subActionParams ?? {};
      const updatedParams = { ...oldParams, [key]: value };
      editAction('subActionParams', updatedParams, index);
    },
    [actionParams.subActionParams, editAction, index]
  );

  const handleWorkflowSelect = useCallback(
    (selectedWorkflowId: string) => {
      editSubActionParams('workflowId', selectedWorkflowId);
    },
    [editSubActionParams]
  );

  const handleWorkflowClear = useCallback(() => {
    editSubActionParams('workflowId', '');
  }, [editSubActionParams]);

  return (
    <WorkflowSelector
      selectedWorkflowId={workflowId}
      onWorkflowSelect={handleWorkflowSelect}
      onWorkflowClear={handleWorkflowClear}
      sortFunction={connectorSortFunction}
      filterFunction={defaultFilterFunction}
      validationFunction={connectorValidationFunction}
      errors={errors as Record<string, string[]>}
      data-test-subj="workflowIdSelect"
    />
  );
};

// eslint-disable-next-line import/no-default-export
export default WorkflowsParamsFields;
