/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@kbn/react-query';
import { coreMock } from '@kbn/core/public/mocks';
import { testQueryClientConfig } from '../test_utils';
import { useRunWorkflow } from './use_run_workflow';
import type { RunWorkflowResponseDto } from '@kbn/workflows';

jest.mock('@kbn/kibana-react-plugin/public', () => ({
  useKibana: jest.fn(),
}));

import { useKibana } from '@kbn/kibana-react-plugin/public';

const queryClient = new QueryClient(testQueryClientConfig);
const mockCore = coreMock.createStart();
const mockUseKibana = useKibana as jest.MockedFunction<typeof useKibana>;

const wrapper: React.FC<React.PropsWithChildren<{}>> = ({ children }) =>
  React.createElement(QueryClientProvider, { client: queryClient }, children);

describe('useRunWorkflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryClient.clear();
    mockUseKibana.mockReturnValue({
      services: {
        http: mockCore.http,
      },
    } as any);
  });

  it('executes workflow and returns execution ID', async () => {
    const mockResponse: RunWorkflowResponseDto = {
      workflowExecutionId: 'execution-123',
    };
    const workflowId = 'workflow-456';
    const inputs = { event: { field: 'value' } };

    mockCore.http.post.mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useRunWorkflow(), { wrapper });

    const response = await result.current.mutateAsync({ workflowId, inputs });

    expect(mockCore.http.post).toHaveBeenCalledWith(`/api/workflows/${workflowId}/run`, {
      body: JSON.stringify({ inputs }),
    });
    expect(response.workflowExecutionId).toBe('execution-123');
  });

  it('propagates HTTP errors', async () => {
    const mockError = { body: { message: 'Not found' }, statusCode: 404 };
    mockCore.http.post.mockRejectedValue(mockError);

    const { result } = renderHook(() => useRunWorkflow(), { wrapper });

    await expect(
      result.current.mutateAsync({ workflowId: 'workflow-1', inputs: {} })
    ).rejects.toEqual(mockError);
  });
});
