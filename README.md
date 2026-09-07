# Harness Switcher TUI

纯终端 demo。两个真实官方 `HarnessAgent`：**Pi / Cline**。任务后台并发；Tab 切换观察，不取消任务。模型请求只走本机 **CPA**，不使用 Vercel AI Gateway，也不需要 Vercel 账号或云 sandbox。

## 启动

需要 Node.js 24+、npm；PTY 测试另需 Python 3。终端建议至少 80×24。

```bash
cd /Users/liushiyuwin/projects/harness-switcher-tui
npm start                 # 真实 CPA
npm run demo              # 明确标记的离线模拟，不发模型请求
```

依赖已经安装。全新复制项目后：

```bash
npm ci --ignore-scripts --fetch-timeout=30000 --fetch-retries=1
```

CPA 配置读取顺序：进程环境变量 > `.env.local` > `~/.env`。没有指定 CPA 地址和密钥时，读取已有 `~/.config/claudex/env` 的 `CLAUDEX_PROXY_BASE_URL` / `CLAUDEX_PROXY_TOKEN`。不执行 shell、不复制密钥、不修改全局配置。

当前机器使用 CPA `http://127.0.0.1:8318/v1`，已有本机配置，无需重新填写密钥。**最后一次真实复测遇到 CPA 上游 HTTP 401 `auth_unavailable`，真实任务目前不能保证运行成功；可先用 `npm run demo` 体验离线 TUI。** 其他机器参考 `.env.example` 创建 `.env.local`。地址只允许 HTTP loopback `/v1`，配置错误即失败，不会切到离线或其他 provider。

## 键盘

- **Tab**：Pi / Cline 切换，同时切换新任务使用的 harness。
- **Enter**：提交输入；每个任务创建独立会话和内存工作区。
- **↑ / ↓**：选择当前 harness 下的任务。
- **PgUp / PgDn**：翻阅所选任务输出。
- **Ctrl+X**：取消所选任务，其他任务继续。
- **Ctrl+U**：清空输入。
- **Ctrl+Q / Ctrl+C**：取消全部后台任务、销毁会话、恢复终端后退出。

先在 Pi 提交“写入 note.txt 并读回内容”，立即 Tab 切到 Cline，提交另一个任务。两边任务同时执行，切回可看结果。模型文本流、工具活动、错误和取消状态均显示在终端。

## 实际边界

- 切换的是**不同任务的独立会话**，不是迁移原生聊天历史。每次 Enter 都是新会话；不做多轮续聊或跨进程恢复。
- 最多 4 并发、20 个任务；输入最多 4000 字符，输出只保留最近 80k 字符。
- 单任务 120 秒（含启动），单 HTTP 请求 60 秒，模型目录 10 秒，单次 sandbox 命令 10 秒。退出清理超过 8 秒会恢复终端并强制结束进程，报告失败。
- `just-bash` 是**内存文件系统与 shell 模拟器**，不是容器或 microVM。没有挂载宿主项目，没有安装依赖或暴露网络端口。不要把它当作运行不可信 Node.js 扩展的安全边界。
- 每个任务结束即销毁工作区；没有磁盘文件产物、后台守护进程、跨进程恢复或无限 shell 命令支持。
- 工具开放 `read/write/edit/bash/grep/glob/ls`，没有 MCP、宿主扩展或交互审批。真实 smoke 只证明文件写读和文本流；未声称所有工具组合都已验证。
- 默认两端都显式请求 CPA 的 `gpt-4o`，**不代表 CPA 上游实际模型身份已独立核验**。`CPA_CLINE_MODEL` 可显式覆盖；`CPA_PI_MODEL` 还必须通过 demo 的保守 Pi 兼容目录校验。未知模型拒绝，不静默替换。

## 已验证

```bash
npm run check            # TypeScript
npm test                 # 14 项自动测试，不请求模型
npm run smoke            # 两种真实 HarnessAgent 并发写读文件、文本流、会话销毁
npm run test:pty         # 离线真实 PTY 键盘测试
npm run test:pty:live     # 使用 CPA 的真实 PTY 键盘测试
```

2026-09-07 最后收尾复测：`check`、**14/14 单元测试**、离线 PTY 全部通过，覆盖最终的迟到会话清理修改。真实 smoke 返回 **HTTP 401 `auth_unavailable`**：`Encountered invalidated oauth token for user, failing request`。没有修改 CPA 或切换 provider；因认证已失败，本轮不重复 live PTY。

同日较早的干净 `npm ci --ignore-scripts`、真实 Pi/Cline 并发文件写读 smoke、离线/真实 PTY 曾通过。历史 PTY 实测 Tab、后台并发、切回完成任务、取消、窗口缩放、方向键、翻页、带活动任务退出及终端 raw mode 恢复。**历史通过不代表当前 CPA 凭据仍有效。**

`test-results/` 保存本机验证输出及纯文本终端捕获，已 gitignore。当前 `smoke-live.log` 是认证失败证据；`pty-live-run.log` / `pty-live.txt` 保留较早的真实 PTY 通过证据。成功 smoke 只记录模型 ID、请求路径、事件数量，不记录密钥；Pi 使用 `/v1/responses`，Cline 使用 `/v1/chat/completions`。测试还主动注入假的 ambient Gateway 凭据，验证显式 CPA 配置不会被覆盖。

## 研究与兼容说明

Exa 检索官方资料后，核对了安装版本的 `.d.ts` 与 `src/`，没有照抄旧示例：

1. [Harness 概览](https://ai-sdk.dev/docs/ai-sdk-harnesses/overview)：harness 是完整 agent runtime，不是模型 provider。
2. [HarnessAgent](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)：真实 `createSession`、`stream`、`session.destroy` 生命周期。
3. [Pi](https://ai-sdk.dev/providers/ai-sdk-harnesses/pi)：host runtime；隔离 auth record 支持 `OPENAI_API_KEY` / `OPENAI_BASE_URL`。
4. [Cline](https://ai-sdk.dev/providers/ai-sdk-harnesses/cline)：host runtime；显式 provider、API key 和 `baseUrl`。
5. [官方适配器矩阵](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-adapters)：Codex、Claude Code、OpenCode 属于 sandbox bridge，不适合本 demo 的无端口本地 sandbox；未纳入运行选项。
6. [Vercel 示例](https://vercel.com/kb/guide/sandboxed-coding-agent-with-harnessagent)：借用统一 harness 概念，**没有采用其中的 AI Gateway / Vercel Sandbox 认证路线**。
7. [官方源码](https://github.com/vercel/ai/tree/main/packages)、[just-bash](https://github.com/vercel-labs/just-bash)：依赖采用官方 npm 发布，版本锁在 `package-lock.json`。GitHub API 元数据请求曾返回 403，未编造 star 数。

关键版本：`ai 7.0.93`、`@ai-sdk/harness 1.0.102`、`harness-pi 1.0.104`、`harness-cline 1.0.29`、`sandbox-just-bash 1.0.102`、`just-bash 2.14.5`。

发现并处理两处官方文档/包差异：

- Cline 文档写 `providerId: 'openai'`，安装版 `@cline/llms 0.0.79` 实际报 `Unknown or disabled provider "openai".`。项目使用源码确认有效的 **`openai-compatible`**，并设置 `auth: {}` 禁用环境凭据回退。Cline SDK 内部名为 gateway 的类不是 Vercel AI Gateway；本项目只配置 CPA provider。
- Pi 文件工具依赖 `realpath`，而 just-bash 默认没有该命令。`src/sandbox.ts` 使用官方 `defineCommand` / `registerCommand` 扩展点，调用**虚拟 FS 的 `realpath`**补齐单路径用法。相对/绝对路径、缺失文件、参数错误、符号链接、循环链接和宿主路径不可访问均有测试。没有改 `node_modules` 或调用宿主 shell。

Pi 的模型保护使用适配器依赖的 `@earendil-works/pi-ai 0.74.2` 静态目录，属于保守子集；实际 Pi runtime 可能支持更多模型。此 demo 优先避免未知 ID 触发隐式模型选择，不提供自动模型注册。

曾试验 `gpt-5.6-luna`，CPA 上游返回 `Encountered invalidated oauth token for user, failing request`；另遇一次 `utls: TLS handshake: EOF`。未修改 CPA，也未自动换 provider。默认 `gpt-4o` 的独立验证随后通过；这不保证 CPA 上游永远可用。

## 已知依赖风险

`npm audit` 当前报告 **13 moderate + 1 high**：高危来自 Cline 间接带入、此 demo 未使用的 Dify provider 下 `undici 5.29.0`；其余主要为 OpenTelemetry 依赖。没有运行 `audit fix --force` 或擅自跨 major override。安装还包含第三方包的 deprecated/peer 警告。

这是本机 demo，不是生产安全验收。上线前必须重新审计并修复或隔离相关依赖；HTTP fetch 限制和内存工作区不能替代供应链治理。
