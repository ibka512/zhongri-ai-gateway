import { z } from 'zod';

export const ContractVersionSchema = z.literal(1);
export const IdentifierSchema = z.string().trim().min(1).max(128);
export const NonBlankStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'String must contain non-whitespace characters');
export const LanguageSchema = z.enum(['ja', 'en']);

export const AITaskName = {
  GenerateQuestions: 'generateQuestions',
} as const;
export const AITaskNameSchema = z.literal(AITaskName.GenerateQuestions);
export type AITaskName = z.infer<typeof AITaskNameSchema>;

export const AIPromptVersion = 'generate-questions-v1' as const;
export const AIPromptVersionSchema = z.literal(AIPromptVersion);

export const AIProtocolFailureCodeSchema = z.enum([
  'invalid-request',
  'invalid-response',
  'unavailable',
  'timeout',
  'rate-limited',
  'upstream',
]);
export type AIProtocolFailureCode = z.infer<typeof AIProtocolFailureCodeSchema>;

const SafeVersionTokenSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);

export const AITraceMetadataSchema = z
  .object({
    requestId: IdentifierSchema,
    schemaVersion: ContractVersionSchema,
    task: AITaskNameSchema,
    promptVersion: AIPromptVersionSchema,
    model: SafeVersionTokenSchema.nullable(),
    gatewayVersion: SafeVersionTokenSchema.nullable(),
    durationMs: z.number().int().nonnegative().max(120_000).nullable(),
  })
  .strict();
export type AITraceMetadata = z.infer<typeof AITraceMetadataSchema>;

export const AIProfileSummarySchema = z
  .object({
    language: LanguageSchema,
    answeredCount: z.number().int().nonnegative().max(100_000),
    accuracy: z.number().min(0).max(1),
    recentIncorrectItemIds: z.array(IdentifierSchema).max(5),
    recentTrend: z.enum(['insufficient', 'improving', 'stable', 'declining']),
    dailyMinutes: z.union([z.literal(5), z.literal(10), z.literal(15)]),
    focus: z.enum(['balanced', 'review', 'new-content', 'foundations']),
  })
  .strict()
  .superRefine((profile, context) => {
    if (new Set(profile.recentIncorrectItemIds).size !== profile.recentIncorrectItemIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['recentIncorrectItemIds'],
        message: 'Recent incorrect item ids must be unique',
      });
    }
  });
export type AIProfileSummary = z.infer<typeof AIProfileSummarySchema>;

export const AIQuestionContextSchema = z
  .object({
    itemId: IdentifierSchema,
    language: LanguageSchema,
    headword: NonBlankStringSchema.max(200),
    reading: NonBlankStringSchema.max(200).nullable(),
    phonetic: NonBlankStringSchema.max(200).nullable(),
    meaning: NonBlankStringSchema.max(2_000),
    partOfSpeech: NonBlankStringSchema.max(200),
    level: NonBlankStringSchema.max(64),
    difficulty: z.number().int().min(0).max(10),
    tags: z.array(NonBlankStringSchema.max(100)).max(10),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.language === 'ja' && !item.reading) {
      context.addIssue({
        code: 'custom',
        path: ['reading'],
        message: 'Japanese items require a reading',
      });
    }

    if (new Set(item.tags).size !== item.tags.length) {
      context.addIssue({
        code: 'custom',
        path: ['tags'],
        message: 'Item tags must be unique',
      });
    }
  });
export type AIQuestionContext = z.infer<typeof AIQuestionContextSchema>;

const GenerateQuestionsContentSchema = z
  .object({
    manifestId: IdentifierSchema,
    contentVersion: z.number().int().positive(),
    items: z.array(AIQuestionContextSchema).min(1).max(5),
  })
  .strict()
  .superRefine((content, context) => {
    const itemIds = content.items.map((item) => item.itemId);
    if (new Set(itemIds).size !== itemIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Content item ids must be unique',
      });
    }
  });

export const GenerateQuestionsRequestSchema = z
  .object({
    schemaVersion: ContractVersionSchema,
    task: AITaskNameSchema,
    requestId: IdentifierSchema,
    language: LanguageSchema,
    targetCount: z.number().int().min(1).max(5),
    profile: AIProfileSummarySchema,
    content: GenerateQuestionsContentSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (request.profile.language !== request.language) {
      context.addIssue({
        code: 'custom',
        path: ['profile', 'language'],
        message: 'Profile language must match request language',
      });
    }

    if (request.content.items.some((item) => item.language !== request.language)) {
      context.addIssue({
        code: 'custom',
        path: ['content', 'items'],
        message: 'All content items must match request language',
      });
    }

    if (request.targetCount > request.content.items.length) {
      context.addIssue({
        code: 'custom',
        path: ['targetCount'],
        message: 'Target count cannot exceed content item count',
      });
    }
  });
export type GenerateQuestionsRequest = z.infer<typeof GenerateQuestionsRequestSchema>;

const QuestionPromptSchema = z
  .object({
    instruction: NonBlankStringSchema.max(500).optional(),
    content: NonBlankStringSchema.max(4_000),
  })
  .strict();

const QuestionOptionSchema = z
  .object({
    id: IdentifierSchema,
    label: NonBlankStringSchema.max(1_000),
  })
  .strict();

const QuestionMetadataSchema = z
  .object({
    source: z.enum(['builtin', 'manual', 'ai']),
    difficulty: z.number().int().min(1).max(5).optional(),
    tags: z.array(NonBlankStringSchema.max(64)).max(20).optional(),
    createdAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const QuestionAudioSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('tts'),
      text: NonBlankStringSchema.max(4_000),
      playbackRate: z.number().min(0.5).max(2).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('asset'),
      assetId: IdentifierSchema,
      transcript: NonBlankStringSchema.max(4_000).optional(),
    })
    .strict(),
]);

const QuestionBaseSchema = z
  .object({
    schemaVersion: ContractVersionSchema,
    id: IdentifierSchema,
    language: LanguageSchema,
    skill: NonBlankStringSchema.max(64),
    prompt: QuestionPromptSchema,
    explanation: NonBlankStringSchema.max(4_000).nullable(),
    metadata: QuestionMetadataSchema,
  })
  .strict();

const ChoiceQuestionSchema = QuestionBaseSchema.extend({
  type: z.literal('choice'),
  answer: z
    .object({
      kind: z.literal('choice'),
      correctOptionIds: z.array(IdentifierSchema).min(1).max(10),
    })
    .strict(),
  options: z.array(QuestionOptionSchema).min(2).max(12),
  audio: QuestionAudioSchema.nullable(),
});

const TextInputQuestionSchema = QuestionBaseSchema.extend({
  type: z.literal('textInput'),
  answer: z
    .object({
      kind: z.literal('textInput'),
      acceptedAnswers: z.array(NonBlankStringSchema.max(4_000)).min(1).max(20),
      caseSensitive: z.boolean(),
      trimWhitespace: z.boolean(),
    })
    .strict(),
  options: z.tuple([]),
  audio: QuestionAudioSchema.nullable(),
});

const QuestionSchema = z
  .discriminatedUnion('type', [ChoiceQuestionSchema, TextInputQuestionSchema])
  .superRefine((question, context) => {
    if (question.type === 'textInput') {
      if (
        new Set(question.answer.acceptedAnswers).size !== question.answer.acceptedAnswers.length
      ) {
        context.addIssue({
          code: 'custom',
          path: ['answer', 'acceptedAnswers'],
          message: 'Accepted answers must be unique',
        });
      }
      return;
    }

    const optionIds = question.options.map((option) => option.id);
    const knownOptionIds = new Set(optionIds);
    if (knownOptionIds.size !== optionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Option ids must be unique',
      });
    }

    for (const correctOptionId of question.answer.correctOptionIds) {
      if (!knownOptionIds.has(correctOptionId)) {
        context.addIssue({
          code: 'custom',
          path: ['answer', 'correctOptionIds'],
          message: 'Unknown correct option id',
        });
      }
    }
  });

const AIQuestionCandidateSchema = z
  .object({
    itemId: IdentifierSchema,
    question: QuestionSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.question.metadata.source !== 'ai') {
      context.addIssue({
        code: 'custom',
        path: ['question', 'metadata', 'source'],
        message: 'Generated questions must be marked as AI sourced',
      });
    }
  });

export const GenerateQuestionsResultSchema = z
  .object({
    questions: z.array(AIQuestionCandidateSchema).min(1).max(5),
  })
  .strict()
  .superRefine((result, context) => {
    const questionIds = result.questions.map((candidate) => candidate.question.id);
    const itemIds = result.questions.map((candidate) => candidate.itemId);
    if (new Set(questionIds).size !== questionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['questions'],
        message: 'Question ids must be unique',
      });
    }
    if (new Set(itemIds).size !== itemIds.length) {
      context.addIssue({ code: 'custom', path: ['questions'], message: 'Item ids must be unique' });
    }
  });
export type GenerateQuestionsResult = z.infer<typeof GenerateQuestionsResultSchema>;

const AIGatewayResponseBaseSchema = z.object({
  schemaVersion: ContractVersionSchema,
  task: AITaskNameSchema,
  requestId: IdentifierSchema,
  trace: AITraceMetadataSchema,
});

export const AIGatewaySuccessSchema = AIGatewayResponseBaseSchema.extend({
  status: z.literal('success'),
  result: GenerateQuestionsResultSchema,
}).strict();
export type AIGatewaySuccess = z.infer<typeof AIGatewaySuccessSchema>;

export const AIGatewayFailureSchema = AIGatewayResponseBaseSchema.extend({
  status: z.literal('failure'),
  error: z
    .object({
      code: AIProtocolFailureCodeSchema,
      retryable: z.boolean(),
    })
    .strict(),
}).strict();
export type AIGatewayFailure = z.infer<typeof AIGatewayFailureSchema>;

export const AIGatewayResponseSchema = z.discriminatedUnion('status', [
  AIGatewaySuccessSchema,
  AIGatewayFailureSchema,
]);
export type AIGatewayResponse = z.infer<typeof AIGatewayResponseSchema>;

export const AIRequestSchema = GenerateQuestionsRequestSchema;
export const AIResultSchema = AIGatewaySuccessSchema;
export const AIFailureSchema = AIGatewayFailureSchema;
export const AIResponseSchema = AIGatewayResponseSchema;
