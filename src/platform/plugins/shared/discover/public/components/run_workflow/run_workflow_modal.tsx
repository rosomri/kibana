/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  EuiModal,
  EuiModalHeader,
  EuiModalHeaderTitle,
  EuiModalBody,
  EuiModalFooter,
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiSpacer,
  EuiLink,
  EuiIcon,
  useGeneratedHtmlId,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { FormattedMessage } from '@kbn/i18n-react';
import { toMountPoint } from '@kbn/react-kibana-mount';
import { WorkflowSelector, useRunWorkflow } from '@kbn/workflows-ui';
import type { DataTableRecord } from '@kbn/discover-utils/types';
import type { CoreStart } from '@kbn/core/public';
import type { WorkflowListDto } from '@kbn/workflows';

interface RunWorkflowModalProps {
  document: DataTableRecord;
  core: CoreStart;
  onClose: () => void;
}

/**
 * Converts a Discover document to workflow input format
 */
function convertDocumentToWorkflowInput(document: DataTableRecord): Record<string, unknown> {
  return {
    input: document.raw,
  };
}

/**
 * Modal component for selecting and executing a workflow on a document
 */
export const RunWorkflowModal: React.FC<RunWorkflowModalProps> = ({ document, core, onClose }) => {
  const { notifications, application } = core;
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>();
  const modalTitleId = useGeneratedHtmlId();

  const runWorkflow = useRunWorkflow();

  const validateWorkflow = useCallback(
    (workflow: WorkflowListDto['results'][number]) => {
      const inputs = workflow.definition?.inputs || [];

      if (inputs.length === 0) {
        return null;
      }

      // Filter for required inputs and get their names
      const requiredInputs = inputs.filter((input) => input.required === true);

      if (requiredInputs.length === 0) {
        return null;
      }

      const documentFields = Object.keys(document.flattened || {});
      const missingFields = requiredInputs
        .map((input) => input.name)
        .filter((fieldName) => !documentFields.includes(fieldName));

      if (missingFields.length > 0) {
        return {
          severity: 'warning' as const,
          message: i18n.translate('discover.runWorkflow.modal.missingFieldsWarning', {
            defaultMessage:
              'Document is missing required fields: {fields}. The workflow may fail or produce unexpected results.',
            values: {
              fields: missingFields.slice(0, 5).join(', '),
              ...(missingFields.length > 5 && {
                more: ` and ${missingFields.length - 5} more`,
              }),
            },
          }),
        };
      }

      return null;
    },
    [document]
  );

  const handleExecute = useCallback(async () => {
    if (!selectedWorkflowId) {
      return;
    }

    try {
      const inputs = convertDocumentToWorkflowInput(document);

      const response = await runWorkflow.mutateAsync({
        workflowId: selectedWorkflowId,
        inputs,
      });

      const executionUrl = application.getUrlForApp('workflows', {
        path: `/executions/${response.workflowExecutionId}`,
      });

      notifications.toasts.addSuccess({
        title: i18n.translate('discover.runWorkflow.modal.executionStarted', {
          defaultMessage: 'Workflow execution started',
        }),
        text: toMountPoint(
          <EuiLink href={executionUrl} target="_blank" external>
            <FormattedMessage
              id="discover.runWorkflow.modal.viewExecutionLink"
              defaultMessage="View execution details"
            />
            <EuiIcon type="popout" size="s" css={{ marginLeft: 4 }} />
          </EuiLink>,
          { theme: core.theme, i18n: core.i18n }
        ),
        'data-test-subj': 'discoverRunWorkflowSuccessToast',
      });

      onClose();
    } catch (err) {
      // Error handling is done via runWorkflow.error state
    }
  }, [selectedWorkflowId, document, runWorkflow, application, notifications, core, onClose]);

  const errorMessage = useMemo(() => {
    if (!runWorkflow.error) return undefined;

    const error = runWorkflow.error;
    const statusCode = error.body?.statusCode;

    if (statusCode === 403) {
      return i18n.translate('discover.runWorkflow.modal.error.permissionDenied', {
        defaultMessage: 'You do not have permission to execute this workflow',
      });
    }

    if (statusCode === 404) {
      return i18n.translate('discover.runWorkflow.modal.error.workflowNotFound', {
        defaultMessage: 'Workflow not found',
      });
    }

    if (statusCode === 400) {
      return (
        error.body?.message ||
        i18n.translate('discover.runWorkflow.modal.error.validation', {
          defaultMessage: 'Invalid workflow configuration',
        })
      );
    }

    return error.message;
  }, [runWorkflow.error]);

  return (
    <EuiModal
      onClose={onClose}
      style={{ width: 600 }}
      data-test-subj="discoverRunWorkflowModal"
      aria-labelledby={modalTitleId}
    >
      <EuiModalHeader>
        <EuiModalHeaderTitle id={modalTitleId}>
          <FormattedMessage
            id="discover.runWorkflow.modal.title"
            defaultMessage="Run workflow on document"
          />
        </EuiModalHeaderTitle>
      </EuiModalHeader>

      <EuiModalBody>
        <WorkflowSelector
          selectedWorkflowId={selectedWorkflowId}
          onWorkflowChange={setSelectedWorkflowId}
          config={{
            label: i18n.translate('discover.runWorkflow.modal.workflowLabel', {
              defaultMessage: 'Select workflow',
            }),
            placeholder: i18n.translate('discover.runWorkflow.modal.workflowPlaceholder', {
              defaultMessage: 'Choose a workflow to execute...',
            }),
            createWorkflowLinkText: i18n.translate(
              'discover.runWorkflow.modal.createWorkflowLink',
              {
                defaultMessage: 'Create new workflow',
              }
            ),
            validationFunction: validateWorkflow,
            errorMessages: {
              loadFailed: i18n.translate('discover.runWorkflow.modal.loadFailed', {
                defaultMessage: 'Failed to load workflows',
              }),
              selectedWorkflowDisabled: i18n.translate(
                'discover.runWorkflow.modal.workflowDisabled',
                {
                  defaultMessage: 'Selected workflow is disabled',
                }
              ),
            },
          }}
        />

        {errorMessage && (
          <>
            <EuiSpacer size="m" />
            <EuiCallOut
              announceOnMount
              title={i18n.translate('discover.runWorkflow.modal.error.title', {
                defaultMessage: 'Error',
              })}
              color="danger"
              iconType="error"
              data-test-subj="discoverRunWorkflowError"
            >
              {errorMessage}
            </EuiCallOut>
          </>
        )}
      </EuiModalBody>

      <EuiModalFooter>
        <EuiButtonEmpty onClick={onClose} data-test-subj="discoverRunWorkflowCancel">
          <FormattedMessage id="discover.runWorkflow.modal.cancel" defaultMessage="Cancel" />
        </EuiButtonEmpty>
        <EuiButton
          fill
          onClick={handleExecute}
          isLoading={runWorkflow.isLoading}
          disabled={!selectedWorkflowId || runWorkflow.isLoading}
          data-test-subj="discoverRunWorkflowExecute"
        >
          <FormattedMessage id="discover.runWorkflow.modal.execute" defaultMessage="Run" />
        </EuiButton>
      </EuiModalFooter>
    </EuiModal>
  );
};

export function openRunWorkflowModal(document: DataTableRecord, core: CoreStart) {
  const modal = core.overlays.openModal(
    toMountPoint(
      <RunWorkflowModal document={document} core={core} onClose={() => modal.close()} />,
      { theme: core.theme, i18n: core.i18n }
    ),
    {
      'data-test-subj': 'discoverRunWorkflowModal',
    }
  );
  return modal;
}
