/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { EnterWhileNode } from '@kbn/workflows/graph';
import type { StepExecutionRuntime } from '../../workflow_context_manager/step_execution_runtime';
import type { WorkflowExecutionRuntimeManager } from '../../workflow_context_manager/workflow_execution_runtime_manager';
import type { IWorkflowEventLogger } from '../../workflow_event_logger';
import type { NodeImplementation } from '../node_implementation';

const DEFAULT_MAX_ITERATIONS = 100;

/**
 * Do-while loop: the first iteration always executes unconditionally.
 * After each iteration the condition is re-evaluated with inner step
 * outputs available under the `while.*` context namespace.
 *
 * If you want a while step that may not run at all, wrap it with an
 * outer `if` step.
 */
export class EnterWhileNodeImpl implements NodeImplementation {
  constructor(
    private node: EnterWhileNode,
    private wfExecutionRuntimeManager: WorkflowExecutionRuntimeManager,
    private stepExecutionRuntime: StepExecutionRuntime,
    private workflowLogger: IWorkflowEventLogger
  ) {}

  public async run(): Promise<void> {
    if (!this.stepExecutionRuntime.getCurrentStepState()) {
      this.enterWhile();
    } else {
      this.advanceIteration();
    }
  }

  private get maxIterations(): number {
    return (
      (this.node.configuration['max-iterations'] as number | undefined) ?? DEFAULT_MAX_ITERATIONS
    );
  }

  private enterWhile(): void {
    this.stepExecutionRuntime.startStep();

    this.stepExecutionRuntime.setInput({
      iteration: 0,
      condition: this.node.configuration.condition,
      conditionResult: null,
      'max-iterations': this.maxIterations,
    });

    this.workflowLogger.logDebug(
      `While step "${this.node.stepId}" starting first iteration unconditionally.`,
      { workflow: { step_id: this.node.stepId } }
    );

    this.stepExecutionRuntime.setCurrentStepState({ iteration: 0 });
    this.wfExecutionRuntimeManager.enterScope('0');
    this.wfExecutionRuntimeManager.navigateToNextNode();
  }

  /**
   * Called on re-entry from exitWhile. At this point the while state
   * already contains inner step outputs captured by the exit node.
   */
  private advanceIteration(): void {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const state = this.stepExecutionRuntime.getCurrentStepState()!;
    const completedIteration = state.iteration as number;
    const completedIterations = completedIteration + 1;
    const nextIteration = completedIteration + 1;

    const conditionResult = this.evaluateCondition(state);

    if (!conditionResult) {
      this.workflowLogger.logDebug(
        `While step "${this.node.stepId}" condition evaluated to false after ${completedIterations} iteration(s). Terminating loop.`,
        { workflow: { step_id: this.node.stepId } }
      );
      this.stepExecutionRuntime.setInput({
        iteration: completedIteration,
        condition: this.node.configuration.condition,
        conditionResult: false,
        'max-iterations': this.maxIterations,
      });
      this.stepExecutionRuntime.setCurrentStepState({
        ...state,
        iteration: completedIteration,
        iterations: completedIterations,
        terminated_by: 'condition',
      });
      this.wfExecutionRuntimeManager.navigateToNode(this.node.exitNodeId);
      return;
    }

    if (nextIteration >= this.maxIterations) {
      this.workflowLogger.logDebug(
        `While step "${this.node.stepId}" reached max-iterations (${this.maxIterations}). Terminating loop.`,
        { workflow: { step_id: this.node.stepId } }
      );
      this.stepExecutionRuntime.setInput({
        iteration: completedIteration,
        condition: this.node.configuration.condition,
        conditionResult: true,
        'max-iterations': this.maxIterations,
        terminated_by: 'max_iterations',
      });
      this.stepExecutionRuntime.setCurrentStepState({
        ...state,
        iteration: completedIteration,
        iterations: completedIterations,
        terminated_by: 'max_iterations',
      });
      this.wfExecutionRuntimeManager.navigateToNode(this.node.exitNodeId);
      return;
    }

    this.workflowLogger.logDebug(
      `While step "${this.node.stepId}" condition still true. Starting iteration ${nextIteration}.`,
      { workflow: { step_id: this.node.stepId } }
    );

    this.stepExecutionRuntime.setInput({
      iteration: nextIteration,
      condition: this.node.configuration.condition,
      conditionResult: true,
      'max-iterations': this.maxIterations,
    });
    this.stepExecutionRuntime.setCurrentStepState({
      ...state,
      iteration: nextIteration,
    });
    this.wfExecutionRuntimeManager.enterScope(nextIteration.toString());
    this.wfExecutionRuntimeManager.navigateToNextNode();
  }

  /**
   * Evaluate the condition with the while state injected as additional
   * context so that `${{ while.<step>.output.* }}` resolves correctly.
   */
  private evaluateCondition(whileState: Record<string, unknown>): boolean {
    return this.stepExecutionRuntime.contextManager.evaluateBooleanExpressionInContext(
      this.node.configuration.condition,
      { while: whileState }
    );
  }
}
