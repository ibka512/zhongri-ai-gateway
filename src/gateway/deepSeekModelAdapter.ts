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
      options.fetch ??
      (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
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
        cache: 'no-store',
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: buildGenerateQuestionsMessages(request),
          thinking: { type: 'disabled' },
          max_tokens: 2_048,
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

      const normalizedContent = normalizeProviderResult(parsedContent, request);
      const result = GenerateQuestionsResultSchema.safeParse(normalizedContent);
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

/**
 * DeepSeek may return a compact candidate shape even when JSON output is enabled.
 * Normalize only the bounded shape we understand, then run the frozen schema again.
 */
function normalizeProviderResult(body: unknown, request: GenerateQuestionsRequest): unknown {
  if (GenerateQuestionsResultSchema.safeParse(body).success) {
    return body;
  }

  if (!isRecord(body) || !Array.isArray(body.questions)) {
    return body;
  }

  const normalizedQuestions = body.questions.map((candidate, index) =>
    normalizeCompactCandidate(candidate, request, index),
  );
  return normalizedQuestions.every((candidate) => candidate !== null)
    ? { questions: normalizedQuestions }
    : body;
}

function normalizeCompactCandidate(
  candidate: unknown,
  request: GenerateQuestionsRequest,
  index: number,
): Record<string, unknown> | null {
  if (!isRecord(candidate)) {
    return null;
  }

  const compactCandidate = isRecord(candidate.question)
    ? { ...candidate.question, itemId: candidate.itemId ?? candidate.item_id }
    : candidate;
  const itemId = stringValue(compactCandidate.itemId ?? compactCandidate.item_id);
  const item = itemId
    ? request.content.items.find((contentItem) => contentItem.itemId === itemId)
    : null;
  const type =
    compactType(compactCandidate.type) ??
    (isRecord(compactCandidate.answer) ? compactType(compactCandidate.answer.kind) : null);
  if (!item || !type) {
    return null;
  }
  const promptContent =
    compactPromptContent(compactCandidate.prompt) ??
    (type === 'choice' ? item.headword : item.meaning);

  const questionId = `ai-question-${index + 1}`;
  const questionBase = {
    schemaVersion: 1,
    id: questionId,
    language: request.language,
    skill: type === 'choice' ? 'vocabulary-meaning' : 'vocabulary-recall',
    prompt: compactPrompt(compactCandidate.prompt, promptContent),
    explanation: stringValue(compactCandidate.explanation),
    audio: null,
    metadata: {
      source: 'ai',
      difficulty: Math.min(5, Math.max(1, item.difficulty)),
      tags: ['ai', 'vocabulary'],
    },
  };

  if (type === 'choice') {
    const distractorLabels = stringList(
      compactCandidate.distractors ?? compactCandidate.options ?? compactCandidate.choices,
    );
    const labels = uniqueStrings([item.meaning, ...distractorLabels]);
    if (labels.length < 2) {
      return null;
    }

    const options = labels.map((label, optionIndex) => ({
      id: `${questionId}-option-${optionIndex + 1}`,
      label,
    }));
    return {
      itemId,
      question: {
        ...questionBase,
        type,
        options,
        answer: { kind: 'choice', correctOptionIds: [options[0].id] },
      },
    };
  }

  const acceptedAnswers = uniqueStrings([
    ...stringList(
      compactCandidate.answer ??
        compactCandidate.acceptedAnswers ??
        compactCandidate.accepted_answers,
    ),
    item.headword,
    ...(item.reading ? [item.reading] : []),
  ]);
  return acceptedAnswers.length > 0
    ? {
        itemId,
        question: {
          ...questionBase,
          type,
          options: [],
          answer: {
            kind: 'textInput',
            acceptedAnswers,
            caseSensitive: false,
            trimWhitespace: true,
          },
        },
      }
    : null;
}

function compactPrompt(value: unknown, content: string): Record<string, string> {
  const instruction = isRecord(value) ? stringValue(value.instruction) : null;
  return instruction ? { instruction, content } : { content };
}

function compactPromptContent(value: unknown): string | null {
  if (typeof value === 'string') {
    return stringValue(value);
  }
  if (!isRecord(value)) {
    return null;
  }
  return stringValue(value.content ?? value.text ?? value.question);
}

function compactType(value: unknown): 'choice' | 'textInput' | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase().replace(/[-_]/g, '');
  if (normalized === 'choice' || normalized === 'multiplechoice' || normalized === 'mcq') {
    return 'choice';
  }
  if (normalized === 'textinput' || normalized === 'text' || normalized === 'fillin') {
    return 'textInput';
  }
  return null;
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') {
    const item = stringValue(value);
    return item ? [item] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => stringList(item));
  }
  if (!isRecord(value)) {
    return [];
  }
  for (const key of [
    'label',
    'text',
    'value',
    'correct',
    'correctAnswer',
    'answer',
    'acceptedAnswers',
  ]) {
    if (key in value) {
      return stringList(value[key]);
    }
  }
  return [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
