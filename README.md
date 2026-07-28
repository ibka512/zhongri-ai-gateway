# 钟日 AI Gateway

独立的 Cloudflare Worker 边界，只暴露受约束的 `generateQuestions` 任务。PWA 不保存供应商密钥，
Gateway 也不提供任意 prompt、任意 model 或通用代理。

## 当前状态（2026-07-28）

本地 Worker 工程已完成并提交为 `f27cb6e`，交接文档提交为 `c56918e`；公开远端为
[`ibka512/zhongri-ai-gateway`](https://github.com/ibka512/zhongri-ai-gateway)，`main` 已推送并核对为
`c56918e`。固定端点、请求/响应 Schema、CORS、Mock provider、
DeepSeek adapter、稳定 failure mapping、13 个契约/适配器测试、TypeScript 构建和 secret scan 均已
通过，Wrangler dry-run 也已通过。当前仍未配置 Cloudflare Secret，也未执行真实 DeepSeek 请求或
生产部署。

下一步顺序：与 `zhongri-v2` 做双端 contract tests；真实 Secret
和生产联调必须单独批准。

## 本地验证

```bash
npm install
npm run verify
```

本地开发可复制 `.dev.vars.example` 为 `.dev.vars`，默认使用确定性的 Mock provider：

```bash
cp .dev.vars.example .dev.vars
npm run dev
```

生产环境只允许 Cloudflare Worker Secret `DEEPSEEK_API_KEY` 提供供应商密钥。当前仓库不包含真实
Secret，也不默认调用 DeepSeek。

## 端点

- `GET /health`：只返回服务、协议和 Gateway 版本。
- `POST /v1/tasks/generate-questions`：唯一 AI 任务；请求和结果均经过版本化 Zod Schema 校验。

所有响应都禁止记录完整上下文、Prompt、供应商原文或密钥。AI 失败只返回稳定 failure code，PWA
可回退到本地规则课程。

## 与 `zhongri-v2` 的合同

`src/contract/schema.ts` 是 Gateway 侧的独立校验副本，必须与 PWA 的
`src/schemas/v1/AITaskProtocolSchema.ts` 保持同步。`tests/fixtures/ai-task-protocol.ts` 使用相同的
字段形状，修改协议时必须先更新两边的 fixture 和契约测试。

## 部署前置

真实部署需要负责人另行确认 Cloudflare Worker 账户、域名/CORS 来源和 Secret 配置。禁止把
`DEEPSEEK_API_KEY` 写入 Wrangler vars、`.dev.vars.example` 的真实值、测试 fixture、日志或 Git。
