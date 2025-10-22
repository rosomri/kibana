/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  EuiBadge,
  EuiHighlight,
  EuiIcon,
  EuiInputPopover,
  EuiLink,
  EuiLoadingSpinner,
  EuiPopover,
  EuiPopoverFooter,
  EuiSelectable,
  EuiText,
  useEuiTheme,
} from '@elastic/eui';
import { useKibana } from '@kbn/kibana-react-plugin/public';
import React, { useCallback, useState } from 'react';
import { useWorkflowSelector } from '../hooks/use_workflow_selector';
import type { WorkflowSelectorCoreProps, WorkflowOption } from '../types/workflow_selector';

const TagsBadge: React.FC<{ tags: string[] }> = ({ tags }) => {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  if (tags.length === 0) {
    return null;
  }

  const handlePopoverToggle = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    setIsPopoverOpen(!isPopoverOpen);
  };

  return (
    <EuiPopover
      button={
        <EuiBadge
          color="hollow"
          iconType="tag"
          onClick={handlePopoverToggle}
          onClickAriaLabel="Show tags"
          style={{ cursor: 'pointer' }}
        >
          {tags.length}
        </EuiBadge>
      }
      isOpen={isPopoverOpen}
      closePopover={() => setIsPopoverOpen(false)}
      panelPaddingSize="s"
      anchorPosition="downLeft"
    >
      <EuiBadge color="hollow" style={{ maxWidth: '150px' }}>
        {tags.join(', ')}
      </EuiBadge>
    </EuiPopover>
  );
};

/**
 * Core workflow selector component with shared logic
 *
 * This component provides the core workflow selection functionality
 * that can be used in different contexts (alerts, Discover, etc.)
 */
export const WorkflowSelectorCore: React.FC<WorkflowSelectorCoreProps> = ({
  selectedWorkflowId,
  onWorkflowChange,
  triggerType,
  prioritizeByTrigger = true,
  placeholder = 'Select workflow',
  disabled = false,
  'data-test-subj': dataTestSubj = 'workflowSelector',
  showViewAllLink = true,
  error,
  helpText,
}) => {
  const { application } = useKibana().services;
  const { euiTheme } = useEuiTheme();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isSearching, setIsSearching] = useState(true);

  const { workflows, isLoading, searchWorkflows } = useWorkflowSelector({
    selectedWorkflowId,
    triggerType,
    prioritizeByTrigger,
  });

  // Custom render function for workflow options
  const renderWorkflowOption = useCallback((option: WorkflowOption, searchValue: string) => {
    return (
      <>
        <EuiHighlight search={searchValue}>{option.label}</EuiHighlight>
        {option.data?.secondaryContent && (
          <EuiText size="xs" color="subdued" className="eui-displayBlock">
            <small>
              <EuiHighlight search={searchValue}>{option.data.secondaryContent}</EuiHighlight>
            </small>
          </EuiText>
        )}
        {option.tags && option.tags.length > 0 && (
          <div style={{ marginTop: '4px' }}>
            <TagsBadge tags={option.tags} />
          </div>
        )}
      </>
    );
  }, []);

  const handleWorkflowChange = useCallback(
    (newOptions: WorkflowOption[], event: any, changedOption: WorkflowOption) => {
      setIsPopoverOpen(false);

      if (changedOption.checked === 'on') {
        onWorkflowChange(changedOption.id, changedOption.name);
        setInputValue(changedOption.name);
        setIsSearching(false);
      } else {
        onWorkflowChange('', '');
        setInputValue('');
        setIsSearching(true);
      }
    },
    [onWorkflowChange]
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

  // Update input value when selectedWorkflowId changes
  React.useEffect(() => {
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

  const workflowOptions =
    workflows.length > 0
      ? workflows
      : [
          {
            id: '',
            name: 'No workflows available',
            description: '',
            enabled: false,
            tags: [],
            label: 'No workflows available',
            disabled: true,
          },
        ];

  if (isLoading) {
    return <EuiLoadingSpinner size="m" />;
  }

  return (
    <EuiSelectable
      aria-label="Select workflow"
      options={workflowOptions as any}
      onChange={handleWorkflowChange as any}
      singleSelection
      searchable
      searchProps={{
        value: inputValue,
        onChange: (value) => {
          setInputValue(value);
          setIsSearching(true);
          searchWorkflows(value);
        },
        onKeyDown: (event) => {
          if (event.key === 'Tab') return handlePopoverClose();
          if (event.key === 'Escape') return handlePopoverClose();
          if (event.key !== 'Escape') return setIsPopoverOpen(true);
        },
        onClick: () => setIsPopoverOpen(true),
        onFocus: () => setIsPopoverOpen(true),
        placeholder,
        disabled,
      }}
      isPreFiltered={isSearching ? false : { highlightSearch: false }}
      data-test-subj={dataTestSubj}
      listProps={{
        rowHeight: 60, // Increased height to accommodate secondary content and tags
        showIcons: false,
        css: {
          // Hide the badge when the option is focused
          // This should be configurable in EUI, but it's not :(
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
          input={search!}
          panelPaddingSize="none"
          fullWidth
        >
          {list}
          {showViewAllLink && (
            <EuiPopoverFooter
              paddingSize="s"
              css={{ backgroundColor: euiTheme.colors.backgroundBaseSubdued }}
            >
              <EuiText size="s" textAlign="right">
                <EuiLink onClick={handleOpenWorkflowManagementApp} external>
                  View all workflows <EuiIcon type="popout" size="s" />
                </EuiLink>
              </EuiText>
            </EuiPopoverFooter>
          )}
        </EuiInputPopover>
      )}
    </EuiSelectable>
  );
};