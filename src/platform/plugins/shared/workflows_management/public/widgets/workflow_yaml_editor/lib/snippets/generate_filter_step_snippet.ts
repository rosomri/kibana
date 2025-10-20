/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ToStringOptions } from 'yaml';
import { stringify } from 'yaml';

interface GenerateFilterStepSnippetOptions {
  full?: boolean;
  withStepsSection?: boolean;
}

/**
 * Generates a YAML snippet for a filter workflow step based on the specified type.
 * @param stepType - The type of filter step ('filter.where_exp', 'filter.concat', etc.)
 * @param options - Configuration options for snippet generation
 * @param options.full - Whether to include the full YAML structure with step name and type prefix
 * @param options.withStepsSection - Whether to include the "steps:" section
 * @returns The formatted YAML step snippet with appropriate parameters and structure
 */
export function generateFilterStepSnippet(
  stepType: string,
  { full, withStepsSection }: GenerateFilterStepSnippetOptions = {}
): string {
  const stringifyOptions: ToStringOptions = { indent: 2 };
  let parameters: Record<string, any>;

  switch (stepType) {
    case 'filter.where_exp':
      parameters = {
        with: {
          path: '{{ data.items }}',
          exp: 'value > 50',
        },
      };
      break;
    case 'filter.concat':
      parameters = {
        with: {
          path: '{{ data.array1 }}',
          other: '{{ data.array2 }}',
        },
      };
      break;
    case 'filter.format':
      parameters = {
        with: {
          path: '{{ data.user.name }}',
          template: 'Hello {{ value }}!',
        },
      };
      break;
    case 'filter.limit':
      parameters = {
        with: {
          path: '{{ data.items }}',
          limit: 10,
        },
      };
      break;
    case 'filter.sort':
      parameters = {
        with: {
          path: '{{ data.items }}',
          property: 'name',
          order: 'asc',
        },
      };
      break;
    case 'filter.map':
      parameters = {
        with: {
          path: '{{ data.items }}',
          property: 'name',
        },
      };
      break;
    case 'filter.group_by':
      parameters = {
        with: {
          path: '{{ data.items }}',
          property: 'category',
        },
      };
      break;
    case 'filter.first':
      parameters = {
        with: {
          path: '{{ data.items }}',
        },
      };
      break;
    case 'filter.last':
      parameters = {
        with: {
          path: '{{ data.items }}',
        },
      };
      break;
    case 'filter.size':
      parameters = {
        with: {
          path: '{{ data.items }}',
        },
      };
      break;
    case 'filter.unique':
      parameters = {
        with: {
          path: '{{ data.items }}',
          property: 'id',
        },
      };
      break;
    case 'filter.reverse':
      parameters = {
        with: {
          path: '{{ data.items }}',
        },
      };
      break;
    case 'filter.join':
      parameters = {
        with: {
          path: '{{ data.items }}',
          separator: ', ',
        },
      };
      break;
    case 'filter.split':
      parameters = {
        with: {
          path: '{{ data.text }}',
          separator: ',',
        },
      };
      break;
    default:
      parameters = {
        with: {
          path: '{{ data.items }}',
          '# Add filter-specific parameters here': '',
        },
      };
  }

  if (full) {
    // if the full snippet is requested, return the whole step node as a sequence item
    // - name: ${stepType}_step
    //   type: ${stepType}
    //   ...parameters
    const step = [
      {
        name: `${stepType.replaceAll('.', '_')}_step`,
        type: stepType,
        ...parameters,
      },
    ];
    if (withStepsSection) {
      return stringify({ steps: step }, stringifyOptions);
    }
    return stringify(step, stringifyOptions);
  }

  // otherwise, the "type:" is already present, so we just return the type value and parameters
  // (type:)${stepType}
  // ...parameters
  return `${stepType}\n${stringify(parameters, stringifyOptions)}`;
}

