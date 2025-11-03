/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { useMutation } from '@kbn/react-query';
import { useKibana } from '@kbn/kibana-react-plugin/public';
import type { HttpStart, IHttpFetchError, ResponseErrorBody } from '@kbn/core/public';
import type { RunWorkflowCommand, RunWorkflowResponseDto } from '@kbn/workflows';

type HttpError = IHttpFetchError<ResponseErrorBody>;

export interface RunWorkflowParams {
  workflowId: string;
  inputs: RunWorkflowCommand['inputs'];
}

export function useRunWorkflow() {
  const { http } = useKibana<{ http: HttpStart }>().services;

  return useMutation<RunWorkflowResponseDto, HttpError, RunWorkflowParams>({
    mutationKey: ['POST', 'workflows', 'id', 'run'],
    mutationFn: async ({ workflowId, inputs }) => {
      const response = await http.post<RunWorkflowResponseDto>(`/api/workflows/${workflowId}/run`, {
        body: JSON.stringify({ inputs }),
      });

      return response;
    },
  });
}
