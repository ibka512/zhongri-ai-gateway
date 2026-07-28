import type {
  AIProtocolFailureCode,
  GenerateQuestionsRequest,
  GenerateQuestionsResult,
} from '../contract';

export interface Env {
  readonly CORS_ORIGINS?: string;
  readonly DEEPSEEK_API_KEY?: string;
  readonly GATEWAY_VERSION?: string;
  readonly MOCK_PROVIDER?: string;
}

export type ProviderResult =
  | {
      readonly kind: 'success';
      readonly model: string;
      readonly result: GenerateQuestionsResult;
    }
  | {
      readonly kind: 'failure';
      readonly code: AIProtocolFailureCode;
    };

export interface ModelAdapter {
  generateQuestions: (request: GenerateQuestionsRequest, env: Env) => Promise<ProviderResult>;
}

export interface GatewayDependencies {
  readonly modelAdapter?: ModelAdapter;
  readonly now?: () => number;
  readonly createRequestId?: () => string;
}
