/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { useState, useEffect, useCallback } from 'react';
import { useKibana } from '@kbn/kibana-react-plugin/public';
import type { WorkflowListDto, WorkflowListItemDto } from '@kbn/workflows';

export interface WorkflowOption {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  tags: string[];
  label: string;
  disabled?: boolean;
  checked?: 'on' | 'off';
}

export interface UseWorkflowSelectorOptions {
  /**
   * Optional trigger type to filter workflows by
   */
  triggerType?: string;

  /**
   * Whether to prioritize/sort workflows by trigger type
   */
  prioritizeByTrigger?: boolean;
}

export interface UseWorkflowSelectorResult {
  /**
   * List of workflow options
   */
  workflows: WorkflowOption[];

  /**
   * Currently selected workflow ID
   */
  selectedWorkflowId: string | null;

  /**
   * Whether workflows are being loaded
   */
  isLoading: boolean;

  /**
   * Error message if loading failed
   */
  error: string | null;

  /**
   * Select a workflow by ID
   */
  selectWorkflow: (workflowId: string) => void;

  /**
   * Clear the current selection
   */
  clearSelection: () => void;

  /**
   * Open a workflow in a new tab
   */
  openWorkflow: (workflowId: string) => void;

  /**
   * Navigate to create new workflow
   */
  createNewWorkflow: () => void;
}

/**
 * Hook for managing workflow selection
 * Handles fetching, filtering, and selecting workflows
 */
export function useWorkflowSelector(
  options: UseWorkflowSelectorOptions = {}
): UseWorkflowSelectorResult {
  const { triggerType, prioritizeByTrigger = false } = options;
  const { http, application } = useKibana().services;
  
  // eslint-disable-next-line no-console
  console.log('useWorkflowSelector called:', { http: !!http, application: !!application, triggerType, prioritizeByTrigger });
  
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch workflows from API
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('useEffect running, http available:', !!http);
    
    const fetchWorkflows = async () => {
      if (!http) {
        // eslint-disable-next-line no-console
        console.log('No http service available, skipping fetch');
        return;
      }

      // eslint-disable-next-line no-console
      console.log('Fetching workflows from API...');
      
      setIsLoading(true);
      setError(null);

      try {
        const response = await http.post<WorkflowListDto>('/api/workflows/search', {
          body: JSON.stringify({
            page: 1,
            limit: 1000,
          }),
        });

        // eslint-disable-next-line no-console
        console.log('Workflows API response:', response);

        let workflowList: WorkflowListItemDto[] = response.results || [];

        // Sort workflows - prioritize matching trigger type
        if (prioritizeByTrigger && triggerType) {
          workflowList = workflowList.sort((a, b) => {
            const aTriggers = a.definition?.triggers || [];
            const bTriggers = b.definition?.triggers || [];

            const aHasTrigger = aTriggers.some((t: any) => t.type === triggerType);
            const bHasTrigger = bTriggers.some((t: any) => t.type === triggerType);

            if (aHasTrigger && !bHasTrigger) return -1;
            if (!aHasTrigger && bHasTrigger) return 1;
            return 0;
          });
        }

        // Transform to workflow options
        const workflowOptions: WorkflowOption[] = workflowList.map((workflow) => ({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description || '',
          enabled: workflow.enabled,
          tags: (workflow as any).tags || [],
          label: workflow.name,
          disabled: !workflow.enabled,
        }));

        setWorkflows(workflowOptions);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load workflows';
        // eslint-disable-next-line no-console
        console.error('Failed to fetch workflows:', err);
        setError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    };

    fetchWorkflows();
  }, [http, triggerType, prioritizeByTrigger]);

  // Select a workflow
  const selectWorkflow = useCallback((workflowId: string) => {
    setSelectedWorkflowId(workflowId);
  }, []);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedWorkflowId(null);
  }, []);

  // Open workflow in new tab
  const openWorkflow = useCallback(
    (workflowId: string) => {
      const url = application?.getUrlForApp
        ? application.getUrlForApp('workflows', { path: `/${workflowId}` })
        : `/app/workflows/${workflowId}`;
      window.open(url, '_blank');
    },
    [application]
  );

  // Navigate to create new workflow
  const createNewWorkflow = useCallback(() => {
    const url = application?.getUrlForApp
      ? application.getUrlForApp('workflows')
      : '/app/workflows';
    window.open(url, '_blank');
  }, [application]);

  return {
    workflows,
    selectedWorkflowId,
    isLoading,
    error,
    selectWorkflow,
    clearSelection,
    openWorkflow,
    createNewWorkflow,
  };
}
