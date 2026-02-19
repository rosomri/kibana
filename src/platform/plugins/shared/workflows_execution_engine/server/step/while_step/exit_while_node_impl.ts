/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ExitWhileNode } from '@kbn/workflows/graph';
import type { StepExecutionRuntime } from '../../workflow_context_manager/step_execution_runtime';
import type { WorkflowExecutionRuntimeManager } from '../../workflow_context_manager/workflow_execution_runtime_manager';
import type { IWorkflowEventLogger } from '../../workflow_event_logger';
import type { NodeImplementation } from '../node_implementation';

export class ExitWhileNodeImpl implements NodeImplementation {
  constructor(
    private node: ExitWhileNode,
    private stepExecutionRuntime: StepExecutionRuntime,
    private wfExecutionRuntimeManager: WorkflowExecutionRuntimeManager,
    private workflowLogger: IWorkflowEventLogger
  ) {}

  public run(): void {
    const whileState = this.stepExecutionRuntime.getCurrentStepState();

    if (!whileState) {
      throw new Error(`While state for step ${this.node.stepId} not found`);
    }

    if (whileState.terminated_by) {
      this.stepExecutionRuntime.finishStep({
        iterations: whileState.iterations,
        iteration: whileState.iteration,
        terminated_by: whileState.terminated_by,
        conditionResult: whileState.terminated_by === 'condition' ? false : true,
      });
      this.workflowLogger.logDebug(
        `Exiting while step ${this.node.stepId} after ${whileState.iterations} iteration(s). Terminated by: ${whileState.terminated_by}.`,
        { workflow: { step_id: this.node.stepId } }
      );
      this.wfExecutionRuntimeManager.navigateToNextNode();
      return;
    }

    // Capture inner step outputs from this iteration so they are
    // available under the `while.*` context when the condition is
    // re-evaluated in the enter node.
    const context = this.stepExecutionRuntime.contextManager.getContext();
    this.stepExecutionRuntime.setCurrentStepState({
      ...whileState,
      ...context.steps,
    });

    this.wfExecutionRuntimeManager.navigateToNode(this.node.startNodeId);
  }
}
