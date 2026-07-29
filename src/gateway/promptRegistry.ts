import type { GenerateQuestionsRequest } from '../contract';

export const GENERATE_QUESTIONS_PROMPT_VERSION = 'generate-questions-v1' as const;

const SYSTEM_PROMPT = [
  'You generate structured language-learning question candidates.',
  'Use only the supplied content items and language.',
  'Do not invent external URLs, sources, or unsupported question types.',
  'Return JSON matching the GenerateQuestionsResult contract with no additional fields.',
  'The exact envelope is {"questions":[{"itemId":"<supplied item id>","question":{...}}]}.',
  'Never flatten question fields into the candidate; every candidate must contain a nested question object.',
  'Each question must include schemaVersion 1, id, language, type, skill, prompt, options, answer, explanation, audio, and metadata.',
  'For type choice, use options and answer.kind choice; for type textInput, use options [] and answer.kind textInput.',
  'Set metadata.source to ai, use only supplied item ids, and return at most targetCount candidates.',
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
