/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { useEffect, useState } from 'react';
import { useKibana } from '@kbn/kibana-react-plugin/public';
import type { WorkflowListDto } from '@kbn/workflows';
import type { WorkflowOption } from './types';
import { IconDisabledWorkflow } from '../../assets/icons';
import * as i18n from '../../connectors/workflows/translations';

interface UseWorkflowListOptions {
  enabled?: boolean;
  limit?: number;
  includeDisabled?: boolean;
  filterByTriggerType?: string[];
}

interface UseWorkflowListReturn {
  workflows: WorkflowOption[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export const useWorkflowList = (options: UseWorkflowListOptions = {}): UseWorkflowListReturn => {
  const { enabled = true, limit = 1000 } = options;
  const { http } = useKibana().services;
  
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkflows = async () => {
    if (!http || !enabled) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await http.post('/api/workflows/search', {
        body: JSON.stringify({
          limit,
          page: 1,
          query: '',
        }),
      });
      const workflowsMap = response as WorkflowListDto;

      const workflowOptions = workflowsMap.results.map((workflow) => {
        // TODO: remove this once we have a way to disable workflows
        const isDisabled = !workflow.enabled;

        // Determine what to show in prepend
        let prependNameElement;
        if (isDisabled) {
          // Show disabled icon for disabled workflows
          prependNameElement = (
            <IconDisabledWorkflow
              size="m"
              style={{ marginRight: '8px' }}
              aria-label={i18n.DISABLED_BADGE_LABEL}
            />
          );
        }

        const workflowTags = workflow.definition?.tags || [];

        return {
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          enabled: workflow.enabled,
          tags: workflowTags,
          label: workflow.name,
          disabled: isDisabled,
          namePrepend: prependNameElement,
          data: {
            secondaryContent: workflow.description || 'No description',
          },
          definition: workflow.definition,
        } as WorkflowOption;
      });

      setWorkflows(workflowOptions);
    } catch (err) {
      setError(i18n.FAILED_TO_LOAD_WORKFLOWS);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkflows();
  }, [http, enabled, limit]);

  return {
    workflows,
    isLoading,
    error,
    refetch: fetchWorkflows,
  };
};
