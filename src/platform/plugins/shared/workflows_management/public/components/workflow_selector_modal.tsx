/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React, { useState, useMemo } from 'react';
import type { EuiSelectableOption } from '@elastic/eui';
import {
  EuiModal,
  EuiModalHeader,
  EuiModalHeaderTitle,
  EuiModalBody,
  EuiModalFooter,
  EuiButton,
  EuiButtonEmpty,
  EuiSelectable,
  EuiLoadingSpinner,
  EuiCallOut,
  EuiSpacer,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { useWorkflowSelector } from '../hooks/use_workflow_selector';

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
  
  const { workflows, isLoading, error, selectWorkflow, selectedWorkflowId } = useWorkflowSelector({
    triggerType,
    prioritizeByTrigger: true,
  });

  // eslint-disable-next-line no-console
  console.log('WorkflowSelectorModal state:', { workflows: workflows.length, isLoading, error });

  const [searchValue, setSearchValue] = useState('');

  // Convert workflows to selectable options
  type WorkflowSelectableOption = EuiSelectableOption & { workflowId: string };
  
  const selectableOptions = useMemo<WorkflowSelectableOption[]>(() => {
    return workflows.map((workflow) => ({
      label: workflow.label,
      workflowId: workflow.id,
      disabled: workflow.disabled,
      checked: workflow.id === selectedWorkflowId ? ('on' as const) : undefined,
      'data-test-subj': `workflow-option-${workflow.id}`,
    }));
  }, [workflows, selectedWorkflowId]);

  // Handle selection change
  const handleChange = (options: WorkflowSelectableOption[]) => {
    const selected = options.find((option) => option.checked === 'on');
    if (selected) {
      selectWorkflow(selected.workflowId);
    }
  };

  // Handle confirm
  const handleConfirm = () => {
    const selectedWorkflow = workflows.find((w) => w.id === selectedWorkflowId);
    if (selectedWorkflow) {
      onSelect(selectedWorkflow.id, selectedWorkflow.name);
    }
  };

  const selectedWorkflow = workflows.find((w) => w.id === selectedWorkflowId);
  const isConfirmDisabled = !selectedWorkflowId || (selectedWorkflow && !selectedWorkflow.enabled);

  return (
    <EuiModal onClose={onClose} style={{ minWidth: 600 }}>
      <EuiModalHeader>
        <EuiModalHeaderTitle>
          {i18n.translate('workflowsManagement.selectWorkflow.title', {
            defaultMessage: 'Select workflow',
          })}
        </EuiModalHeaderTitle>
      </EuiModalHeader>

      <EuiModalBody>
        {isLoading && (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <EuiLoadingSpinner size="xl" />
          </div>
        )}

        {error && (
          <>
            <EuiCallOut
              title={i18n.translate('workflowsManagement.selectWorkflow.errorTitle', {
                defaultMessage: 'Failed to load workflows',
              })}
              color="danger"
              iconType="alert"
            >
              {error}
            </EuiCallOut>
            <EuiSpacer />
          </>
        )}

        {!isLoading && !error && workflows.length === 0 && (
          <EuiCallOut
            title={i18n.translate('workflowsManagement.selectWorkflow.noWorkflows', {
              defaultMessage: 'No workflows available',
            })}
            iconType="iInCircle"
          >
            {i18n.translate('workflowsManagement.selectWorkflow.noWorkflowsDescription', {
              defaultMessage: 'Create a workflow to get started.',
            })}
          </EuiCallOut>
        )}

        {!isLoading && workflows.length > 0 && (
          <EuiSelectable
            searchable
            searchProps={{
              placeholder: i18n.translate('workflowsManagement.selectWorkflow.searchPlaceholder', {
                defaultMessage: 'Search workflows',
              }),
              compressed: true,
              value: searchValue,
              onChange: (value) => setSearchValue(value),
            }}
            options={selectableOptions}
            onChange={handleChange}
            singleSelection={true}
            listProps={{
              rowHeight: 50,
              showIcons: false,
            }}
            height={400}
          >
            {(list, search) => (
              <>
                {search}
                <EuiSpacer size="s" />
                {list}
              </>
            )}
          </EuiSelectable>
        )}

        {selectedWorkflow && !selectedWorkflow.enabled && (
          <>
            <EuiSpacer />
            <EuiCallOut
              title={i18n.translate('workflowsManagement.selectWorkflow.disabledWarning', {
                defaultMessage: 'This workflow is disabled',
              })}
              color="warning"
              iconType="alert"
            >
              {i18n.translate('workflowsManagement.selectWorkflow.disabledWarningDescription', {
                defaultMessage: 'Enable the workflow before executing it.',
              })}
            </EuiCallOut>
          </>
        )}
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
          disabled={isConfirmDisabled}
          data-test-subj="workflowSelectorModalConfirmButton"
        >
          {i18n.translate('workflowsManagement.selectWorkflow.confirm', {
            defaultMessage: 'Run workflow',
          })}
        </EuiButton>
      </EuiModalFooter>
    </EuiModal>
  );
}

