/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License v 1".
 */

import React, { useState } from 'react';
import {
  EuiModal,
  EuiModalHeader,
  EuiModalHeaderTitle,
  EuiModalBody,
  EuiModalFooter,
  EuiButton,
  EuiButtonEmpty,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { WorkflowSelectorCore } from './workflow_selector_core';

export interface WorkflowSelectorModalProps {
  /**
   * Callback when modal is closed
   */
  onClose: () => void;

  /**
   * Callback when a workflow is selected
   */
  onSelect: (workflowId: string, workflowName: string) => void;

  /**
   * Optional trigger type to filter workflows
   */
  triggerType?: string;
}

/**
 * Modal component for selecting a workflow
 */
export function WorkflowSelectorModal({
  onClose,
  onSelect,
  triggerType,
}: WorkflowSelectorModalProps) {
  // eslint-disable-next-line no-console
  console.log('WorkflowSelectorModal mounted');

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('');
  const [selectedWorkflowName, setSelectedWorkflowName] = useState<string>('');

  // Handle workflow selection
  const handleWorkflowChange = (workflowId: string, workflowName: string) => {
    setSelectedWorkflowId(workflowId);
    setSelectedWorkflowName(workflowName);
  };

  // Handle confirm
  const handleConfirm = () => {
    if (selectedWorkflowId && selectedWorkflowName) {
      onSelect(selectedWorkflowId, selectedWorkflowName);
    }
  };

  return (
    <EuiModal
      onClose={onClose}
      initialFocus="[data-test-subj=workflowSelector]"
      aria-label={i18n.translate('workflowsManagement.selectWorkflow.modalTitle', {
        defaultMessage: 'Select Workflow',
      })}
    >
      <EuiModalHeader>
        <EuiModalHeaderTitle>
          {i18n.translate('workflowsManagement.selectWorkflow.modalTitle', {
            defaultMessage: 'Select Workflow',
          })}
        </EuiModalHeaderTitle>
      </EuiModalHeader>

      <EuiModalBody>
        <WorkflowSelectorCore
          selectedWorkflowId={selectedWorkflowId}
          onWorkflowChange={handleWorkflowChange}
          triggerType={triggerType}
          prioritizeByTrigger={true}
          placeholder={i18n.translate('workflowsManagement.selectWorkflow.searchPlaceholder', {
            defaultMessage: 'Search workflows',
          })}
          data-test-subj="workflowSelector"
          showViewAllLink={true}
        />
      </EuiModalBody>

      <EuiModalFooter>
        <EuiButtonEmpty onClick={onClose}>
          {i18n.translate('workflowsManagement.selectWorkflow.cancel', {
            defaultMessage: 'Cancel',
          })}
        </EuiButtonEmpty>
        <EuiButton
          onClick={handleConfirm}
          fill
          disabled={!selectedWorkflowId}
          data-test-subj="confirmWorkflowSelection"
        >
          {i18n.translate('workflowsManagement.selectWorkflow.confirm', {
            defaultMessage: 'Run Workflow',
          })}
        </EuiButton>
      </EuiModalFooter>
    </EuiModal>
  );
}
