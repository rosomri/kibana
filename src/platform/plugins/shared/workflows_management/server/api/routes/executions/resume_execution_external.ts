/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import path from 'path';
import { schema } from '@kbn/config-schema';
import { EXTERNAL_RESUME_API_PATH } from '@kbn/workflows/server';
import {
  EXTERNAL_RESUME_POST_ROUTE_OPTIONS,
  EXTERNAL_RESUME_ROUTE_OPTIONS,
  EXTERNAL_RESUME_SECURITY,
  handleExternalResumeError,
  htmlSuccess,
} from './external_resume_route_helpers';
import { resolveExternalResumeCredentials } from '../../external_resume/external_resume_service';
import type { RouteDependencies } from '../types';
import { API_VERSION } from '../utils/route_constants';
import { executionIdParamSchema } from '../utils/schemas';
import { withAvailabilityCheck } from '../utils/with_availability_check';

export function registerExternalResumeExecutionPostRoute(deps: RouteDependencies) {
  const { router, api, spaces, audit, logger } = deps;

  router.versioned
    .post({
      path: EXTERNAL_RESUME_API_PATH,
      access: 'public',
      security: EXTERNAL_RESUME_SECURITY,
      summary: 'Submit external input for a paused workflow execution',
      description:
        'Resume a workflow execution that is paused and waiting for external input. Submit input values as a JSON request body, authenticated with kid and token query parameters. Returns an HTML confirmation page.',
      options: EXTERNAL_RESUME_POST_ROUTE_OPTIONS,
    })
    .addVersion(
      {
        version: API_VERSION,
        options: {
          oasOperationObject: () =>
            path.join(__dirname, '../examples/resume_execution_external_post.yaml'),
        },
        validate: {
          request: {
            params: executionIdParamSchema,
            query: schema.object({
              kid: schema.string({
                maxLength: 64,
                meta: { description: 'The API key ID created when the workflow execution paused.' },
              }),
              token: schema.string({
                maxLength: 128,
                meta: { description: 'The resume token authenticating this request.' },
              }),
            }),
            body: schema.object({}, { unknowns: 'allow' }),
          },
        },
      },
      withAvailabilityCheck(async (context, request, response) => {
        try {
          const { executionId } = request.params;
          const { kid, token } = resolveExternalResumeCredentials(request.query);
          const spaceId = spaces.getSpaceId(request);
          const { resumedBy } = await api.resumeWorkflowExecutionExternallyWithInput({
            kid,
            token,
            executionId,
            spaceId,
            input: request.body as Record<string, unknown>,
          });

          audit.logExecutionResumed(request, {
            executionId,
            resumedBy,
          });

          return htmlSuccess(response);
        } catch (error) {
          audit.logExecutionResumed(request, {
            executionId: request.params.executionId,
            error,
          });
          return handleExternalResumeError(response, error, logger);
        }
      })
    );
}

export function registerExternalResumeExecutionGetRoute(deps: RouteDependencies) {
  const { router, api, spaces, audit, logger } = deps;

  router.versioned
    .get({
      path: EXTERNAL_RESUME_API_PATH,
      access: 'public',
      security: EXTERNAL_RESUME_SECURITY,
      summary: 'Resume a workflow execution from an external link',
      description:
        'Resume a paused waitForApproval step (approved query param) or waitForInput step (schema fields as query params). Returns an HTML confirmation page.',
      options: EXTERNAL_RESUME_ROUTE_OPTIONS,
    })
    .addVersion(
      {
        version: API_VERSION,
        options: {
          oasOperationObject: () =>
            path.join(__dirname, '../examples/resume_execution_external.yaml'),
        },
        validate: {
          request: {
            params: executionIdParamSchema,
            query: schema.object(
              {
                kid: schema.string({
                  maxLength: 64,
                  meta: { description: 'The API key ID created when the workflow execution paused.' },
                }),
                token: schema.string({
                  maxLength: 128,
                  meta: { description: 'The resume token authenticating this request.' },
                }),
                approved: schema.maybe(
                  schema.oneOf(
                    [schema.boolean(), schema.literal('true'), schema.literal('false')],
                    {
                      meta: {
                        description:
                          'Indicates whether a human reviewer approved the paused step. Required for waitForApproval.',
                      },
                    }
                  )
                ),
              },
              { unknowns: 'allow' }
            ),
          },
        },
      },
      withAvailabilityCheck(async (context, request, response) => {
        try {
          const { executionId } = request.params;
          const { kid, token } = resolveExternalResumeCredentials(request.query);
          const { resumedBy } = await api.resumeWorkflowExecutionExternallyViaGet({
            kid,
            token,
            executionId,
            spaceId: spaces.getSpaceId(request),
            query: request.query as Record<string, unknown>,
          });

          audit.logExecutionResumed(request, {
            executionId,
            resumedBy,
          });

          return htmlSuccess(response);
        } catch (error) {
          audit.logExecutionResumed(request, {
            executionId: request.params.executionId,
            error,
          });
          return handleExternalResumeError(response, error, logger);
        }
      })
    );
}
