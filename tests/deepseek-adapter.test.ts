import { describe, expect, it, vi } from 'vitest';

import {
  DeepSeekModelAdapter,
  DEEPSEEK_ENDPOINT,
  DEEPSEEK_MODEL,
} from '../src/gateway/deepSeekModelAdapter';
import { MockModelAdapter } from '../src/gateway/mockModelAdapter';
import { validGenerateQuestionsRequest } from './fixtures/ai-task-protocol';

function providerResponse(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
}

describe('DeepSeek model adapter', () => {
  it('uses only the fixed model, prompt registry, and JSON response format', async () => {
    const mock = new MockModelAdapter();
    const generated = await mock.generateQuestions(validGenerateQuestionsRequest);
    expect(generated.kind).toBe('success');
    if (generated.kind !== 'success') {
      throw new Error('Mock fixture did not generate a success result');
    }

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(providerResponse(JSON.stringify(generated.result)));
    const adapter = new DeepSeekModelAdapter({ fetch: fetchMock });
    const result = await adapter.generateQuestions(validGenerateQuestionsRequest, {
      DEEPSEEK_API_KEY: 'test-only-key',
    });

    expect(result).toMatchObject({ kind: 'success', model: DEEPSEEK_MODEL });
    expect(fetchMock).toHaveBeenCalledWith(
      DEEPSEEK_ENDPOINT,
      expect.objectContaining({ method: 'POST' }),
    );
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ authorization: 'Bearer test-only-key' });
    const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(requestBody).toMatchObject({
      model: DEEPSEEK_MODEL,
      response_format: { type: 'json_object' },
      stream: false,
    });
  });

  it('does not call the provider when the Worker Secret is absent', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const adapter = new DeepSeekModelAdapter({ fetch: fetchMock });
    await expect(adapter.generateQuestions(validGenerateQuestionsRequest, {})).resolves.toEqual({
      kind: 'failure',
      code: 'unavailable',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [408, 'timeout'],
    [429, 'rate-limited'],
    [500, 'upstream'],
  ] as const)('maps provider HTTP %s to %s', async (status, code) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse('ignored', status));
    const adapter = new DeepSeekModelAdapter({ fetch: fetchMock });
    await expect(
      adapter.generateQuestions(validGenerateQuestionsRequest, {
        DEEPSEEK_API_KEY: 'test-only-key',
      }),
    ).resolves.toEqual({ kind: 'failure', code });
  });

  it('rejects empty, malformed, and schema-invalid provider content', async () => {
    const cases = [
      providerResponse(''),
      providerResponse('{"questions":'),
      providerResponse(JSON.stringify({ questions: [] })),
    ];

    for (const response of cases) {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
      const adapter = new DeepSeekModelAdapter({ fetch: fetchMock });
      await expect(
        adapter.generateQuestions(validGenerateQuestionsRequest, {
          DEEPSEEK_API_KEY: 'test-only-key',
        }),
      ).resolves.toEqual({ kind: 'failure', code: 'invalid-response' });
    }
  });
});
