/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

export interface WorkflowOption {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  tags: string[];
  label: string;
  disabled?: boolean;
  checked?: 'on' | 'off';
  
  // UI elements (consistent across all use cases)
  namePrepend?: React.ReactNode;
  prepend?: React.ReactNode;
  append?: React.ReactNode;
  data?: {
    secondaryContent?: string;
  };
  
  // Core workflow definition for validation
  definition?: {
    inputs?: {
      required?: string[];
      optional?: string[];
    };
    triggers?: Array<{ type: string }>;
  };
}

export interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
  warningMessage?: string;
  severity: 'error' | 'warning' | 'info';
}

export type WorkflowSortFunction<TContext = unknown> = (
  workflows: WorkflowOption[], 
  context?: TContext
) => WorkflowOption[];

export type WorkflowFilterFunction<TContext = unknown> = (
  workflows: WorkflowOption[], 
  searchTerm: string,
  context?: TContext
) => WorkflowOption[];

export type WorkflowValidationFunction<TContext = unknown> = (
  workflow: WorkflowOption, 
  context?: TContext
) => ValidationResult;

// Generic helper functions for Discover use case
export const getMissingRequiredFields = (workflow: WorkflowOption, document: Record<string, unknown>): string[] => {
  const requiredFields = workflow.definition?.inputs?.required || [];
  return requiredFields.filter(field => !(field in document));
};

export const isWorkflowCompatibleWithDocument = (workflow: WorkflowOption, document: Record<string, unknown>): boolean => {
  const missingFields = getMissingRequiredFields(workflow, document);
  return missingFields.length === 0;
};

export interface WorkflowSelectorProps<TContext = unknown> {
  // Core functionality
  selectedWorkflowId?: string;
  onWorkflowSelect: (workflowId: string) => void;
  onWorkflowClear?: () => void;
  
  // Configuration functions with context
  sortFunction?: WorkflowSortFunction<TContext>;
  filterFunction?: WorkflowFilterFunction<TContext>;
  validationFunction?: WorkflowValidationFunction<TContext>;
  
  // UI customization
  placeholder?: string;
  disabled?: boolean;
  showCreateLink?: boolean;
  onCreateWorkflow?: () => void;
  className?: string;
  'data-test-subj'?: string;
  
  // Context for functions
  context?: TContext;
  
  // Form integration (for backward compatibility)
  errors?: Record<string, string[]>;
  isInvalid?: boolean;
  helpText?: string;
  label?: string;
  labelAppend?: React.ReactNode;
  fullWidth?: boolean;
}
