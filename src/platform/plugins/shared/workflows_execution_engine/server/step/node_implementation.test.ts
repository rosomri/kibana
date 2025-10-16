/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { RunStepResult } from './node_implementation';
import { BaseAtomicNodeImplementation } from './node_implementation';
import type { StepExecutionRuntime } from '../workflow_context_manager/step_execution_runtime';
import type { WorkflowExecutionRuntimeManager } from '../workflow_context_manager/workflow_execution_runtime_manager';
import type { WorkflowContextManager } from '../workflow_context_manager/workflow_context_manager';

// Test implementation of BaseAtomicNodeImplementation
class TestStepImpl extends BaseAtomicNodeImplementation<any> {
  private mockGetInput: () => any;
  private mockRun: (input: any) => Promise<RunStepResult>;

  constructor(
    step: any,
    stepExecutionRuntime: StepExecutionRuntime,
    workflowRuntime: WorkflowExecutionRuntimeManager,
    getInputFn: () => any,
    runFn: (input: any) => Promise<RunStepResult>
  ) {
    super(step, stepExecutionRuntime, undefined, workflowRuntime);
    this.mockGetInput = getInputFn;
    this.mockRun = runFn;
  }

  public getInput() {
    return this.mockGetInput();
  }

  protected async _run(input?: any): Promise<RunStepResult> {
    return this.mockRun(input);
  }
}

describe('BaseAtomicNodeImplementation', () => {
  let mockStepExecutionRuntime: jest.Mocked<StepExecutionRuntime>;
  let mockWorkflowRuntime: jest.Mocked<WorkflowExecutionRuntimeManager>;
  let mockContextManager: jest.Mocked<Pick<WorkflowContextManager, 'getContext'>> & {
    abortController: AbortController;
  };
  let abortController: AbortController;

  beforeEach(() => {
    abortController = new AbortController();
    mockContextManager = {
      getContext: jest.fn().mockReturnValue({}),
      abortController,
    };

    mockStepExecutionRuntime = {
      contextManager: mockContextManager,
      startStep: jest.fn().mockResolvedValue(undefined),
      finishStep: jest.fn().mockResolvedValue(undefined),
      failStep: jest.fn().mockResolvedValue(undefined),
      getCurrentStepState: jest.fn(),
      setCurrentStepState: jest.fn().mockResolvedValue(undefined),
      stepExecutionId: 'test-step-exec-id',
      abortController,
    } as any;

    mockWorkflowRuntime = {
      navigateToNextNode: jest.fn(),
    } as any;

    jest.clearAllMocks();
  });

  describe('template rendering error handling', () => {
    it('should fail only the specific step when template rendering throws an error', async () => {
      const step = {
        name: 'test-step',
        type: 'console',
        spaceId: 'default',
        with: {
          message: '{{ invalid | nonExistentFilter }}',
        },
      };

      const getInputFn = jest.fn(() => {
        throw new Error('Unknown filter: nonExistentFilter');
      });

      const runFn = jest.fn().mockResolvedValue({
        input: {},
        output: 'success',
        error: undefined,
      });

      const testStep = new TestStepImpl(
        step,
        mockStepExecutionRuntime,
        mockWorkflowRuntime,
        getInputFn,
        runFn
      );

      await testStep.run();

      // Verify getInput was called
      expect(getInputFn).toHaveBeenCalled();

      // Verify step was started with empty input (since getInput failed)
      expect(mockStepExecutionRuntime.startStep).toHaveBeenCalledWith({});

      // Verify step was failed with template error message
      expect(mockStepExecutionRuntime.failStep).toHaveBeenCalledWith(
        'Template rendering error: Unknown filter: nonExistentFilter'
      );

      // Verify _run was NOT called (since getInput failed)
      expect(runFn).not.toHaveBeenCalled();

      // Verify workflow continues to next step
      expect(mockWorkflowRuntime.navigateToNextNode).toHaveBeenCalled();

      // Verify finishStep was NOT called (step should fail, not finish)
      expect(mockStepExecutionRuntime.finishStep).not.toHaveBeenCalled();
    });

    it('should include template rendering error message in step failure', async () => {
      const step = {
        name: 'test-step',
        type: 'http',
        spaceId: 'default',
        with: {
          url: '{{ baseUrl }}/api',
        },
      };

      const errorMessage = 'Template parse error at line 1: unexpected token';
      const getInputFn = jest.fn(() => {
        throw new Error(errorMessage);
      });

      const runFn = jest.fn();

      const testStep = new TestStepImpl(
        step,
        mockStepExecutionRuntime,
        mockWorkflowRuntime,
        getInputFn,
        runFn
      );

      await testStep.run();

      expect(mockStepExecutionRuntime.failStep).toHaveBeenCalledWith(
        `Template rendering error: ${errorMessage}`
      );
    });

    it('should handle non-Error objects thrown during template rendering', async () => {
      const step = {
        name: 'test-step',
        type: 'console',
        spaceId: 'default',
      };

      const getInputFn = jest.fn(() => {
        // eslint-disable-next-line no-throw-literal
        throw 'string error message';
      });

      const runFn = jest.fn();

      const testStep = new TestStepImpl(
        step,
        mockStepExecutionRuntime,
        mockWorkflowRuntime,
        getInputFn,
        runFn
      );

      await testStep.run();

      expect(mockStepExecutionRuntime.failStep).toHaveBeenCalledWith(
        'Template rendering error: string error message'
      );
    });

    it('should still fail the step if _run throws after successful getInput', async () => {
      const step = {
        name: 'test-step',
        type: 'console',
        spaceId: 'default',
        with: {
          message: 'Hello World',
        },
      };

      const inputData = { message: 'Hello World' };
      const getInputFn = jest.fn(() => inputData);

      const runFn = jest.fn().mockRejectedValue(new Error('Execution failed'));

      const testStep = new TestStepImpl(
        step,
        mockStepExecutionRuntime,
        mockWorkflowRuntime,
        getInputFn,
        runFn
      );

      await testStep.run();

      // Verify getInput succeeded
      expect(getInputFn).toHaveBeenCalled();
      expect(mockStepExecutionRuntime.startStep).toHaveBeenCalledWith(inputData);

      // Verify _run was called
      expect(runFn).toHaveBeenCalledWith(inputData);

      // Verify step failed due to execution error (not template error)
      expect(mockStepExecutionRuntime.failStep).toHaveBeenCalledWith('Execution failed');

      // Verify workflow continues
      expect(mockWorkflowRuntime.navigateToNextNode).toHaveBeenCalled();
    });

    it('should successfully complete when both getInput and _run succeed', async () => {
      const step = {
        name: 'test-step',
        type: 'console',
        spaceId: 'default',
        with: {
          message: 'Hello World',
        },
      };

      const inputData = { message: 'Hello World' };
      const outputData = 'Success!';
      const getInputFn = jest.fn(() => inputData);

      const runFn = jest.fn().mockResolvedValue({
        input: inputData,
        output: outputData,
        error: undefined,
      });

      const testStep = new TestStepImpl(
        step,
        mockStepExecutionRuntime,
        mockWorkflowRuntime,
        getInputFn,
        runFn
      );

      await testStep.run();

      // Verify both getInput and _run succeeded
      expect(getInputFn).toHaveBeenCalled();
      expect(runFn).toHaveBeenCalledWith(inputData);

      // Verify step was started and finished successfully
      expect(mockStepExecutionRuntime.startStep).toHaveBeenCalledWith(inputData);
      expect(mockStepExecutionRuntime.finishStep).toHaveBeenCalledWith(outputData);

      // Verify step was NOT failed
      expect(mockStepExecutionRuntime.failStep).not.toHaveBeenCalled();

      // Verify workflow continues
      expect(mockWorkflowRuntime.navigateToNextNode).toHaveBeenCalled();
    });

    it('should not update step execution runtime if abort was initiated', async () => {
      const step = {
        name: 'test-step',
        type: 'console',
        spaceId: 'default',
      };

      const inputData = { message: 'Hello' };
      const getInputFn = jest.fn(() => inputData);

      const runFn = jest.fn().mockImplementation(async () => {
        // Simulate abort during execution
        abortController.abort();
        return {
          input: inputData,
          output: 'output',
          error: undefined,
        };
      });

      const testStep = new TestStepImpl(
        step,
        mockStepExecutionRuntime,
        mockWorkflowRuntime,
        getInputFn,
        runFn
      );

      await testStep.run();

      // Verify step was started
      expect(mockStepExecutionRuntime.startStep).toHaveBeenCalled();

      // Verify finishStep and failStep were NOT called (abort prevents updates)
      expect(mockStepExecutionRuntime.finishStep).not.toHaveBeenCalled();
      expect(mockStepExecutionRuntime.failStep).not.toHaveBeenCalled();

      // Note: navigateToNextNode is still called after the try-catch
      expect(mockWorkflowRuntime.navigateToNextNode).toHaveBeenCalled();
    });
  });
});

