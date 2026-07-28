import { GenerateQuestionsResultSchema, type GenerateQuestionsRequest } from '../contract';
import { buildGenerateQuestionsMessages } from './promptRegistry';
import type { Env, ModelAdapter, ProviderResult } from './types';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEEPSEEK_ENDPOINT = `${DEEPSEEK_BASE_URL}/chat/completions`;
const DEEPSEEK_MODEL = 'deepseek-v4-flash';
const PROVIDER_TIMEOUT_MS = 12_000;
const CLOUDFLARE_AI_GATEWAY_BASE_URL =
  /^https:\/\/gateway\.ai\.cloudflare\.com\/v1\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/deepseek$/;

interface DeepSeekModelAdapterOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export class DeepSeekModelAdapter implements ModelAdapter {
  readonly #fetch: typeof fetch | null;
  readonly #timeoutMs: number;

  constructor(options: DeepSeekModelAdapterOptions = {}) {
    this.#fetch =
      options.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch : null);
    this.#timeoutMs = options.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  }

  async generateQuestions(request: GenerateQuestionsRequest, env: Env): Promise<ProviderResult> {
    const apiKey = env.DEEPSEEK_API_KEY?.trim();
    const endpoint = endpointFor(env);
    if (!apiKey || !this.#fetch || !endpoint) {
      return { kind: 'failure', code: 'unavailable' };
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);

    try {
      const response = await this.#fetch(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: buildGenerateQuestionsMessages(request),
          response_format: { type: 'json_object' },
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return { kind: 'failure', code: failureCodeForStatus(response.status) };
      }

      if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
        return { kind: 'failure', code: 'invalid-response' };
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { kind: 'failure', code: 'invalid-response' };
      }

      const content = providerContent(body);
      if (!content) {
        return { kind: 'failure', code: 'invalid-response' };
      }

      let parsedContent: unknown;
      try {
        parsedContent = JSON.parse(content);
      } catch {
        return { kind: 'failure', code: 'invalid-response' };
      }

      const result = GenerateQuestionsResultSchema.safeParse(parsedContent);
      return result.success
        ? { kind: 'success', model: DEEPSEEK_MODEL, result: result.data }
        : { kind: 'failure', code: 'invalid-response' };
    } catch (error) {
      if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
        return { kind: 'failure', code: 'timeout' };
      }
      return { kind: 'failure', code: 'unavailable' };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function failureCodeForStatus(
  status: number,
): 'invalid-request' | 'timeout' | 'rate-limited' | 'upstream' {
  if (status === 408 || status === 504) {
    return 'timeout';
  }
  if (status === 429) {
    return 'rate-limited';
  }
  if (status >= 400 && status < 500) {
    return 'invalid-request';
  }
  return 'upstream';
}

function endpointFor(env: Env): string | null {
  const configuredBaseUrl = env.DEEPSEEK_BASE_URL?.trim();
  if (!configuredBaseUrl || configuredBaseUrl === DEEPSEEK_BASE_URL) {
    return DEEPSEEK_ENDPOINT;
  }
  return CLOUDFLARE_AI_GATEWAY_BASE_URL.test(configuredBaseUrl)
    ? `${configuredBaseUrl}/chat/completions`
    : null;
}

function providerContent(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('choices' in body)) {
    return null;
  }

  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const firstChoice = choices[0];
  if (typeof firstChoice !== 'object' || firstChoice === null || !('message' in firstChoice)) {
    return null;
  }
  const message = (firstChoice as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null || !('content' in message)) {
    return null;
  }
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' && content.trim().length > 0 ? content : null;
}

export { DEEPSEEK_ENDPOINT, DEEPSEEK_MODEL };
