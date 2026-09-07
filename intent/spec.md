# Spec：多 Harness 后台任务终端演示

Parent intent: [intent.md](./intent.md)（accepted；用户在 SDLC 审计后回复“GO”）
Status: accepted
Product owner: 当前用户
Technical owner: 待用户指定；AI 助手负责提出方案，不承担审批
Policy owners: 用户负责范围和本机风险决策；CPA 维护者负责认证，身份待确认
Approval evidence: 用户在收到待审 spec 后回复“done”，并对 CPA 排查、依赖风险继续推进及 Git 初始化逐项明确授权。本会话该消息为接受证据；未获取独立审批时间戳，不补填。
Source of truth: 本文件为设计真源；README 为使用说明；本次按用户授权纳入本地 Git，版本证据使用该文件的 Git 历史，不在文件内自填尚未生成的 commit SHA。

## 决策摘要

保留纯 TUI 本机 demo。使用官方 HarnessAgent 包装 Pi 与 Cline 两种运行时；每次提交创建独立临时会话。切换 harness 同时选择新任务的运行时和观察面板，绝不迁移历史或取消已有任务。所有模型请求显式指定本机 CPA；离线模拟只能显式启动。

当前代码作为待核验基线，不因已有实现就认定设计或安全通过。本次审批记录更新不修改运行代码、不修复全局认证、不发布；按新增授权初始化本地 Git，并原子提交文档。CPA 排查可以继续，但交互登录或扩大权限仍需人工确认。

## 父 intent 未决问题

- 本机 demo、非生产范围：resolved，用户“GO”确认。
- CPA 排查权限：resolved，用户“allowed, just go”授权继续；认证恢复状态仍 open，最近 401 不证明完整根因或当前持续状态。
- 本机依赖风险接受：resolved，用户“allowed, just go”接受已披露风险下继续本机 demo；不表示漏洞已修复或生产风险已接受。独立技术审查人仍 open，待指定。
- Git 初始化与文档原子提交：resolved，用户明确授权；仅本地操作，不推送、不发布。

## 需求

- R-001：用户可在 Pi 与 Cline 之间选择并提交非空任务；真实模式必须通过官方 HarnessAgent，而不是只切模型或包装 CLI。
- R-002：Tab 只切观察和后续提交目标；不同任务同时执行，↑↓ 选择各自任务，输出不得串到其他任务。
- R-003：显示启动、运行、取消中、完成、已取消、失败，以及流式文本和工具活动；空面板提供提交提示。
- R-004：Ctrl+X 只取消选中任务；Ctrl+C/Ctrl+Q 取消所有任务、销毁会话并恢复终端。启动取消后迟到的会话也必须清理。
- R-005：模型请求仅走显式 CPA；地址或认证错误直接显示失败。不得静默切 provider、模型或离线模式。离线模式始终标记模拟。
- R-006：输入最多 4000 字符、会话内累计最多 20 个任务、同时最多 4 个活动任务；输出仅保留最近 80k 字符。越限拒绝，不静默排队。
- R-007：单任务含启动最多 120 秒；HTTP 请求 60 秒，模型目录查询 10 秒，sandbox 命令 10 秒。退出清理最多 8 秒，超限恢复终端后非零退出，不能报告清理成功。
- R-008：每任务内存文件系统相互独立，不挂载宿主目录，结束即销毁。仅开放 read/write/edit/bash/grep/glob/ls；不提供安装依赖、宿主扩展或交互审批。
- R-009：日志不得泄漏认证信息；历史通过、当前通过、当前失败、未验证必须分别标注。终端输出中的控制序列不得直接执行。

## 设计

### 用户流程与状态

启动时确定 live/offline，明确显示运行模式；live 配置失败不得进入伪可用状态。用户输入任务并 Enter 提交，在所选 harness 下生成任务。运行时持续接收文本和活动事件；切换或翻页不改变任务生命周期。

正常状态：starting、running、done。取消路径：starting/running、cancelling、cancelled。启动、模型、工具、超时或清理错误进入 error。最终状态应反映清理失败；退出后不宣称仍在后台执行。本 demo 不是守护进程。

窄终端/resize 应重新布局、不崩溃；输入为空和越限给明确提示。全部键盘操作可用，不依赖鼠标或颜色区别状态。非 TTY 启动应清晰退出。模型请求要求简体中文回答。

### 接口与数据

沿用现有边界：`src/runtime.ts` 建立官方适配器及 HarnessAgent 会话，并归一化为 text/activity 事件；`src/jobs.ts` 管理任务状态、取消和清理；`src/screen.ts`、`src/tui.ts` 负责展示和输入。

任务数据包含递增 ID、harness、prompt、status、text、activity、error、开始/结束时间与 AbortController。每个任务拥有独立 completion；取消信号必须覆盖创建和流消费。前端选中状态不得作为运行任务的所有权依据。

真实流程使用 createSession、stream、session.destroy；不新增 HTTP 服务、数据库、跨进程恢复或聊天历史迁移。Pi 使用显式 OpenAI auth record；Cline 使用安装版支持的 openai-compatible provider 与显式 auth/baseUrl。锁文件为具体版本依据。

Pi 模型受 demo 兼容目录约束；未知 ID 明确拒绝。默认请求 gpt-4o 不构成对 CPA 实际上游模型身份的证明。just-bash 的 realpath 通过官方命令扩展点仅访问虚拟 FS，不调用宿主 shell、不修改 node_modules。

### 安全、隐私与 UX

沿用上级项目约束：不得抢前台焦点、不得输出或提交密钥、不得部署；用户明确的 CPA-only 和 TUI-only 高于教程默认 Gateway/Web 路线。无新增 Web、HTML 或遥测服务。

配置优先级沿用 README：进程环境、项目 .env.local、~/.env；必要时读取既有 Claudex 配置。只解析值，不执行配置 shell。只允许 HTTP loopback /v1 模型入口，重定向/非 CPA 请求需核验拒绝；环境中的 Gateway 凭据不能覆盖显式配置。

工具 allow-all 仅适用于当前受限虚拟工具集合，不是宿主机任意操作授权。just-bash 不是容器或 microVM；不承诺隔离恶意 Node.js 依赖。模型看到用户提交文本和虚拟文件；不要提交敏感资料。错误脱敏、ANSI 过滤以及适配器内部网络边界需要测试和独立审查，不能仅凭 prompt 声称阻断。

### 运维与证据

保留本地 test-results 验收证据，记录模式、命令、结果和配置版本，不保存密钥。无需生产监控；失败由用户看到明确状态。认证恢复由 CPA 维护者处理，随后重新验收真实模式，历史成功不替代当前证据。

## 替代方案

- Pi/Cline + just-bash：采用；两者可 host runtime、显式 CPA，不需要网络 sandbox。代价是模拟 shell 能力与安全边界有限。
- Codex/Claude Code bridge + 网络 sandbox：本轮不采用，增加基础设施和认证范围；不能在当前界面中冒充已支持。
- 仅模型切换：拒绝，不满足不同 harness。
- 多轮/跨进程持久化：延期，不满足本轮最小范围；当前退出清理优先。

## 验收矩阵

下列命令为后续应运行的验收路径；本次 Design 未执行测试。

| ID | 场景 | 预期 | 证据路径与当前状态 |
| --- | --- | --- | --- |
| R-001/002 | 两 harness 并发、Tab 切回 | 运行不中断，结果归属正确 | smoke 与 live PTY；较早通过，最新 smoke 401，当前真实验收未通过 |
| R-003 | 文本/工具活动、失败、空面板、翻页/resize | 状态明确、无串流、终端可用 | unit/PTY；final-validation 记录通过，设计级逐条覆盖待核验 |
| R-004 | 取消指定任务、启动取消、活动任务退出 | 互不干扰、迟到会话清理、raw mode 恢复 | jobs tests 与 PTY；已有通过记录，独立审查待完成 |
| R-005 | 显式 CPA、错误认证、环境 Gateway 凭据、offline | CPA-only、错误不回退、模拟可辨识 | config tests/smoke；README 记载相关测试，内部网络边界待审查 |
| R-006/007 | 超限、超时、清理阻塞 | 明确拒绝/终止，失败非零退出 | unit/PTY；逐项覆盖缺口在 plan 中核对，不预先宣称全部通过 |
| R-008 | 两会话文件隔离、realpath、宿主路径 | 虚拟 FS 内执行，宿主不可读 | sandbox tests；历史真实写读成功，恢复 CPA 后复测 |
| R-009 | 密钥、终端控制序列、日志和状态 | 不泄漏、不执行控制字符、不混淆证据 | config-screen tests 与日志扫描；已有记录不替代独立安全审查 |

已有可复跑入口：npm run check、npm test、npm run test:pty、npm run smoke、npm run test:pty:live。最近收尾记录为类型检查、14/14 tests、离线 PTY 通过；真实 smoke 401，live PTY 未在该轮重跑。依据 ../test-results/final-validation.json 与 ../README.md；未在本阶段重测。

## Concerns 与未决决定

- 当前真实可用性缺少成功复测：CPA 维护者负责恢复，阻塞真实模式最终验收，不阻塞设计审查。
- 13 moderate + 1 high 依赖告警：来自既有 audit 记录，本轮未重新审计。用户已明确接受继续本机 demo 的风险；独立安全审查和修复仍未完成，不称生产安全通过。
- 尚无独立代码审查或批准的 plan：技术审查人待用户指定；本轮 Git 初始化不替代这些证据，仍不能声明“完整 SDLC 已完成”。
- 适配器、环境凭据和全局 fetch 限制的实际覆盖需审查：技术/安全 owner 待指定，不把网络拦截等同完整安全沙箱。
- 当前代码先于本流程存在：后续 plan 必须写明逐需求核验及差异，不能追认历史实现为按批准计划完成。

## 发布与回滚

仅本机手动启动，不部署、不创建公网入口。批准 plan 后先记录当前源文件快照，最小变更，再跑 deterministic tests、离线 PTY；CPA 恢复后跑真实验收。任一关键检查失败停止扩大使用，保留失败证据，不自动换后端。

本次按授权建立本地 Git，但文档提交不等于实现源码已被跟踪。后续实现前须确认源码基线已提交，或另有可恢复快照；不得对未跟踪源码宣称可用 git rollback。退出 TUI 是停止运行，不等于恢复源码；依赖变更回滚还需原锁文件和离线测试。全局 CPA 不属于本项目回滚范围。

## Design gate

用户已接受本 spec，并单独授权 CPA 排查、本机依赖风险下继续工作、Git 初始化与文档原子提交。下一阶段为 proposed implementation plan；计划仍需工程审批才能修改运行代码。审批不等于真实验收或独立技术审查完成，不授权生产部署、推送或绕过登录/权限确认。
