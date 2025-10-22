/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ReactNode } from 'react';

export interface WorkflowOption {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  tags: string[];
  label: string;
  disabled?: boolean;
  checked?: 'on' | 'off';
  prepend?: ReactNode;
  append?: ReactNode;
  data?: {
    secondaryContent?: string;
  };
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface WorkflowSelectorCoreProps {
  /**
   * Currently selected workflow ID
   */
  selectedWorkflowId?: string;

  /**
   * Callback when workflow selection changes
   */
  onWorkflowChange: (workflowId: string, workflowName: string) => void;

  /**
   * Optional trigger type to filter workflows
   */
  triggerType?: string;

  /**
   * Whether to prioritize workflows by trigger type
   */
  prioritizeByTrigger?: boolean;

  /**
   * Placeholder text for the search input
   */
  placeholder?: string;

  /**
   * Whether the selector is disabled
   */
  disabled?: boolean;

  /**
   * Test subject for the component
   */
  'data-test-subj'?: string;

  /**
   * Whether to show the "View all workflows" link
   */
  showViewAllLink?: boolean;

  /**
   * Custom error message to display
   */
  error?: string;

  /**
   * Custom help text to display
   */
  helpText?: string;
}

export interface UseWorkflowSelectorProps {
  /**
   * Currently selected workflow ID
   */
  selectedWorkflowId?: string;

  /**
   * Optional trigger type to filter workflows
   */
  triggerType?: string;

  /**
   * Whether to prioritize workflows by trigger type
   */
  prioritizeByTrigger?: boolean;
}

export interface UseWorkflowSelectorReturn {
  workflows: WorkflowOption[];
  isLoading: boolean;
  error: string | null;
  selectWorkflow: (workflowId: string) => void;
  searchWorkflows: (query: string) => void;
  selectedWorkflow: WorkflowOption | null;
}
