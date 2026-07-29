# 钟日 AI Gateway

独立的 Cloudflare Worker 边界，只暴露受约束的 `generateQuestions` 任务。PWA 不保存供应商密钥，
Gateway 也不提供任意 prompt、任意 model 或通用代理。

## 当前状态（2026-07-29）

本地 Worker 工程已完成，公开远端
[`ibka512/zhongri-ai-gateway`](https://github.com/ibka512/zhongri-ai-gateway) 的 `main` 已推送并核对。
Worker 已部署到 [`zhongri-ai-gateway.moyu54433.workers.dev`](https://zhongri-ai-gateway.moyu54433.workers.dev)，
最终干净版本为 `2594b989-f42b-4c49-b806-8dd9265f0c82`，`GET /health` 已返回 200；同一合成 fixture
连续两次真实联调均返回 HTTP 200 的合同 `success`，耗时约 3.8–4.2 秒。

Cloudflare AI Gateway 网关 `zhongri-deepseek` 已创建，Worker 使用官方 DeepSeek provider 路径；网关请求日志
关闭，Authenticated Gateway 关闭（Worker 只发送 DeepSeek `Authorization`，不再需要第二个 Cloudflare token）。
Cloudflare 已存在名为 `DEEPSEEK_API_KEY` 的 Secret（只核对名称，值未被读取、写入仓库或日志）。固定端点、
请求/响应 Schema、CORS、Mock provider、DeepSeek adapter、稳定 failure mapping、17 个测试、TypeScript
构建和 secret scan 均已通过。

为处理 Cloudflare Worker 直连 DeepSeek 的出站失败，Gateway 现在支持受限的
`DEEPSEEK_BASE_URL` 运行时变量：未设置时仍使用 `https://api.deepseek.com`；设置时只接受
Cloudflare 官方 AI Gateway 的 DeepSeek 基础地址
`https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/deepseek`，并自动追加
`/chat/completions`。该变量已在生产环境配置为 `zhongri-deepseek` 网关地址；运行时仍不接受任意外部 URL。

DeepSeek 的 JSON 输出可能是完整合同，也可能是紧凑候选结构。Gateway 只对已提交词条、固定题型和有限字段
做受限转换，转换结果仍必须通过完整的 `GenerateQuestionsResultSchema` 和请求匹配校验；不把模型原文直接写入
PWA 学习事实。

`contracts/ai-task-protocol-v1.json` 是两仓共享 fixture；本仓库新增的契约测试会校验它，主仓库的
`npm run verify:gateway-contract` 会比较两份 fixture 的 SHA，防止协议样例漂移。

下一步：将 Gateway 成功路径接入 PWA 的按需 AI 解释/出题入口，并继续保留失败时的本地规则课程回退；
旧的误建 Secret 名称尚未清理，需负责人确认后删除或轮换。

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
Secret；生产请求通过受限 Cloudflare AI Gateway 出口调用 DeepSeek。

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

真实部署已确认 Cloudflare Worker 账户、域名/CORS 来源、AI Gateway 网关和 Secret 配置。禁止把
`DEEPSEEK_API_KEY` 写入 Wrangler vars、`.dev.vars.example` 的真实值、测试 fixture、日志或 Git，也不要
把 Key 改为由浏览器直接提交。
