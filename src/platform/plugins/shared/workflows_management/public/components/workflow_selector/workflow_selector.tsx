/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  EuiFormRow,
  EuiHighlight,
  EuiIcon,
  EuiInputPopover,
  EuiLink,
  EuiLoadingSpinner,
  EuiPopoverFooter,
  EuiSelectable,
  EuiSelectableMessage,
  EuiText,
  EuiToolTip,
  useEuiTheme,
} from '@elastic/eui';
import React, { useCallback, useEffect, useState } from 'react';
import { FormattedMessage } from '@kbn/i18n-react';
import { useKibana } from '@kbn/kibana-react-plugin/public';
import { WorkflowEmptyState, WorkflowTagsBadge } from './components';
import type { WorkflowOption, WorkflowSelectorProps } from './types';
import { useWorkflowList } from './use_workflow_list';
import * as i18n from '../../connectors/workflows/translations';

export function WorkflowSelector<TContext = unknown>({
  selectedWorkflowId,
  onWorkflowSelect,
  onWorkflowClear,
  sortFunction,
  filterFunction,
  validationFunction,
  placeholder = i18n.SELECT_WORKFLOW_PLACEHOLDER,
  disabled = false,
  showCreateLink = true,
  onCreateWorkflow,
  className,
  'data-test-subj': dataTestSubj = 'workflowIdSelect',
  context,
  errors,
  isInvalid,
  helpText,
  label = i18n.WORKFLOW_ID_LABEL,
  labelAppend,
  fullWidth = true,
}: WorkflowSelectorProps<TContext>) {
  const { workflows, isLoading, error } = useWorkflowList();
  const { application } = useKibana().services;
  const { euiTheme } = useEuiTheme();

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isSearching, setIsSearching] = useState(true);

  // Apply sorting and filtering
  const processedWorkflows = React.useMemo(() => {
    let processed = [...workflows];

    // Apply sorting
    if (sortFunction) {
      processed = sortFunction(processed, context);
    }

    // Apply filtering
    if (filterFunction && inputValue) {
      processed = filterFunction(processed, inputValue, context);
    }

    return processed;
  }, [workflows, sortFunction, filterFunction, inputValue, context]);

  // Custom render function for workflow options
  const renderWorkflowOption = useCallback((option: WorkflowOption, searchValue: string) => {
    const content = (
      <>
        <>
          {option.namePrepend}
          <EuiHighlight search={searchValue}>{option.label}</EuiHighlight>
        </>
        {option.data?.secondaryContent && (
          <EuiText size="xs" color="subdued" className="eui-displayBlock">
            <small>
              <EuiHighlight search={searchValue}>{option.data.secondaryContent}</EuiHighlight>
            </small>
          </EuiText>
        )}
      </>
    );

    if (option.disabled) {
      return <EuiToolTip content={i18n.DISABLED_WORKFLOW_TOOLTIP}>{content}</EuiToolTip>;
    }

    return content;
  }, []);

  const onWorkflowChange = useCallback(
    (newOptions: WorkflowOption[], event: unknown, changedOption: WorkflowOption) => {
      setIsPopoverOpen(false);

      if (changedOption.checked === 'on') {
        onWorkflowSelect(changedOption.id);
        setInputValue(changedOption.name);
        setIsSearching(false);
      } else {
        onWorkflowClear?.();
        setInputValue('');
        setIsSearching(true);
      }
    },
    [onWorkflowSelect, onWorkflowClear]
  );

  const handlePopoverClose = useCallback(() => {
    setIsPopoverOpen(false);

    // If the user cleared the input but didn't select anything new,
    // revert to the currently selected workflow
    if (selectedWorkflowId && workflows.length > 0 && isSearching) {
      const selectedWorkflow = workflows.find((w) => w.id === selectedWorkflowId);
      if (selectedWorkflow) {
        setInputValue(selectedWorkflow.name);
        setIsSearching(false);
      }
    }
  }, [selectedWorkflowId, workflows, isSearching]);

  const handleOpenWorkflowManagementApp = useCallback(() => {
    const url = application?.getUrlForApp
      ? application.getUrlForApp('workflows')
      : '/app/workflows';
    window.open(url, '_blank');
  }, [application]);

  // Update input value when workflowId changes
  useEffect(() => {
    if (selectedWorkflowId && workflows.length > 0) {
      const selectedWorkflow = workflows.find((w) => w.id === selectedWorkflowId);
      if (selectedWorkflow) {
        setInputValue(selectedWorkflow.name);
        setIsSearching(false);
      }
    } else {
      setInputValue('');
      setIsSearching(true);
    }
  }, [selectedWorkflowId, workflows]);

  // Add tags to workflow options
  const workflowOptionsWithTags = processedWorkflows.map((workflow) => ({
    ...workflow,
    append: <WorkflowTagsBadge tags={workflow.tags} />,
  }));

  const displayError = error || errors?.['subActionParams.workflowId']?.[0];
  const displayHelpText = helpText || (isLoading ? i18n.LOADING_WORKFLOWS : undefined);

  return (
    <EuiFormRow
      label={label}
      labelAppend={
        showCreateLink ? (
          <EuiLink onClick={handleOpenWorkflowManagementApp} external>
            {i18n.CREATE_NEW_WORKFLOW} <EuiIcon type="plusInCircle" size="s" />
          </EuiLink>
        ) : (
          labelAppend
        )
      }
      helpText={displayHelpText}
      error={displayError}
      isInvalid={isInvalid || !!displayError}
      fullWidth={fullWidth}
    >
      {isLoading ? (
        <EuiLoadingSpinner size="m" />
      ) : (
        <EuiSelectable
          aria-label="Select workflow"
          options={workflowOptionsWithTags as any}
          onChange={onWorkflowChange}
          singleSelection
          searchable
          searchProps={{
            value: inputValue,
            onChange: (value) => {
              setInputValue(value);
              setIsSearching(true);
            },
            onKeyDown: (event) => {
              if (event.key === 'Tab') return handlePopoverClose();
              if (event.key === 'Escape') return handlePopoverClose();
              if (event.key !== 'Escape') return setIsPopoverOpen(true);
            },
            onClick: () => setIsPopoverOpen(true),
            onFocus: () => setIsPopoverOpen(true),
            placeholder,
          }}
          isPreFiltered={isSearching ? false : { highlightSearch: false }}
          data-test-subj={dataTestSubj}
          emptyMessage={
            <EuiSelectableMessage>
              <WorkflowEmptyState
                onCreateWorkflow={onCreateWorkflow || handleOpenWorkflowManagementApp}
              />
            </EuiSelectableMessage>
          }
          listProps={{
            rowHeight: 60, // Increased height to accommodate secondary content and tags
            showIcons: false,
            css: {
              // Hide the badge when the option is focused
              '.euiSelectableListItem__onFocusBadge': {
                display: 'none',
              },
            },
          }}
          renderOption={renderWorkflowOption}
        >
          {(list, search) => (
            <EuiInputPopover
              closePopover={handlePopoverClose}
              disableFocusTrap
              closeOnScroll
              isOpen={isPopoverOpen}
              input={search || <div />}
              panelPaddingSize="none"
              fullWidth
            >
              {list}
              {workflows.length > 0 && (
                <EuiPopoverFooter
                  paddingSize="s"
                  css={{ backgroundColor: euiTheme.colors.backgroundBaseSubdued }}
                >
                  <EuiText size="s" textAlign="right">
                    <EuiLink onClick={handleOpenWorkflowManagementApp} external>
                      <FormattedMessage
                        id="workflows.params.viewAllWorkflowsLinkText"
                        defaultMessage="View all workflows"
                      />
                      <EuiIcon type="popout" size="s" />
                    </EuiLink>
                  </EuiText>
                </EuiPopoverFooter>
              )}
            </EuiInputPopover>
          )}
        </EuiSelectable>
      )}
    </EuiFormRow>
  );
}
