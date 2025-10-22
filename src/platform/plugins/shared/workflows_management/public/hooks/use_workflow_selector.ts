/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { useCallback, useEffect, useState } from 'react';
import { useKibana } from '@kbn/kibana-react-plugin/public';
import type { WorkflowListDto } from '@kbn/workflows';
import type {
  UseWorkflowSelectorProps,
  UseWorkflowSelectorReturn,
  WorkflowOption,
} from '../types/workflow_selector';

export function useWorkflowSelector({
  selectedWorkflowId,
  triggerType,
  prioritizeByTrigger = true,
}: UseWorkflowSelectorProps): UseWorkflowSelectorReturn {
  const { http } = useKibana().services;
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkflows = useCallback(async () => {
    if (!http) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await http.post('/api/workflows/search', {
        body: JSON.stringify({
          limit: 1000,
          page: 1,
          query: '',
        }),
      });
      const workflowsMap = response as WorkflowListDto;

      const workflowOptionsWithSortInfo = workflowsMap.results.map((workflow) => {
        const isDisabled = !workflow.enabled;
        const isSelected = workflow.id === selectedWorkflowId;
        const hasTriggerType = (workflow.definition?.triggers ?? []).some(
          (trigger) => trigger.type === triggerType
        );

        return {
          workflowOption: {
            id: workflow.id,
            name: workflow.name,
            description: workflow.description,
            enabled: workflow.enabled,
            tags: workflow.definition?.tags || [],
            label: workflow.name,
            disabled: isDisabled,
            checked: isSelected ? 'on' : undefined,
            data: {
              secondaryContent: workflow.description,
            },
          } as WorkflowOption,
          hasTriggerType,
        };
      });

      // Sort workflows by trigger type if prioritizeByTrigger is true
      const sortedWorkflowOptionsWithInfo =
        prioritizeByTrigger && triggerType
          ? workflowOptionsWithSortInfo.sort((a, b) => {
              if (a.hasTriggerType && !b.hasTriggerType) return -1;
              if (!a.hasTriggerType && b.hasTriggerType) return 1;
              return 0;
            })
          : workflowOptionsWithSortInfo;

      // Extract just the workflow options for the component
      const workflowOptions = sortedWorkflowOptionsWithInfo.map((item) => item.workflowOption);

      setWorkflows(workflowOptions);
    } catch (err) {
      setError('Failed to load workflows');
    } finally {
      setIsLoading(false);
    }
  }, [http, selectedWorkflowId, triggerType, prioritizeByTrigger]);

  const selectWorkflow = useCallback((workflowId: string) => {
    // This is handled by the parent component
    // This function is here for API consistency
  }, []);

  const searchWorkflows = useCallback(
    (query: string) => {
      // For now, we'll implement client-side filtering
      // In the future, this could be enhanced to use server-side search
      if (!query.trim()) {
        fetchWorkflows();
        return;
      }

      const filteredWorkflows = workflows.filter(
        (workflow) =>
          workflow.name.toLowerCase().includes(query.toLowerCase()) ||
          workflow.description?.toLowerCase().includes(query.toLowerCase())
      );
      setWorkflows(filteredWorkflows);
    },
    [workflows, fetchWorkflows]
  );

  const selectedWorkflow = workflows.find((w) => w.id === selectedWorkflowId) || null;

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  return {
    workflows,
    isLoading,
    error,
    selectWorkflow,
    searchWorkflows,
    selectedWorkflow,
  };
}
