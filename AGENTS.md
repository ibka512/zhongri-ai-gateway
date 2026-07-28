# AI Gateway Agent Contract

开始任何工作前阅读 `README.md`，再阅读 `src/contract/schema.ts`、`src/gateway/handler.ts` 和
现有测试。该仓库只负责供应商隔离和结构化任务协议，不写入学习事实。

- 只允许 `generateQuestions`；不得添加自由聊天、任意 prompt/model 或新的供应商入口。
- 真实 `DEEPSEEK_API_KEY` 只能来自 Cloudflare Secret，不得进入代码、fixture、日志、构建物或 Git。
- 所有请求/结果先过 Zod Schema；未知字段、超限输入和不匹配关联元数据必须拒绝。
- Provider 的失败只映射为稳定 failure code，不把上游响应正文透传给浏览器。
- 修改协议时同步更新 `zhongri-v2` 的 Task Protocol、fixture、JSON Schema 和契约测试。
- 每次暂停或提交前运行 `npm run verify`，并更新根项目 `docs/development/HANDOFF.md` 的双仓库状态。
