# 钟日 AI Gateway

独立的 Cloudflare Worker 边界，只暴露受约束的 `generateQuestions` 任务。PWA 不保存供应商密钥，
Gateway 也不提供任意 prompt、任意 model 或通用代理。

## 当前状态（2026-07-29）

本地 Worker 工程已完成并提交为 `f27cb6e`，共享契约测试提交为 `49dc636`，公开远端
[`ibka512/zhongri-ai-gateway`](https://github.com/ibka512/zhongri-ai-gateway) 的 `main` 已推送并核对为
代码基线为 `dcea4f7`。Worker 已部署到 [`zhongri-ai-gateway.moyu54433.workers.dev`](https://zhongri-ai-gateway.moyu54433.workers.dev)，
当前干净版本为 `452527c6-179e-4b0b-9209-d8c32f21679a`，`GET /health` 已返回 200。固定端点、请求/响应
Schema、CORS、Mock provider、DeepSeek adapter、稳定 failure mapping、15 个契约/适配器测试、TypeScript
构建和 secret scan 均已通过。Cloudflare 已存在名为 `DEEPSEEK_API_KEY` 的 Secret（只核对名称，值未被读取、
写入仓库或日志）；使用合成 fixture 的真实联调返回 HTTP 200 的合同 failure `unavailable`。临时安全 tail
确认 Secret 已被读取，但 Worker 到 DeepSeek 的出站 `fetch` 以 `TypeError` 失败，未收到供应商 HTTP 响应；
因此目前仍未验证真实 DeepSeek 成功链路。

为处理 Cloudflare Worker 直连 DeepSeek 的出站失败，Gateway 现在支持受限的
`DEEPSEEK_BASE_URL` 运行时变量：未设置时仍使用 `https://api.deepseek.com`；设置时只接受
Cloudflare 官方 AI Gateway 的 DeepSeek 基础地址
`https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/deepseek`，并自动追加
`/chat/completions`。该变量尚未在生产环境启用，也不接受任意外部 URL；需要先在 Cloudflare
AI Gateway 创建网关并完成单独验证。

`contracts/ai-task-protocol-v1.json` 是两仓共享 fixture；本仓库新增的契约测试会校验它，主仓库的
`npm run verify:gateway-contract` 会比较两份 fixture 的 SHA，防止协议样例漂移。

下一步：在不把 Key 暴露给 PWA 的前提下，创建并验证 Cloudflare AI Gateway 网关，再设置受限的
`DEEPSEEK_BASE_URL` 并重新执行合成联调；在此之前继续使用稳定 failure 和本地规则课程回退。旧的误建
`sk-…` Secret 名称尚未清理，需负责人在确认后删除或轮换。

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

真实部署已确认 Cloudflare Worker 账户、域名/CORS 来源和 Secret 配置；当前剩余阻塞是 Worker 到
DeepSeek 的出站网络路径。禁止把 `DEEPSEEK_API_KEY` 写入 Wrangler vars、`.dev.vars.example` 的真实值、
测试 fixture、日志或 Git，也不要把 Key 改为由浏览器直接提交。
