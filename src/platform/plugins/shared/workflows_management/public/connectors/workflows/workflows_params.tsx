/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { EuiFormRow, EuiIcon, EuiLink } from '@elastic/eui';
import React, { useCallback, useEffect } from 'react';
import type { ActionParamsProps } from '@kbn/triggers-actions-ui-plugin/public';
import * as i18n from './translations';
import type { WorkflowsActionParams } from './types';
import { WorkflowSelectorCore } from '../../components/workflow_selector_core';

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

  const handleWorkflowChange = useCallback(
    (selectedWorkflowId: string, workflowName: string) => {
      editSubActionParams('workflowId', selectedWorkflowId);
    },
    [editSubActionParams]
  );

  const handleOpenWorkflowManagementApp = useCallback(() => {
    const url = '/app/workflows';
    window.open(url, '_blank');
  }, []);

  const errorMessages = errors['subActionParams.workflowId'];
  const errorMessage = Array.isArray(errorMessages) ? errorMessages[0] : errorMessages;
  const validationError = typeof errorMessage === 'string' ? errorMessage : undefined;

  return (
    <EuiFormRow
      label={i18n.WORKFLOW_ID_LABEL}
      labelAppend={
        <EuiLink onClick={handleOpenWorkflowManagementApp} external>
          {i18n.CREATE_NEW_WORKFLOW} <EuiIcon type="plusInCircle" size="s" />
        </EuiLink>
      }
      error={validationError}
      isInvalid={!!validationError}
      fullWidth
    >
      <WorkflowSelectorCore
        selectedWorkflowId={workflowId}
        onWorkflowChange={handleWorkflowChange}
        triggerType="alert"
        prioritizeByTrigger={true}
        placeholder={i18n.SELECT_WORKFLOW_PLACEHOLDER}
        data-test-subj="workflowIdSelect"
        showViewAllLink={true}
      />
    </EuiFormRow>
  );
};

// eslint-disable-next-line import/no-default-export
export default WorkflowsParamsFields;
