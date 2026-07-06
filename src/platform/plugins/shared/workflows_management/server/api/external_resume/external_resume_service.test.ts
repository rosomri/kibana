/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { createHash } from 'node:crypto';
import {
  ExecutionStatus,
  HITL_TOKEN_EXPIRES_AT_INPUT_FIELD,
  HITL_TOKEN_HASH_INPUT_FIELD,
} from '@kbn/workflows';
import type { EsWorkflowStepExecution } from '@kbn/workflows';
import { WorkflowExecutionInvalidStatusError } from '@kbn/workflows/common/errors';
import type { WorkflowsExecutionEnginePluginStart } from '@kbn/workflows-execution-engine/server';
import { ExternalResumeError } from './external_resume_error';
import {
  buildExternalResumePublicPath,
  getExternalResumeFormPage,
  parseApprovedQueryParam,
  resolveExternalResumeCredentials,
  resumeWorkflowExecutionExternallyViaGet,
  resumeWorkflowExecutionExternallyWithInput,
} from './external_resume_service';
import type { WorkflowsService } from '../workflows_management_service';

const TOKEN = 'resume-token';
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');
const FUTURE_DATE = '2999-01-01T00:00:00.000Z';

function createStepExecution(
  overrides: Partial<EsWorkflowStepExecution> = {}
): EsWorkflowStepExecution {
  return {
    id: 'step-exec-1',
    workflowRunId: 'exec-1',
    spaceId: 'default',
    stepId: 'request-input',
    stepType: 'waitForInput',
    status: ExecutionStatus.WAITING_FOR_INPUT,
    input: {
      [HITL_TOKEN_HASH_INPUT_FIELD]: TOKEN_HASH,
      [HITL_TOKEN_EXPIRES_AT_INPUT_FIELD]: FUTURE_DATE,
      schema: {
        type: 'object',
        properties: {
          severity: { type: 'string', title: 'Severity' },
        },
      },
    },
    ...overrides,
  } as EsWorkflowStepExecution;
}

describe('external resume service', () => {
  const workflowsService = {
    getStepExecution: jest.fn(),
    getWorkflowsExecutionEngine: jest.fn(),
    claimHitlStepForExternalResume: jest.fn(),
  } as unknown as jest.Mocked<WorkflowsService>;

  beforeEach(() => {
    jest.clearAllMocks();
    workflowsService.getStepExecution.mockResolvedValue(createStepExecution());
    workflowsService.claimHitlStepForExternalResume.mockResolvedValue(true);
    workflowsService.getWorkflowsExecutionEngine.mockResolvedValue({
      resumeWorkflowExecution: jest.fn().mockResolvedValue({
        resumedBy: 'external_resume:step-exec-1',
      }),
    } as unknown as WorkflowsExecutionEnginePluginStart);
  });

  it('resumes a waiting waitForInput step with validated POST input', async () => {
    await resumeWorkflowExecutionExternallyWithInput(workflowsService, {
      executionId: 'exec-1',
      stepId: 'step-exec-1',
      spaceId: 'default',
      token: TOKEN,
      input: { severity: 'high' },
    });

    expect(workflowsService.getStepExecution).toHaveBeenCalledWith(
      { executionId: 'exec-1', id: 'step-exec-1' },
      'default'
    );
    expect(workflowsService.claimHitlStepForExternalResume).toHaveBeenCalledWith(
      'step-exec-1',
      'external_resume:step-exec-1',
      'default'
    );

    const engine = await workflowsService.getWorkflowsExecutionEngine();
    expect(engine.resumeWorkflowExecution).toHaveBeenCalledWith(
      'exec-1',
      'default',
      { severity: 'high' },
      undefined,
      { resumedBy: 'external_resume:step-exec-1' }
    );
  });

  it('resumes a waiting waitForApproval step via GET', async () => {
    workflowsService.getStepExecution.mockResolvedValue(
      createStepExecution({
        stepType: 'waitForApproval',
        input: {
          [HITL_TOKEN_HASH_INPUT_FIELD]: TOKEN_HASH,
          [HITL_TOKEN_EXPIRES_AT_INPUT_FIELD]: FUTURE_DATE,
        },
      })
    );

    await resumeWorkflowExecutionExternallyViaGet(workflowsService, {
      executionId: 'exec-1',
      stepId: 'step-exec-1',
      spaceId: 'default',
      token: TOKEN,
      query: { token: TOKEN, approved: 'true' },
    });

    const engine = await workflowsService.getWorkflowsExecutionEngine();
    expect(engine.resumeWorkflowExecution).toHaveBeenCalledWith(
      'exec-1',
      'default',
      { approved: true },
      undefined,
      { resumedBy: 'external_resume:step-exec-1' }
    );
  });

  it('rejects an invalid token', async () => {
    await expect(
      resumeWorkflowExecutionExternallyWithInput(workflowsService, {
        executionId: 'exec-1',
        stepId: 'step-exec-1',
        spaceId: 'default',
        token: 'wrong-token',
        input: { severity: 'high' },
      })
    ).rejects.toEqual(new ExternalResumeError('Invalid resume token', 401));
  });

  it('rejects an expired token', async () => {
    workflowsService.getStepExecution.mockResolvedValue(
      createStepExecution({
        input: {
          [HITL_TOKEN_HASH_INPUT_FIELD]: TOKEN_HASH,
          [HITL_TOKEN_EXPIRES_AT_INPUT_FIELD]: '2020-01-01T00:00:00.000Z',
        },
      })
    );

    await expect(
      resumeWorkflowExecutionExternallyWithInput(workflowsService, {
        executionId: 'exec-1',
        stepId: 'step-exec-1',
        spaceId: 'default',
        token: TOKEN,
        input: { severity: 'high' },
      })
    ).rejects.toEqual(new ExternalResumeError('Link expired or already used', 401));
  });

  it('rejects when the waiting step was already claimed', async () => {
    workflowsService.claimHitlStepForExternalResume.mockResolvedValue(false);

    await expect(
      resumeWorkflowExecutionExternallyWithInput(workflowsService, {
        executionId: 'exec-1',
        stepId: 'step-exec-1',
        spaceId: 'default',
        token: TOKEN,
        input: { severity: 'high' },
      })
    ).rejects.toEqual(
      new ExternalResumeError('This workflow response link is no longer valid', 409)
    );

    const engine = await workflowsService.getWorkflowsExecutionEngine();
    expect(engine.resumeWorkflowExecution).not.toHaveBeenCalled();
  });

  it('maps engine invalid-status errors to ExternalResumeError', async () => {
    workflowsService.getWorkflowsExecutionEngine.mockResolvedValue({
      resumeWorkflowExecution: jest
        .fn()
        .mockRejectedValue(
          new WorkflowExecutionInvalidStatusError('exec-1', 'running', 'waiting_for_input')
        ),
    } as unknown as WorkflowsExecutionEnginePluginStart);

    await expect(
      resumeWorkflowExecutionExternallyWithInput(workflowsService, {
        executionId: 'exec-1',
        stepId: 'step-exec-1',
        spaceId: 'default',
        token: TOKEN,
        input: { severity: 'high' },
      })
    ).rejects.toEqual(
      new ExternalResumeError('Workflow execution is not waiting for external input', 409)
    );
  });
});

describe('getExternalResumeFormPage', () => {
  const workflowsService = {
    getStepExecution: jest.fn(),
  } as unknown as jest.Mocked<WorkflowsService>;

  beforeEach(() => {
    jest.clearAllMocks();
    workflowsService.getStepExecution.mockResolvedValue(
      createStepExecution({
        input: {
          [HITL_TOKEN_HASH_INPUT_FIELD]: TOKEN_HASH,
          [HITL_TOKEN_EXPIRES_AT_INPUT_FIELD]: FUTURE_DATE,
          message: 'Please respond',
          schema: {
            type: 'object',
            properties: {
              severity: { type: 'string', title: 'Severity' },
            },
          },
        },
      })
    );
  });

  it('returns an HTML form page', async () => {
    const html = await getExternalResumeFormPage(workflowsService, {
      executionId: 'exec-1',
      stepId: 'step-exec-1',
      spaceId: 'default',
      token: TOKEN,
      basePath: '',
    });

    expect(html).toContain('Submit your response');
    expect(html).toContain('Please respond');
    expect(html).toContain('name="severity"');
    expect(html).toContain(
      `action="${buildExternalResumePublicPath({
        basePath: '',
        executionId: 'exec-1',
        stepId: 'step-exec-1',
        token: TOKEN,
      })}"`
    );
  });
});

describe('resolveExternalResumeCredentials', () => {
  it('returns the token query parameter', () => {
    expect(resolveExternalResumeCredentials({ token: 'token-1' })).toEqual({ token: 'token-1' });
  });

  it('rejects requests with no token', () => {
    expect(() => resolveExternalResumeCredentials({})).toThrow(
      new ExternalResumeError('token query parameter is required', 401)
    );
  });
});

describe('parseApprovedQueryParam', () => {
  it('parses boolean and string values', () => {
    expect(parseApprovedQueryParam(true)).toBe(true);
    expect(parseApprovedQueryParam('true')).toBe(true);
    expect(parseApprovedQueryParam(false)).toBe(false);
    expect(parseApprovedQueryParam('false')).toBe(false);
  });

  it('rejects invalid values', () => {
    expect(() => parseApprovedQueryParam('maybe')).toThrow(
      new ExternalResumeError('approved query parameter must be true or false', 400)
    );
  });
});
