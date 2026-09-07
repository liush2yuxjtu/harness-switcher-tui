# Plan：TUI demo 基线接管与验收补齐

Parent intent: [intent.md](./intent.md)，accepted，Git 13e47b7
Parent spec: [spec.md](./spec.md)，accepted，Git 374679e
Status: proposed
Engineer: AI 助手负责实施提案；当前用户负责计划批准
Risk approver: 当前用户（已接受所披露本机依赖风险）；独立技术审查人待指定
Approval evidence: none；“go next step now”授权编写计划，不代表接受未展示的计划
Source of truth: 本文件；计划版本以 Git 历史为准

## 仓库发现

- 仓库：/Users/liushiyuwin/projects/harness-switcher-tui，main，探索时 HEAD 5e6d994。已跟踪 .gitignore、README、intent/spec；源码、脚本、测试、package 文件及 .env.example 仍未跟踪。无远端；不覆盖或删除这些基线文件。
- 项目没有独立 AGENTS.md/CLAUDE.md 或发布规则；沿用上级规则及 accepted spec。用户授权本地 Git、文档原子提交，未授权推送/部署。
- Node >=24；入口 npm start = node src/tui.ts，npm run demo 显式离线。官方依赖与版本见 package.json/package-lock.json；不计划升级依赖。
- src/config.ts：解析环境文件，限定 loopback CPA，校验模型目录，错误脱敏。
- src/network.ts：替换 global fetch，限制同 CPA origin 的 /v1/ 路径、拒绝重定向并设置超时；不覆盖任意 Node 网络客户端，不可声称完整网络沙箱。
- src/runtime.ts：真实 Pi/Cline HarnessAgent，独立会话、事件归一化与销毁；offlineFactory 单独提供模拟。
- src/jobs.ts：4 并发/20 任务/4000 字符/80k 输出限制，AbortSignal、迟到会话清理与错误状态。
- src/tui.ts：键盘、选中状态、信号、raw mode 和 8 秒退出硬超时；src/screen.ts 负责呈现；src/sandbox.ts 负责虚拟 FS 和 realpath 兼容。
- 测试：test/jobs.test.ts、test/config-screen.test.ts、test/sandbox.test.ts；scripts/smoke.ts 为真实调用，scripts/pty_test.py 支持 offline/live。
- 历史基线：final-validation.json 报告 check、14/14 tests、offline PTY 通过；最新 live smoke 401，较早 live PTY 通过。本次仅只读探索，没有运行测试或 CPA 请求。

## 已发现的计划输入

1. R-006 要求越限明确拒绝；TUI 输入分支 `(view.input + ...).slice(0, 4000)` 会静默截断粘贴，虽然 Jobs.submit 会拒绝超过 4000 的直接调用。应先建 PTY 回归，再改为保留原输入并显示越限提示；正常输入/中文退格不受影响。
2. Jobs 可把 destroy 失败记录为 error，但 TUI 正常 quit 完成后没有检查清理错误并设置非零退出码；8 秒硬超时已有非零退出。应先验证可复现路径，再只对清理失败传播退出失败，普通用户取消仍成功退出，不把所有模型错误都当作清理失败。
3. 现有 tests 未明确覆盖累计20任务、80k输出边界、4000字符边界全部场景；config checkModels 对外部 JSON 主要依赖断言，畸形响应错误可读性待测试。
4. network 测试名宣称 ambient Gateway 凭据，但所读 unit case 未实际设置环境变量；真实脚本可能另有覆盖。后续逐项核对并补明确证据，不凭测试名称认定覆盖。

## 文件范围

### Modify（只在计划批准后）

- src/tui.ts：越限提示；必要的退出清理错误传播。
- src/jobs.ts：仅在需要区分清理失败时增加最小结构化标记/结果；不重写调度器。
- src/config.ts：仅对模型目录畸形数据的实证失败补边界校验。
- test/jobs.test.ts、test/config-screen.test.ts、scripts/pty_test.py：上述回归及需求边界覆盖；不削弱现有断言。
- README.md：只同步经验证行为、最新验证结果和运行限制。
- intent/plan.md：同提交记录实际偏离与验收状态，不自行改 accepted。

### Add

- 必要时新增 test/tui-exit.test.ts：注入最小失败 fixture 验证退出，不请求真实模型，不对产品开放测试后门。
- test-results/ 中新增运行日志和验收记录（保持 ignored）；必要的无敏感信息摘要可写入 README。
- 将既有 src/、test/、scripts/、package.json、package-lock.json、tsconfig.json、.env.example 审查后纳入基线提交；这是跟踪现有文件，不冒充本轮新实现。

### Do not modify

- 全局 CPA、Claudex、Pi 配置与认证文件；只读发现可以，修复若必须写全局设置则提出准确方案和权限影响。
- node_modules、锁文件/依赖版本（除非另获有理由的变更批准）、现有凭据、其他项目。
- 已接受 intent/spec 的需求含义；任何范围变化重新过 gate。
- 不添加 Web UI、后台守护进程、远端、CI 发布、生产部署或新 harness。

## 有序工作与原子提交

1. **源码安全基线**：先检查全部未跟踪文件、锁文件 URL、示例配置与敏感信息；只对明确源码白名单执行 git add，不 git add .。本机 Git 授权覆盖基线接管，但提交前核验文件内容。单独 baseline commit，记录 SHA；工作分支从该基线开始，保留原文件可恢复。
2. **复跑现状**：check、unit、offline PTY 分别记录退出码。针对越限与清理退出建立失败测试；若现状不能复现，记录证据并不做猜测修复。
3. **R-006 最小切片**：先明确输入超限行为，修 TUI，再跑边界与中文/正常提交相邻流程。测试与修复同一原子提交。
4. **R-004/007 最小切片**：复现普通与迟到会话清理失败，区分取消与清理失败；确保正常取消退出0、清理失败退出非零、硬超时恢复终端。测试与修复同一原子提交。
5. **R-005/006/009 证据缺口**：补累计任务数、输出保留、显式 Gateway 环境、畸形模型目录测试。确有失败才改运行代码；不升级依赖或重构成熟路径。按问题拆提交。
6. **真实验收**：按既有授权检查 CPA 可达与目录，使用显式相同模型复测两种 harness。不得自动换模型来掩盖失败。401/认证挑战时保存脱敏结果，停止该真实测试分支；不反复消耗请求。必要登录由人处理，不绕过。
7. **最终核验与文档**：全套离线检查通过后，在 CPA 成功前提下执行真实 smoke/live PTY；检查无测试残留、终端恢复、日志脱敏、Git 差异。README 记录新证据与剩余风险，单独文档提交。请求独立 verifier 只报告，不修复或批准；若子代理启动受禁，保持禁止，不绕过。

单 writer 串行即可，不需要并行 worktree。每个行为修复必须带其测试，不把测试独立留给后续提交。

## 验证

以下全部为后续拟执行命令，不是本轮运行结果。

| 要求 | 命令/检查 | 健康证据 |
| --- | --- | --- |
| 类型与所有确定性要求 | npm run check；npm test | 各退出0；测试无失败/跳过来掩盖缺陷，至少保留原14项并报告新增数 |
| R-002/003/004/006/007/009 | npm run test:pty | 独立进程 Tab、并发、取消、resize、输入越限、退出和raw恢复断言；失败非零 |
| R-004/007 | 新增失败fixture测试 | 正常取消退出0；destroy/迟到destroy失败非零；8秒上限有裕量的外部看门狗 |
| R-005/009 | config/network tests | 实际注入虚假环境凭据并恢复；非CPA请求和redirect拒绝，错误无secret |
| R-001/005/008 | npm run smoke | Pi/Cline均真实流式与文件写读成功；模型/模式与状态明确，无残留会话 |
| R-002/004 | npm run test:pty:live | CPA可用后真实两种harness切换/取消/退出；不可用时标failed或not-run |
| 基线与交付 | git diff --check；git status --short；暂存白名单审查 | 无空白错误、无secret/runtime产物入库、所有预期源码已跟踪；残余改动逐项说明 |

脚本总运行需有外部有界超时，建议离线 PTY 60秒，smoke 180秒，live PTY 240秒；超时不是通过。扫描应只输出匹配文件/数量，不回显密钥。真实运行时的用户数据不得用于测试。

## 会破坏什么

- 输入限制修复可能影响粘贴、中文组合字符或退格；复测正常短输入与整段超长粘贴。
- 清理状态传播可能把用户取消错报失败，或提前恢复终端导致漏清理；同时覆盖正常完成、取消和迟到会话。
- 外部JSON校验可能误拒绝合法CPA目录；仅校验所需字段，不收紧无关扩展字段。
- 全局fetch wrapper会影响SDK其他HTTP调用；记录边界，不扩展为宿主机防火墙。

## 最高风险步骤

启动取消、迟到会话与退出的竞态。先失败fixture后修复，保留8秒硬超时，所有清理promise必须被观察。若需重构整个生命周期或更换sandbox，停止该切片并提交修订计划；不得借修复扩大作用范围。

## 未选择的替代方案

- 重新创建demo：丢失已验证行为、扩大变更。
- 自动升级/force audit fix：用户接受本机残余风险不意味着授权破坏性跨major覆盖。
- 换provider或离线fallback：违背CPA-only与失败透明要求。
- 跳过真实调用却宣称可用：不成立；保留阻塞不会阻止离线交付。

## 回滚

源码基线提交完成前不改运行代码。修改后可对单个行为commit进行明确的git revert，禁止hard reset、clean或删除未跟踪文件。基线前的源码没有Git恢复保证。无数据库迁移；临时工作区结束即丢弃，不提供数据恢复承诺。不修改全局CPA，因此不需要对全局认证做回滚。

## 偏离日志

- none。本次仅写计划；上述现状问题是待验证输入，不等于已修复。

## Plan gate

等待当前用户以工程决策人身份批准本计划；独立技术审查不能由AI自我宣称完成。批准后才跟踪源码基线、改代码并执行本计划。当前仅提交proposed计划文档，不推送、部署或进行认证写操作。
