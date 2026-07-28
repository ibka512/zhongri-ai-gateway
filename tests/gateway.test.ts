import { describe, expect, it } from 'vitest';

import { AIGatewayResponseSchema } from '../src/contract';
import { createGatewayFetch } from '../src/gateway/handler';
import { MockModelAdapter } from '../src/gateway/mockModelAdapter';
import type { Env, ProviderResult } from '../src/gateway/types';
import { validGenerateQuestionsRequest } from './fixtures/ai-task-protocol';

const env: Env = {
  CORS_ORIGINS: 'http://localhost:5173',
  GATEWAY_VERSION: 'worker-v1',
};

function taskRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://gateway.example.test/v1/tasks/generate-questions', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:5173',
      'content-type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('Gateway HTTP boundary', () => {
  it('serves health and a CORS preflight without provider access', async () => {
    const fetchGateway = createGatewayFetch({ modelAdapter: new MockModelAdapter() });

    const health = await fetchGateway(new Request('https://gateway.example.test/health'), env);
    expect(health.status).toBe(200);
    expect(await jsonBody(health)).toMatchObject({
      status: 'ok',
      service: 'zhongri-ai-gateway',
      schemaVersion: 1,
      gatewayVersion: 'worker-v1',
    });

    const preflight = await fetchGateway(
      new Request('https://gateway.example.test/v1/tasks/generate-questions', {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:5173' },
      }),
      env,
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('accepts only the fixed task and returns a validated success result', async () => {
    const fetchGateway = createGatewayFetch({
      modelAdapter: new MockModelAdapter(),
      now: () => 1_042,
    });
    const response = await fetchGateway(taskRequest(validGenerateQuestionsRequest), env);
    const body = await jsonBody(response);

    expect(response.status).toBe(200);
    expect(AIGatewayResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      status: 'success',
      task: 'generateQuestions',
      requestId: validGenerateQuestionsRequest.requestId,
      trace: {
        model: 'mock-v1',
        gatewayVersion: 'worker-v1',
      },
    });
  });

  it('rejects unknown fields, invalid JSON, missing content type, and oversized bodies', async () => {
    const fetchGateway = createGatewayFetch({ modelAdapter: new MockModelAdapter() });

    const unknownField = await fetchGateway(
      taskRequest({ ...validGenerateQuestionsRequest, prompt: 'arbitrary prompt' }),
      env,
    );
    expect(unknownField.status).toBe(400);
    expect(await jsonBody(unknownField)).toMatchObject({
      status: 'failure',
      error: { code: 'invalid-request', retryable: false },
    });

    const invalidJson = await fetchGateway(taskRequest('{"status":'), env);
    expect(invalidJson.status).toBe(400);
    expect(await jsonBody(invalidJson)).toEqual({ error: 'invalid_json' });

    const missingContentType = await fetchGateway(
      taskRequest(validGenerateQuestionsRequest, { 'content-type': 'text/plain' }),
      env,
    );
    expect(missingContentType.status).toBe(415);
    expect(await jsonBody(missingContentType)).toEqual({ error: 'content_type_required' });

    const oversized = await fetchGateway(
      taskRequest('x'.repeat(65 * 1024), { 'content-length': String(65 * 1024) }),
      env,
    );
    expect(oversized.status).toBe(413);
    expect(await jsonBody(oversized)).toEqual({ error: 'request_too_large' });
  });

  it('rejects disallowed origins and unknown routes without leaking provider data', async () => {
    const fetchGateway = createGatewayFetch({ modelAdapter: new MockModelAdapter() });
    const rejected = await fetchGateway(
      taskRequest(validGenerateQuestionsRequest, { origin: 'https://not-allowed.example' }),
      env,
    );
    expect(rejected.status).toBe(403);
    expect(await jsonBody(rejected)).toEqual({ error: 'cors_rejected' });

    const notFound = await fetchGateway(new Request('https://gateway.example.test/anything'), env);
    expect(notFound.status).toBe(404);
    expect(await jsonBody(notFound)).toEqual({ error: 'not_found' });
  });

  it('maps provider failures to stable failure results with no upstream details', async () => {
    const provider: ProviderResult = { kind: 'failure', code: 'rate-limited' };
    const fetchGateway = createGatewayFetch({
      modelAdapter: {
        generateQuestions: async () => provider,
      },
    });
    const response = await fetchGateway(taskRequest(validGenerateQuestionsRequest), env);
    const body = await jsonBody(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 'failure',
      error: { code: 'rate-limited', retryable: true },
    });
    expect(JSON.stringify(body)).not.toContain('upstream');
  });

  it('rejects a provider result that references an unknown item', async () => {
    const generated = await new MockModelAdapter().generateQuestions(validGenerateQuestionsRequest);
    if (generated.kind !== 'success') {
      throw new Error('Mock fixture did not generate a success result');
    }
    const fetchGateway = createGatewayFetch({
      modelAdapter: {
        generateQuestions: async () => ({
          kind: 'success' as const,
          model: 'test-provider',
          result: {
            questions: [{ ...generated.result.questions[0], itemId: 'unknown-item' }],
          },
        }),
      },
    });

    const response = await fetchGateway(taskRequest(validGenerateQuestionsRequest), env);
    expect(await jsonBody(response)).toMatchObject({
      status: 'failure',
      error: { code: 'invalid-response', retryable: false },
    });
  });

  it('does not use a provider without a configured secret', async () => {
    const fetchGateway = createGatewayFetch();
    const response = await fetchGateway(taskRequest(validGenerateQuestionsRequest), env);
    expect(await jsonBody(response)).toMatchObject({
      status: 'failure',
      error: { code: 'unavailable', retryable: true },
    });
  });
});
