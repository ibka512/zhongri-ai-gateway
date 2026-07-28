import { GenerateQuestionsRequestSchema } from '../../src/contract';

export const validGenerateQuestionsRequest = GenerateQuestionsRequestSchema.parse({
  schemaVersion: 1,
  task: 'generateQuestions',
  requestId: 'ai-request-ja-001',
  language: 'ja',
  targetCount: 2,
  profile: {
    language: 'ja',
    answeredCount: 12,
    accuracy: 0.75,
    recentIncorrectItemIds: ['word-ja-002'],
    recentTrend: 'stable',
    dailyMinutes: 10,
    focus: 'review',
  },
  content: {
    manifestId: 'builtin-ja-n5',
    contentVersion: 1,
    items: [
      {
        itemId: 'word-ja-001',
        language: 'ja',
        headword: '時計',
        reading: 'とけい',
        phonetic: null,
        meaning: '钟表；手表',
        partOfSpeech: 'noun',
        level: 'N5',
        difficulty: 1,
        tags: ['daily'],
      },
      {
        itemId: 'word-ja-002',
        language: 'ja',
        headword: '電話',
        reading: 'でんわ',
        phonetic: null,
        meaning: '电话',
        partOfSpeech: 'noun',
        level: 'N5',
        difficulty: 2,
        tags: ['daily'],
      },
    ],
  },
});
