import type { GenerateQuestionsRequest, AIQuestionContext } from '../contract';
import { GenerateQuestionsResultSchema } from '../contract';
import type { ModelAdapter, ProviderResult } from './types';

function idPart(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.slice(0, 48) || 'item';
}

function createChoiceCandidate(item: AIQuestionContext, requestId: string, index: number) {
  const questionId = `mock-${idPart(requestId)}-q${index + 1}`;
  const optionId = `${questionId}-correct`;
  const distractorId = `${questionId}-other`;
  return {
    itemId: item.itemId,
    question: {
      schemaVersion: 1 as const,
      id: questionId,
      language: item.language,
      type: 'choice' as const,
      skill: 'vocabulary-meaning',
      prompt: {
        instruction: '选择最符合的中文释义',
        content: item.headword,
      },
      options: [
        { id: optionId, label: item.meaning },
        { id: distractorId, label: item.partOfSpeech },
      ],
      answer: {
        kind: 'choice' as const,
        correctOptionIds: [optionId],
      },
      explanation: `${item.headword}：${item.meaning}`,
      audio: null,
      metadata: {
        source: 'ai' as const,
        difficulty: Math.min(5, Math.max(1, Math.round(item.difficulty / 2) || 1)),
        tags: ['ai', 'mock', ...item.tags.slice(0, 3)],
      },
    },
  };
}

function createTextCandidate(item: AIQuestionContext, requestId: string, index: number) {
  const questionId = `mock-${idPart(requestId)}-q${index + 1}`;
  const acceptedAnswers = [item.headword, item.reading, item.phonetic].filter(
    (answer): answer is string => Boolean(answer),
  );
  return {
    itemId: item.itemId,
    question: {
      schemaVersion: 1 as const,
      id: questionId,
      language: item.language,
      type: 'textInput' as const,
      skill: 'vocabulary-recall',
      prompt: {
        instruction: '根据中文释义输入词或读音',
        content: item.meaning,
      },
      options: [],
      answer: {
        kind: 'textInput' as const,
        acceptedAnswers: acceptedAnswers.length > 0 ? acceptedAnswers : [item.headword],
        caseSensitive: false,
        trimWhitespace: true,
      },
      explanation: `${item.headword}：${item.meaning}`,
      audio: null,
      metadata: {
        source: 'ai' as const,
        difficulty: Math.min(5, Math.max(1, Math.round(item.difficulty / 2) || 1)),
        tags: ['ai', 'mock', ...item.tags.slice(0, 3)],
      },
    },
  };
}

export class MockModelAdapter implements ModelAdapter {
  async generateQuestions(request: GenerateQuestionsRequest): Promise<ProviderResult> {
    const questions = request.content.items
      .slice(0, request.targetCount)
      .map((item, index) =>
        index % 2 === 0
          ? createChoiceCandidate(item, request.requestId, index)
          : createTextCandidate(item, request.requestId, index),
      );
    const result = GenerateQuestionsResultSchema.parse({ questions });
    return { kind: 'success', model: 'mock-v1', result };
  }
}
