import {
  AIGatewayResponseSchema,
  AIPromptVersion,
  GenerateQuestionsRequestSchema,
  GenerateQuestionsResultSchema,
  type AIGatewayResponse,
  type AIProtocolFailureCode,
  type GenerateQuestionsRequest,
} from '../contract';
import { DeepSeekModelAdapter } from './deepSeekModelAdapter';
import { MockModelAdapter } from './mockModelAdapter';
import type { Env, GatewayDependencies, ModelAdapter, ProviderResult } from './types';

const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const TASK_PATH = '/v1/tasks/generate-questions';

const DEFAULT_GATEWAY_VERSION = 'worker-v1';
const DEFAULT_REQUEST_ID = 'gateway-request';

export function createGatewayFetch(dependencies: GatewayDependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const createRequestId = dependencies.createRequestId ?? defaultRequestId;
  const defaultAdapter = dependencies.modelAdapter;

  return async function gatewayFetch(request: Request, env: Env): Promise<Response> {
    const startedAt = now();
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return responseForOptions(cors, isOriginAllowed(request, env));
    }

    if (!isOriginAllowed(request, env)) {
      return jsonResponse({ error: 'cors_rejected' }, 403, cors);
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse(
        {
          status: 'ok',
          service: 'zhongri-ai-gateway',
          schemaVersion: 1,
          gatewayVersion: gatewayVersion(env),
        },
        200,
        cors,
      );
    }

    if (url.pathname !== TASK_PATH) {
      return jsonResponse({ error: 'not_found' }, 404, cors);
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'method_not_allowed' }, 405, {
        ...cors,
        allow: 'POST, OPTIONS',
      });
    }

    if (!hasJsonContentType(request)) {
      return jsonResponse({ error: 'content_type_required' }, 415, cors);
    }

    const contentLength = request.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_REQUEST_BODY_BYTES) {
      return jsonResponse({ error: 'request_too_large' }, 413, cors);
    }

    const body = await readJsonBody(request);
    if (body.kind !== 'valid') {
      return jsonResponse(
        { error: body.kind === 'too-large' ? 'request_too_large' : 'invalid_json' },
        body.kind === 'too-large' ? 413 : 400,
        cors,
      );
    }

    const parsedRequest = GenerateQuestionsRequestSchema.safeParse(body.value);
    const requestId = requestIdFromUnknown(body.value) ?? createRequestId();
    if (!parsedRequest.success) {
      return jsonResponse(
        failureResponse('invalid-request', requestId, false, startedAt, now, env),
        400,
        cors,
      );
    }

    const adapter = selectAdapter(defaultAdapter, env);
    const providerResult = await adapter.generateQuestions(parsedRequest.data, env);
    const response = toGatewayResponse(providerResult, parsedRequest.data, startedAt, now, env);
    return jsonResponse(response, 200, cors);
  };
}

const defaultGatewayFetch = createGatewayFetch();

export default {
  fetch: defaultGatewayFetch,
};

function selectAdapter(explicit: ModelAdapter | undefined, env: Env): ModelAdapter {
  if (explicit) {
    return explicit;
  }
  return env.MOCK_PROVIDER === 'true' ? new MockModelAdapter() : new DeepSeekModelAdapter();
}

function toGatewayResponse(
  providerResult: ProviderResult,
  request: GenerateQuestionsRequest,
  startedAt: number,
  now: () => number,
  env: Env,
): AIGatewayResponse {
  if (providerResult.kind === 'failure') {
    return failureResponse(
      providerResult.code,
      request.requestId,
      providerResult.code !== 'invalid-request' && providerResult.code !== 'invalid-response',
      startedAt,
      now,
      env,
    );
  }

  const result = GenerateQuestionsResultSchema.safeParse(providerResult.result);
  if (!result.success || !resultMatchesRequest(result.data, request)) {
    return failureResponse('invalid-response', request.requestId, false, startedAt, now, env);
  }

  const response: AIGatewayResponse = {
    schemaVersion: 1,
    status: 'success',
    task: 'generateQuestions',
    requestId: request.requestId,
    result: result.data,
    trace: {
      requestId: request.requestId,
      schemaVersion: 1,
      task: 'generateQuestions',
      promptVersion: AIPromptVersion,
      model: providerResult.model,
      gatewayVersion: gatewayVersion(env),
      durationMs: durationMs(startedAt, now),
    },
  };
  try {
    return AIGatewayResponseSchema.parse(response);
  } catch {
    return failureResponse('invalid-response', request.requestId, false, startedAt, now, env);
  }
}

function resultMatchesRequest(
  result: ReturnType<typeof GenerateQuestionsResultSchema.parse>,
  request: GenerateQuestionsRequest,
): boolean {
  if (result.questions.length > request.targetCount) {
    return false;
  }

  const knownItemIds = new Set(request.content.items.map((item) => item.itemId));
  return result.questions.every(
    (candidate) =>
      knownItemIds.has(candidate.itemId) && candidate.question.language === request.language,
  );
}

function failureResponse(
  code: AIProtocolFailureCode,
  requestId: string,
  retryable: boolean,
  startedAt: number,
  now: () => number,
  env: Env,
): AIGatewayResponse {
  const response: AIGatewayResponse = {
    schemaVersion: 1,
    status: 'failure',
    task: 'generateQuestions',
    requestId,
    error: { code, retryable },
    trace: {
      requestId,
      schemaVersion: 1,
      task: 'generateQuestions',
      promptVersion: AIPromptVersion,
      model: null,
      gatewayVersion: gatewayVersion(env),
      durationMs: durationMs(startedAt, now),
    },
  };
  return AIGatewayResponseSchema.parse(response);
}

function durationMs(startedAt: number, now: () => number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

function gatewayVersion(env: Env): string {
  const candidate = env.GATEWAY_VERSION?.trim();
  return candidate && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(candidate)
    ? candidate
    : DEFAULT_GATEWAY_VERSION;
}

function defaultRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return DEFAULT_REQUEST_ID;
}

function requestIdFromUnknown(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('requestId' in value)) {
    return null;
  }
  const candidate = (value as { requestId?: unknown }).requestId;
  if (typeof candidate !== 'string') {
    return null;
  }
  const trimmed = candidate.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

function hasJsonContentType(request: Request): boolean {
  return request.headers.get('content-type')?.toLowerCase().startsWith('application/json') ?? false;
}

async function readJsonBody(
  request: Request,
): Promise<
  { readonly kind: 'valid'; readonly value: unknown } | { readonly kind: 'invalid' | 'too-large' }
> {
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_REQUEST_BODY_BYTES) {
      return { kind: 'too-large' };
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { kind: 'valid', value: JSON.parse(text) };
  } catch {
    return { kind: 'invalid' };
  }
}

function allowedOrigins(env: Env): Set<string> | '*' {
  const configured = env.CORS_ORIGINS?.trim();
  if (!configured || configured === '*') {
    return '*';
  }
  return new Set(
    configured
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function isOriginAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    return true;
  }
  const allowed = allowedOrigins(env);
  return allowed === '*' || allowed.has(origin);
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('origin');
  const allowed = allowedOrigins(env);
  const allowOrigin =
    allowed === '*' ? (origin ?? '*') : origin && allowed.has(origin) ? origin : '';
  return {
    ...(allowOrigin ? { 'access-control-allow-origin': allowOrigin, vary: 'Origin' } : {}),
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
}

function responseForOptions(cors: HeadersInit, allowed: boolean): Response {
  return allowed
    ? new Response(null, { status: 204, headers: { ...cors, 'cache-control': 'no-store' } })
    : new Response(JSON.stringify({ error: 'cors_rejected' }), {
        status: 403,
        headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
      });
}

function jsonResponse(body: unknown, status: number, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}
