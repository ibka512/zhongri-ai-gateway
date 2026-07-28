import type { GenerateQuestionsRequest } from '../contract';

export const GENERATE_QUESTIONS_PROMPT_VERSION = 'generate-questions-v1' as const;

const SYSTEM_PROMPT = [
  'You generate structured language-learning question candidates.',
  'Use only the supplied content items and language.',
  'Do not invent external URLs, sources, or unsupported question types.',
  'Return JSON matching the GenerateQuestionsResult contract with no additional fields.',
].join(' ');

export function buildGenerateQuestionsMessages(
  request: GenerateQuestionsRequest,
): [
  { readonly role: 'system'; readonly content: string },
  { readonly role: 'user'; readonly content: string },
] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        language: request.language,
        targetCount: request.targetCount,
        profile: request.profile,
        content: request.content,
      }),
    },
  ];
}
