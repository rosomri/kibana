/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { FilterStepImpl } from './filter_step';
import type { FilterStep } from './filter_step';
import type { StepExecutionRuntime } from '../../workflow_context_manager/step_execution_runtime';
import type { WorkflowExecutionRuntimeManager } from '../../workflow_context_manager/workflow_execution_runtime_manager';
import type { IWorkflowEventLogger } from '../../workflow_event_logger/workflow_event_logger';

// Mock dependencies
const mockStepExecutionRuntime = {
  contextManager: {
    getContext: jest.fn(),
  },
} as unknown as StepExecutionRuntime;

const mockWorkflowRuntime = {} as WorkflowExecutionRuntimeManager;

const mockWorkflowLogger = {
  logInfo: jest.fn(),
  logError: jest.fn(),
} as unknown as IWorkflowEventLogger;

describe('FilterStepImpl', () => {
  let filterStepImpl: FilterStepImpl;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('where_exp filter', () => {
    it('should filter array items based on expression', async () => {
      const step: FilterStep = {
        name: 'filter_high_values',
        type: 'filter.where_exp',
        with: {
          path: 'data.values',
          exp: 'value > 50',
        },
        spaceId: 'default',
      };

      const context = {
        data: {
          values: [10, 60, 30, 80, 40],
        },
      };

      (mockStepExecutionRuntime.contextManager.getContext as jest.Mock).mockReturnValue(context);

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      const result = await filterStepImpl._run({});

      expect(result.error).toBeUndefined();
      expect(result.output?.result).toEqual([60, 80]);
    });

    it('should handle empty array', async () => {
      const step: FilterStep = {
        name: 'filter_empty',
        type: 'filter.where_exp',
        with: {
          path: 'data.values',
          exp: 'value > 0',
        },
        spaceId: 'default',
      };

      const context = {
        data: {
          values: [],
        },
      };

      (mockStepExecutionRuntime.contextManager.getContext as jest.Mock).mockReturnValue(context);

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      const result = await filterStepImpl._run({});

      expect(result.error).toBeUndefined();
      expect(result.output?.result).toEqual([]);
    });
  });

  describe('concat filter', () => {
    it('should concatenate two arrays', async () => {
      const step: FilterStep = {
        name: 'concat_arrays',
        type: 'filter.concat',
        with: {
          path: 'data.array1',
          other: 'data.array2',
        },
        spaceId: 'default',
      };

      const context = {
        data: {
          array1: [1, 2, 3],
          array2: [4, 5, 6],
        },
      };

      (mockStepExecutionRuntime.contextManager.getContext as jest.Mock).mockReturnValue(context);

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      const result = await filterStepImpl._run({});

      expect(result.error).toBeUndefined();
      expect(result.output?.result).toEqual([1, 2, 3, 4, 5, 6]);
    });
  });

  describe('format filter', () => {
    it('should format string using template', async () => {
      const step: FilterStep = {
        name: 'format_message',
        type: 'filter.format',
        with: {
          path: 'data.user.name',
          template: 'Hello {{ value }}!',
        },
        spaceId: 'default',
      };

      const context = {
        data: {
          user: {
            name: 'John',
          },
        },
      };

      (mockStepExecutionRuntime.contextManager.getContext as jest.Mock).mockReturnValue(context);

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      const result = await filterStepImpl._run({});

      expect(result.error).toBeUndefined();
      expect(result.output?.result).toBe('Hello John!');
    });
  });

  describe('limit filter', () => {
    it('should limit array to specified number of items', async () => {
      const step: FilterStep = {
        name: 'limit_items',
        type: 'filter.limit',
        with: {
          path: 'data.items',
          limit: 3,
        },
        spaceId: 'default',
      };

      const context = {
        data: {
          items: [1, 2, 3, 4, 5],
        },
      };

      (mockStepExecutionRuntime.contextManager.getContext as jest.Mock).mockReturnValue(context);

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      const result = await filterStepImpl._run({});

      expect(result.error).toBeUndefined();
      expect(result.output?.result).toEqual([1, 2, 3]);
    });
  });

  describe('sort filter', () => {
    it('should sort array by property in ascending order', async () => {
      const step: FilterStep = {
        name: 'sort_items',
        type: 'filter.sort',
        with: {
          path: 'data.items',
          property: 'name',
          order: 'asc',
        },
        spaceId: 'default',
      };

      const context = {
        data: {
          items: [
            { name: 'Charlie', age: 30 },
            { name: 'Alice', age: 25 },
            { name: 'Bob', age: 35 },
          ],
        },
      };

      (mockStepExecutionRuntime.contextManager.getContext as jest.Mock).mockReturnValue(context);

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      const result = await filterStepImpl._run({});

      expect(result.error).toBeUndefined();
      expect(result.output?.result).toEqual([
        { name: 'Alice', age: 25 },
        { name: 'Bob', age: 35 },
        { name: 'Charlie', age: 30 },
      ]);
    });
  });

  describe('map filter', () => {
    it('should extract property from each array item', async () => {
      const step: FilterStep = {
        name: 'map_names',
        type: 'filter.map',
        with: {
          path: 'data.items',
          property: 'name',
        },
        spaceId: 'default',
      };

      const context = {
        data: {
          items: [
            { name: 'Alice', age: 25 },
            { name: 'Bob', age: 35 },
            { name: 'Charlie', age: 30 },
          ],
        },
      };

      (mockStepExecutionRuntime.contextManager.getContext as jest.Mock).mockReturnValue(context);

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      const result = await filterStepImpl._run({});

      expect(result.error).toBeUndefined();
      expect(result.output?.result).toEqual(['Alice', 'Bob', 'Charlie']);
    });
  });

  describe('first filter', () => {
    it('should get first item from array', async () => {
      const step: FilterStep = {
        name: 'get_first',
        type: 'filter.first',
        with: {
          path: 'data.items',
        },
        spaceId: 'default',
      };

      const context = {
        data: {
          items: [1, 2, 3, 4, 5],
        },
      };

      (mockStepExecutionRuntime.contextManager.getContext as jest.Mock).mockReturnValue(context);

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      const result = await filterStepImpl._run({});

      expect(result.error).toBeUndefined();
      expect(result.output?.result).toBe(1);
    });
  });

  describe('last filter', () => {
    it('should get last item from array', async () => {
      const step: FilterStep = {
        name: 'get_last',
        type: 'filter.last',
        with: {
          path: 'data.items',
        },
        spaceId: 'default',
      };

      const context = {
        data: {
          items: [1, 2, 3, 4, 5],
        },
      };

      (mockStepExecutionRuntime.contextManager.getContext as jest.Mock).mockReturnValue(context);

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      const result = await filterStepImpl._run({});

      expect(result.error).toBeUndefined();
      expect(result.output?.result).toBe(5);
    });
  });

  describe('size filter', () => {
    it('should get size of array', async () => {
      const step: FilterStep = {
        name: 'get_size',
        type: 'filter.size',
        with: {
          path: 'data.items',
        },
        spaceId: 'default',
      };

      const context = {
        data: {
          items: [1, 2, 3, 4, 5],
        },
      };

      (mockStepExecutionRuntime.contextManager.getContext as jest.Mock).mockReturnValue(context);

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      const result = await filterStepImpl._run({});

      expect(result.error).toBeUndefined();
      expect(result.output?.result).toBe(5);
    });
  });

  describe('unique filter', () => {
    it('should remove duplicate items from array', async () => {
      const step: FilterStep = {
        name: 'unique_items',
        type: 'filter.unique',
        with: {
          path: 'data.items',
        },
        spaceId: 'default',
      };

      const context = {
        data: {
          items: [1, 2, 2, 3, 3, 3, 4],
        },
      };

      (mockStepExecutionRuntime.contextManager.getContext as jest.Mock).mockReturnValue(context);

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      const result = await filterStepImpl._run({});

      expect(result.error).toBeUndefined();
      expect(result.output?.result).toEqual([1, 2, 3, 4]);
    });
  });

  describe('reverse filter', () => {
    it('should reverse array order', async () => {
      const step: FilterStep = {
        name: 'reverse_items',
        type: 'filter.reverse',
        with: {
          path: 'data.items',
        },
        spaceId: 'default',
      };

      const context = {
        data: {
          items: [1, 2, 3, 4, 5],
        },
      };

      (mockStepExecutionRuntime.contextManager.getContext as jest.Mock).mockReturnValue(context);

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      const result = await filterStepImpl._run({});

      expect(result.error).toBeUndefined();
      expect(result.output?.result).toEqual([5, 4, 3, 2, 1]);
    });
  });

  describe('join filter', () => {
    it('should join array items into string', async () => {
      const step: FilterStep = {
        name: 'join_items',
        type: 'filter.join',
        with: {
          path: 'data.items',
          separator: ', ',
        },
        spaceId: 'default',
      };

      const context = {
        data: {
          items: ['apple', 'banana', 'cherry'],
        },
      };

      (mockStepExecutionRuntime.contextManager.getContext as jest.Mock).mockReturnValue(context);

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      const result = await filterStepImpl._run({});

      expect(result.error).toBeUndefined();
      expect(result.output?.result).toBe('apple, banana, cherry');
    });
  });

  describe('split filter', () => {
    it('should split string into array', async () => {
      const step: FilterStep = {
        name: 'split_text',
        type: 'filter.split',
        with: {
          path: 'data.text',
          separator: ',',
        },
        spaceId: 'default',
      };

      const context = {
        data: {
          text: 'apple,banana,cherry',
        },
      };

      (mockStepExecutionRuntime.contextManager.getContext as jest.Mock).mockReturnValue(context);

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      const result = await filterStepImpl._run({});

      expect(result.error).toBeUndefined();
      expect(result.output?.result).toEqual(['apple', 'banana', 'cherry']);
    });
  });

  describe('error handling', () => {
    it('should handle missing data path gracefully', async () => {
      const step: FilterStep = {
        name: 'missing_data',
        type: 'filter.first',
        with: {
          path: 'data.nonexistent',
        },
        spaceId: 'default',
      };

      const context = {
        data: {},
      };

      (mockStepExecutionRuntime.contextManager.getContext as jest.Mock).mockReturnValue(context);

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      const result = await filterStepImpl._run({});

      expect(result.error).toBeDefined();
      expect(result.output).toBeUndefined();
    });

    it('should handle invalid filter type', async () => {
      const step: FilterStep = {
        name: 'invalid_filter',
        type: 'filter.invalid',
        with: {
          path: 'data.items',
        },
        spaceId: 'default',
      };

      const context = {
        data: {
          items: [1, 2, 3],
        },
      };

      (mockStepExecutionRuntime.contextManager.getContext as jest.Mock).mockReturnValue(context);

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      const result = await filterStepImpl._run({});

      expect(result.error).toBeDefined();
      expect(result.output).toBeUndefined();
    });
  });

  describe('template construction', () => {
    it('should build correct template for where_exp filter', () => {
      const step: FilterStep = {
        name: 'test',
        type: 'filter.where_exp',
        with: {
          path: 'data.items',
          exp: 'value > 10',
        },
        spaceId: 'default',
      };

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      // Access private method for testing
      const template = (filterStepImpl as any).buildDirectTemplate('where_exp', step.with);
      expect(template).toBe('{{ data.items | where_exp: "value > 10" }}');
    });

    it('should build correct template for concat filter', () => {
      const step: FilterStep = {
        name: 'test',
        type: 'filter.concat',
        with: {
          path: 'data.array1',
          other: 'data.array2',
        },
        spaceId: 'default',
      };

      filterStepImpl = new FilterStepImpl(step, mockStepExecutionRuntime, mockWorkflowRuntime, mockWorkflowLogger);

      const template = (filterStepImpl as any).buildDirectTemplate('concat', step.with);
      expect(template).toBe('{{ data.array1 | concat: data.array2 }}');
    });
  });
});

