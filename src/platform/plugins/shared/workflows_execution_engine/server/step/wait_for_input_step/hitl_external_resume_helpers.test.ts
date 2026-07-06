/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { HITL_TOKEN_EXPIRES_AT_INPUT_FIELD, HITL_TOKEN_HASH_INPUT_FIELD } from '@kbn/workflows';
import {
  invalidateHitlExternalResumeTokenIfPresent,
  mintHitlExternalResumeToken,
  removeHitlExternalResumeTokenFields,
} from './hitl_external_resume_helpers';
import type { StepExecutionRuntime } from '../../workflow_context_manager/step_execution_runtime';

describe('mintHitlExternalResumeToken', () => {
  it('converts workflow timeout to a token expiration timestamp', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

      const token = mintHitlExternalResumeToken({
        stepExecutionRuntime: {} as StepExecutionRuntime,
        execution: { id: 'execution-id', workflowId: 'workflow-id' } as Parameters<
          typeof mintHitlExternalResumeToken
        >[0]['execution'],
        timeout: '2w',
      });

      expect(token.token).toHaveLength(64);
      expect(token.tokenHash).toHaveLength(64);
      expect(token.expiresAt).toBe('2026-01-15T00:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('removeHitlExternalResumeTokenFields', () => {
  it('removes token metadata while preserving user input fields', () => {
    expect(
      removeHitlExternalResumeTokenFields({
        message: 'Please respond',
        schema: { type: 'object' },
        [HITL_TOKEN_HASH_INPUT_FIELD]: 'hash',
        [HITL_TOKEN_EXPIRES_AT_INPUT_FIELD]: '2999-01-01T00:00:00.000Z',
      })
    ).toEqual({
      message: 'Please respond',
      schema: { type: 'object' },
    });
  });
});

describe('invalidateHitlExternalResumeTokenIfPresent', () => {
  it('clears token metadata from the current step input', () => {
    const setInput = jest.fn();
    const stepExecutionRuntime = {
      stepExecution: {
        input: {
          message: 'Please respond',
          [HITL_TOKEN_HASH_INPUT_FIELD]: 'hash',
          [HITL_TOKEN_EXPIRES_AT_INPUT_FIELD]: '2999-01-01T00:00:00.000Z',
        },
      },
      setInput,
    } as unknown as StepExecutionRuntime;

    invalidateHitlExternalResumeTokenIfPresent(stepExecutionRuntime);

    expect(setInput).toHaveBeenCalledWith({ message: 'Please respond' });
  });

  it('does nothing when token metadata is absent', () => {
    const setInput = jest.fn();
    const stepExecutionRuntime = {
      stepExecution: { input: { message: 'Please respond' } },
      setInput,
    } as unknown as StepExecutionRuntime;

    invalidateHitlExternalResumeTokenIfPresent(stepExecutionRuntime);

    expect(setInput).not.toHaveBeenCalled();
  });
});
