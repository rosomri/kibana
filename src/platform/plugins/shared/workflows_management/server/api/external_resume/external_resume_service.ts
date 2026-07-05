/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { ExecutionStatus, HITL_API_KEY_ID_INPUT_FIELD, isHitlWaitStepType } from '@kbn/workflows';
import type { ResumeWorkflowExecutionResponseDto, WorkflowStepExecutionDto } from '@kbn/workflows';
import {
  WorkflowExecutionInvalidStatusError,
  WorkflowExecutionNotFoundError,
} from '@kbn/workflows/common/errors';
import { EXTERNAL_RESUME_API_PATH } from '@kbn/workflows/server';
import type { JsonModelSchemaType } from '@kbn/workflows/spec/schema/common/json_model_schema';
import { ExternalResumeError } from './external_resume_error';
import {
  buildExternalResumeFormFieldsHtml,
  parseExternalResumeFormBody,
  validateExternalResumeInput,
} from './external_resume_form_fields';
import { renderExternalResumeFormPage } from './render_external_resume_page';
import type { WorkflowsService } from '../workflows_management_service';

export interface ExternalResumeViaGetParams {
  kid: string;
  token: string;
  executionId: string;
  spaceId: string;
  query: Record<string, unknown>;
}

export interface ExternalResumeWorkflowExecutionWithInputParams {
  kid: string;
  token: string;
  executionId: string;
  spaceId: string;
  input: Record<string, unknown>;
}

export interface ExternalResumeFormPageParams {
  kid: string;
  token: string;
  executionId: string;
  spaceId: string;
  basePath: string;
}

interface ResolvedExternalResumeContext {
  authenticatedApiKeyId: string;
  execution: NonNullable<Awaited<ReturnType<WorkflowsService['getWorkflowExecution']>>>;
  stepExecution: WorkflowStepExecutionDto;
}

export async function resumeWorkflowExecutionExternallyViaGet(
  workflowsService: WorkflowsService,
  { kid, token, executionId, spaceId, query }: ExternalResumeViaGetParams
): Promise<ResumeWorkflowExecutionResponseDto> {
  const { authenticatedApiKeyId, stepExecution } = await resolveExternalResumeContext(
    workflowsService,
    { kid, token, executionId, spaceId }
  );

  if (stepExecution.stepType === 'waitForApproval') {
    if (!Object.hasOwn(query, 'approved')) {
      throw new ExternalResumeError('approved query parameter is required', 400);
    }

    return resumeWorkflowExecutionWithResolvedContext(workflowsService, {
      authenticatedApiKeyId,
      stepExecutionId: stepExecution.id,
      executionId,
      spaceId,
      input: { approved: parseApprovedQueryParam(query.approved) },
    });
  }

  if (stepExecution.stepType === 'waitForInput') {
    const schema = getStepInputSchema(stepExecution.input);
    const queryInput = getExternalResumeInputFromQuery(query, schema);
    if (Object.keys(queryInput).length === 0) {
      throw new ExternalResumeError(
        'Query-param resume requires at least one schema field; use the form link instead.',
        400
      );
    }

    const validatedInput = parseExternalResumeFormSubmission(queryInput, schema);

    return resumeWorkflowExecutionWithResolvedContext(workflowsService, {
      authenticatedApiKeyId,
      stepExecutionId: stepExecution.id,
      executionId,
      spaceId,
      input: validatedInput,
    });
  }

  throw new ExternalResumeError('This workflow step does not support external resume', 400);
}

export async function resumeWorkflowExecutionExternallyWithInput(
  workflowsService: WorkflowsService,
  { kid, token, executionId, spaceId, input }: ExternalResumeWorkflowExecutionWithInputParams
): Promise<ResumeWorkflowExecutionResponseDto> {
  const { authenticatedApiKeyId, stepExecution } = await resolveExternalResumeContext(
    workflowsService,
    { kid, token, executionId, spaceId }
  );

  if (stepExecution.stepType !== 'waitForInput') {
    throw new ExternalResumeError(
      'This workflow step does not accept structured external input',
      400
    );
  }

  const schema = getStepInputSchema(stepExecution.input);
  const validatedInput = parseExternalResumeFormSubmission(input, schema);

  return resumeWorkflowExecutionWithResolvedContext(workflowsService, {
    authenticatedApiKeyId,
    stepExecutionId: stepExecution.id,
    executionId,
    spaceId,
    input: validatedInput,
  });
}

export async function getExternalResumeFormPage(
  workflowsService: WorkflowsService,
  { kid, token, executionId, spaceId, basePath }: ExternalResumeFormPageParams
): Promise<string> {
  const { stepExecution } = await resolveExternalResumeContext(workflowsService, {
    kid,
    token,
    executionId,
    spaceId,
  });

  if (stepExecution.stepType !== 'waitForInput') {
    throw new ExternalResumeError('This workflow step does not expose an external input form', 400);
  }

  const stepInput = getStepInputRecord(stepExecution.input);
  const schema = getStepInputSchema(stepExecution.input);
  const message = typeof stepInput.message === 'string' ? stepInput.message : undefined;

  return renderExternalResumeFormPage({
    message,
    formActionUrl: buildExternalResumePublicPath({ basePath, executionId, kid, token }),
    fieldsHtml: buildExternalResumeFormFieldsHtml(schema),
  });
}

export function buildExternalResumePublicPath({
  basePath,
  executionId,
  kid,
  token,
  approved,
}: {
  basePath: string;
  executionId: string;
  kid: string;
  token: string;
  approved?: boolean;
}): string {
  const path = EXTERNAL_RESUME_API_PATH.replace('{executionId}', executionId);
  const params = new URLSearchParams();
  params.set('kid', kid);
  params.set('token', token);
  if (approved !== undefined) {
    params.set('approved', String(approved));
  }
  return `${basePath}${path}?${params.toString()}`;
}

export function parseExternalResumeFormSubmission(
  body: Record<string, unknown>,
  schema: JsonModelSchemaType | undefined
): Record<string, unknown> {
  try {
    const parsed = parseExternalResumeFormBody(body, schema);
    return validateExternalResumeInput(parsed, schema);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid form submission';
    throw new ExternalResumeError(message, 400);
  }
}

async function resolveExternalResumeContext(
  workflowsService: WorkflowsService,
  {
    kid,
    token,
    executionId,
    spaceId,
  }: {
    kid: string;
    token: string;
    executionId: string;
    spaceId: string;
  }
): Promise<ResolvedExternalResumeContext> {
  const coreStart = await workflowsService.getCoreStart();
  const esClient = coreStart.elasticsearch.client.asInternalUser;

  // Layer 1: Verify API key exists, is active, and not expired
  let apiKeyMetadata: Record<string, unknown> | undefined;
  try {
    const response = await esClient.security.getApiKey({ id: kid });
    const keyInfo = response.api_keys?.[0];
    if (!keyInfo || keyInfo.invalidated) {
      throw new ExternalResumeError('Link expired or already used', 401);
    }
    apiKeyMetadata = keyInfo.metadata as Record<string, unknown> | undefined;
  } catch (error) {
    if (error instanceof ExternalResumeError) throw error;
    throw new ExternalResumeError('Link expired or already used', 401);
  }

  // Layer 2: Verify token hash matches metadata
  const storedHash = apiKeyMetadata?.resume_token_hash;
  if (typeof storedHash !== 'string') {
    throw new ExternalResumeError('Invalid resume token', 401);
  }

  const computed = createHash('sha256').update(token).digest();
  const stored = Buffer.from(storedHash, 'hex');
  if (computed.length !== stored.length || !timingSafeEqual(computed, stored)) {
    throw new ExternalResumeError('Invalid resume token', 401);
  }

  // Layer 3: Load execution and bind to step via _hitlApiKeyId
  const execution = await workflowsService.getWorkflowExecution(executionId, spaceId, {
    includeInput: true,
  });

  if (!execution) {
    throw new ExternalResumeError('Workflow execution not found', 404);
  }

  const lookup = getExternalResumeStepExecution(execution, kid);

  if ('reason' in lookup) {
    if (lookup.reason === 'api_key_mismatch') {
      throw new ExternalResumeError('Token does not match this workflow execution', 403);
    }
    throw new ExternalResumeError('This workflow response link is no longer valid', 409);
  }

  const { stepExecution } = lookup;

  if (stepExecution.finishedAt || stepExecution.error) {
    throw new ExternalResumeError('This workflow response link is no longer valid', 409);
  }

  return { authenticatedApiKeyId: kid, execution, stepExecution };
}

async function resumeWorkflowExecutionWithResolvedContext(
  workflowsService: WorkflowsService,
  {
    authenticatedApiKeyId,
    stepExecutionId,
    executionId,
    spaceId,
    input,
  }: {
    authenticatedApiKeyId: string;
    stepExecutionId: string;
    executionId: string;
    spaceId: string;
    input: Record<string, unknown>;
  }
): Promise<ResumeWorkflowExecutionResponseDto> {
  const coreStart = await workflowsService.getCoreStart();
  const workflowsExecutionEngine = await workflowsService.getWorkflowsExecutionEngine();
  const resumedBy = `api_key:${authenticatedApiKeyId}`;

  const claimed = await workflowsService.claimHitlStepForExternalResume(
    stepExecutionId,
    resumedBy,
    spaceId
  );
  if (!claimed) {
    throw new ExternalResumeError('This workflow response link is no longer valid', 409);
  }

  try {
    const result = await workflowsExecutionEngine.resumeWorkflowExecution(
      executionId,
      spaceId,
      input,
      undefined,
      { resumedBy }
    );

    await coreStart.security.authc.apiKeys.invalidateAsInternalUser({
      ids: [authenticatedApiKeyId],
    });

    return result;
  } catch (error) {
    if (error instanceof WorkflowExecutionNotFoundError) {
      throw new ExternalResumeError('Workflow execution not found', 404);
    }
    if (error instanceof WorkflowExecutionInvalidStatusError) {
      throw new ExternalResumeError('Workflow execution is not waiting for external input', 409);
    }
    throw error;
  }
}

type ExternalResumeStepLookupFailureReason =
  | 'execution_not_waiting'
  | 'execution_finished'
  | 'api_key_mismatch';

type ExternalResumeStepLookupResult =
  | { stepExecution: WorkflowStepExecutionDto }
  | { reason: ExternalResumeStepLookupFailureReason };

function getExternalResumeStepExecution(
  execution: {
    id: string;
    status: ExecutionStatus;
    finishedAt?: string;
    stepExecutions: WorkflowStepExecutionDto[];
  },
  apiKeyId: string
): ExternalResumeStepLookupResult {
  if (execution.status !== ExecutionStatus.WAITING_FOR_INPUT) {
    return { reason: 'execution_not_waiting' };
  }

  if (execution.finishedAt) {
    return { reason: 'execution_finished' };
  }

  const stepExecution = execution.stepExecutions.find(
    (candidate) =>
      candidate.workflowRunId === execution.id &&
      isHitlWaitStepType(candidate.stepType) &&
      candidate.status === ExecutionStatus.WAITING_FOR_INPUT &&
      getExternalResumeApiKeyId(candidate.input) === apiKeyId
  );

  if (!stepExecution) {
    return { reason: 'api_key_mismatch' };
  }

  return { stepExecution };
}

export function getExternalResumeApiKeyId(input: unknown): string | undefined {
  if (input == null || typeof input !== 'object' || !(HITL_API_KEY_ID_INPUT_FIELD in input)) {
    return undefined;
  }

  const apiKeyId = (input as Record<string, unknown>)[HITL_API_KEY_ID_INPUT_FIELD];
  return typeof apiKeyId === 'string' && apiKeyId.length > 0 ? apiKeyId : undefined;
}

function getStepInputRecord(input: unknown): Record<string, unknown> {
  if (input != null && typeof input === 'object') {
    return input as Record<string, unknown>;
  }
  return {};
}

function getStepInputSchema(input: unknown): JsonModelSchemaType | undefined {
  const stepInput = getStepInputRecord(input);
  const schema = stepInput.schema;
  if (schema != null && typeof schema === 'object') {
    return schema as JsonModelSchemaType;
  }
  return undefined;
}

function normalizeExternalResumeQueryValue(value: unknown, fieldSchema: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  const fieldType = (fieldSchema as { type?: string } | undefined)?.type;
  return fieldType === 'array' ? value : value[0];
}

function getExternalResumeInputFromQuery(
  query: Record<string, unknown>,
  schema: JsonModelSchemaType | undefined
): Record<string, unknown> {
  const properties = schema?.properties ?? {};
  const allowed = new Set(Object.keys(properties));
  const input: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(query)) {
    if (key !== 'kid' && key !== 'token' && allowed.has(key)) {
      input[key] = normalizeExternalResumeQueryValue(value, properties[key]);
    }
  }

  return input;
}

export function parseApprovedQueryParam(value: unknown): boolean {
  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  throw new ExternalResumeError('approved query parameter must be true or false', 400);
}

export function resolveExternalResumeCredentials(query: { kid?: string; token?: string }): {
  kid: string;
  token: string;
} {
  const { kid, token } = query;
  if (typeof kid !== 'string' || kid.length === 0) {
    throw new ExternalResumeError('kid query parameter is required', 401);
  }
  if (typeof token !== 'string' || token.length === 0) {
    throw new ExternalResumeError('token query parameter is required', 401);
  }
  return { kid, token };
}
