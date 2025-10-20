/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ConnectorExecutor } from '../connector_executor';
import type { WorkflowExecutionRuntimeManager } from '../workflow_context_manager/workflow_execution_runtime_manager';
import type { IWorkflowEventLogger } from '../workflow_event_logger/workflow_event_logger';
import type { RunStepResult, BaseStep } from './node_implementation';
import { BaseAtomicNodeImplementation } from './node_implementation';
import type { StepExecutionRuntime } from '../workflow_context_manager/step_execution_runtime';
import { WorkflowTemplatingEngine } from '../templating_engine';

export interface FilterStep extends BaseStep {
  type: string;
  with: Record<string, any>;
}

export class FilterStepImpl extends BaseAtomicNodeImplementation<FilterStep> {
  protected templatingEngine: WorkflowTemplatingEngine;

  constructor(
    step: FilterStep,
    stepExecutionRuntime: StepExecutionRuntime,
    connectorExecutor: ConnectorExecutor | undefined,
    workflowRuntime: WorkflowExecutionRuntimeManager,
    private workflowLogger: IWorkflowEventLogger
  ) {
    super(step, stepExecutionRuntime, connectorExecutor, workflowRuntime);
    this.templatingEngine = new WorkflowTemplatingEngine();
  }

  public getInput() {
    // Get current context for templating
    const context = this.stepExecutionRuntime.contextManager.getContext();
    // Render inputs from 'with'
    return Object.entries(this.step.with ?? {}).reduce((acc: Record<string, any>, [key, value]) => {
      if (typeof value === 'string') {
        acc[key] = this.templatingEngine.render(value, context);
      } else {
        acc[key] = value;
      }
      return acc;
    }, {});
  }

  public async run(): Promise<void> {
    const input = this.getInput();
    await this.stepExecutionRuntime.startStep(input);

    try {
      const result = await this._run(input);

      // Don't update step execution runtime if abort was initiated
      if (this.stepExecutionRuntime.abortController.signal.aborted) {
        return;
      }

      if (result.error) {
        await this.stepExecutionRuntime.failStep(result.error);
      } else {
        await this.stepExecutionRuntime.finishStep(result.output);
      }
    } catch (error) {
      const result = await this.handleFailure(input, error);
      await this.stepExecutionRuntime.failStep(result.error);
    }

    this.workflowExecutionRuntime.navigateToNextNode();
  }

  protected async _run(input: any): Promise<RunStepResult> {
    try {
      const context = this.stepExecutionRuntime.contextManager.getContext();
      const filterType = this.step.type.split('.')[1]; // e.g., "where_exp"

      // Build template directly
      const template = this.buildDirectTemplate(filterType, input);

      // Wrap the template with json filter to ensure objects are properly serialized
      const wrappedTemplate = `{{ ${template.replace(/^{{ /, '').replace(/ }}$/, '')} | json }}`;

      this.workflowLogger.logInfo(`Executing filter step: ${this.step.name}`, {
        workflow: { step_id: this.step.name },
        event: { action: 'filter_execute', outcome: 'success' },
        tags: ['filter', filterType],
        filter: {
          type: filterType,
          path: input.path,
          template: wrappedTemplate,
        },
      });

      const result = this.templatingEngine.render(wrappedTemplate, context);

      // Try to parse the result as JSON, fallback to string if it fails
      let parsedResult;
      try {
        parsedResult = JSON.parse(result);
      } catch {
        parsedResult = result;
      }

      return {
        input,
        output: { result: parsedResult },
        error: undefined,
      };
    } catch (error) {
      this.workflowLogger.logError(
        `Filter step failed: ${this.step.name}`,
        error instanceof Error ? error : new Error(String(error)),
        {
          workflow: { step_id: this.step.name },
          event: { action: 'filter_execute', outcome: 'failure' },
          tags: ['filter', 'error'],
          error: {
            type: this.step.type,
          },
        }
      );

      return {
        input,
        output: undefined,
        error: `Filter execution failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private buildDirectTemplate(filterType: string, params: Record<string, any>): string {
    // remove {{}} from the path
    const dataPath = params.path.replace(/{{/g, '').replace(/}}/g, '');

    // Handle different filter types
    switch (filterType) {
      case 'where_exp':
        const exp = params.exp || 'value > 0';
        return `{{ ${dataPath} | where_exp: "item", "item.${exp}" }}`;

      case 'concat':
        const other = params.other;
        if (typeof other === 'string') {
          return `{{ ${dataPath} | concat: ${other} }}`;
        } else {
          return `{{ ${dataPath} | concat: ${JSON.stringify(other)} }}`;
        }

      case 'format':
        const template = params.template || '{{ value }}';
        return `{{ ${dataPath} | format: "${template}" }}`;

      case 'limit':
        const limit = params.limit || 10;
        return `{{ ${dataPath} | limit: ${limit} }}`;

      case 'sort':
        const property = params.property || 'value';
        const order = params.order || 'asc';
        return `{{ ${dataPath} | sort: "${property}", "${order}" }}`;

      case 'map':
        const mapProperty = params.property || 'value';
        return `{{ ${dataPath} | map: "${mapProperty}" }}`;

      case 'group_by':
        const groupProperty = params.property || 'value';
        return `{{ ${dataPath} | group_by: "${groupProperty}" }}`;

      case 'first':
        return `{{ ${dataPath} | first }}`;

      case 'last':
        return `{{ ${dataPath} | last }}`;

      case 'size':
        return `{{ ${dataPath} | size }}`;

      case 'unique':
        const uniqueProperty = params.property;
        if (uniqueProperty) {
          return `{{ ${dataPath} | uniq: "${uniqueProperty}" }}`;
        } else {
          return `{{ ${dataPath} | uniq }}`;
        }

      case 'reverse':
        return `{{ ${dataPath} | reverse }}`;

      case 'join':
        const separator = params.separator || ',';
        return `{{ ${dataPath} | join: "${separator}" }}`;

      case 'split':
        const splitSeparator = params.separator || ',';
        return `{{ ${dataPath} | split: "${splitSeparator}" }}`;

      default:
        // Generic approach for unknown filters
        return this.buildGenericTemplate(filterType, params);
    }
  }

  private buildGenericTemplate(filterType: string, params: Record<string, any>): string {
    const dataPath = params.path || 'data';
    const paramNames = Object.keys(params).filter((key) => key !== 'path');

    if (paramNames.length === 0) {
      return `{{ ${dataPath} | ${filterType} }}`;
    }

    // Build parameter string
    const paramString = paramNames
      .map((key) => {
        const value = params[key];
        if (typeof value === 'string') {
          return `"${value}"`;
        }
        return JSON.stringify(value);
      })
      .join(', ');

    return `{{ ${dataPath} | ${filterType}: ${paramString} }}`;
  }
}
