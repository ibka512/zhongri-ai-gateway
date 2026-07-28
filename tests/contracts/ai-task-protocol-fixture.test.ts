import { describe, expect, it } from 'vitest';

import { AIGatewayResponseSchema, GenerateQuestionsRequestSchema } from '../../src/contract';
import canonicalFixture from '../../contracts/ai-task-protocol-v1.json';

describe('cross-repository AI Task Protocol v1 fixture', () => {
  it('is accepted by the Gateway request and response schemas', () => {
    expect(GenerateQuestionsRequestSchema.safeParse(canonicalFixture.request).success).toBe(true);
    expect(AIGatewayResponseSchema.safeParse(canonicalFixture.success).success).toBe(true);
    expect(AIGatewayResponseSchema.safeParse(canonicalFixture.failure).success).toBe(true);
  });

  it('keeps the request and response correlation fields stable', () => {
    expect(canonicalFixture.success.requestId).toBe(canonicalFixture.request.requestId);
    expect(canonicalFixture.failure.requestId).toBe(canonicalFixture.request.requestId);
    expect(canonicalFixture.success.trace.requestId).toBe(canonicalFixture.request.requestId);
    expect(canonicalFixture.failure.trace.requestId).toBe(canonicalFixture.request.requestId);
  });
});
