# autodeploy 重构计划

> 5 项改进，按依赖顺序排列，可逐步合入。

---

## 改进 1：废弃 agent-tools/

**现状**：`agent-tools/` 是一套独立的 MCP Server，提供 `remote-exec`、`remote-docker`、`remote-sync` 三个工具，与 `src/tools/` 下的 `musa_exec`、`musa_docker`、`musa_sync` 功能完全重复。两套各有独立的 package.json、tsconfig、dist、node_modules。

**操作**：

1. 删除 `agent-tools/` 整个目录
2. 从以下文件中移除所有 `agent-tools` 引用：
   - `CLAUDE.md`（删除 MCP Server 相关段落、Tool Routing 对照表中的 MCP 列、Agent Tools build/test 命令）
   - `package.json`（如果有 workspace 引用）
   - `.gitignore`
3. `CLAUDE.md` 中 "Remote Execution Architecture" 部分简化为只保留 OpenClaw 工具链

**文件影响**：
```
删除:
  agent-tools/          # 整个目录（~30 文件，含 node_modules）

修改:
  CLAUDE.md             # 删除 MCP 相关段落
```

**验证**：`grep -r "agent-tools\|remote-exec\|remote-docker\|remote-sync\|mcp" --include="*.md" --include="*.ts" --include="*.js" .` 应无结果（排除 git history）。

---

## 改进 2：统一为 TypeScript

**现状**：
- `src/tools/*.js`（4 文件，585 行）— 纯 JS，CommonJS exports
- `src/core/executor.js`、`ssh-client.js`、`local-exec.js`、`docker-builder.js`、`utils.js`（5 文件，888 行）— 纯 JS
- `src/utils/*.js`（2 文件）— 纯 JS
- `src/dispatcher/*.ts`、`src/document/*.ts`、`src/adapter/*.ts`、`src/shared/*.ts`、`src/core/state-manager.ts` — TS

入口 `index.js` 用 `try { require("./dist/...") }` 可选加载 TS 编译产物，未 build 则静默降级。

**操作**：

### Step 1：JS → TS 转换

逐个文件转换，每个文件单独一个 commit：

| 原文件 | 行数 | 复杂度 | 说明 |
|--------|------|--------|------|
| `src/core/utils.js` | 174 | 低 | 纯工具函数，加类型签名即可 |
| `src/core/local-exec.js` | 104 | 低 | `child_process.exec` 封装 |
| `src/core/docker-builder.js` | 84 | 低 | Docker 命令拼接 |
| `src/core/ssh-client.js` | 257 | 中 | ssh2 封装，需要 `@types/ssh2` |
| `src/core/executor.js` | 269 | 中 | 模式管理 + 命令路由，依赖上面几个 |
| `src/tools/musa-exec.js` | 334 | 中 | 工具注册，依赖 executor |
| `src/tools/musa-docker.js` | 125 | 低 | |
| `src/tools/musa-sync.js` | 97 | 低 | |
| `src/tools/index.js` | 29 | 低 | re-export |
| `src/utils/inject-manager.js` | ~200 | 中 | 文件注入逻辑 |
| `src/utils/agents-merge.js` | ~100 | 低 | |

### Step 2：入口 index.js → index.ts

- 将 `index.js` 转为 `index.ts`
- 删除 `try { require("./dist/...") }` 降级逻辑 — 所有模块统一编译
- `package.json` 的 `"main"` 改为 `"dist/index.js"`
- `openclaw.plugin.json` 指向编译后的入口

### Step 3：tsconfig 调整

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",      // OpenClaw 插件用 CommonJS
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

### Step 4：依赖更新

```bash
npm install --save-dev @types/ssh2 @types/node
```

**验证**：
- `npm run build` 无错误
- `find src -name "*.js" | wc -l` 应为 0
- 重新安装插件后 `openclaw plugins info openclaw-musa` 正常
- 所有 5 个 musa_* 工具可正常调用

---

## 改进 3：简化 Dispatcher（intent → route 简单映射）

**现状**：6 层管道，`src/dispatcher/` 共 3572 行：

```
intent-parser.ts (579行) → router.ts (589行) → pre-check.ts (175行)
→ permission-gate.ts (169行) → orchestrator.ts (451行) → error-normalizer.ts (185行)
→ index.ts (1089行，主逻辑 + document execution)
```

问题：
- `intent-parser.ts` 的 579 行评分系统会**覆盖 AI 已选定的 intent**，这在 OpenClaw 框架下是多余的（OpenClaw 自己做 intent 识别）
- `pre-check.ts` 目前只检查 "mode is set"，175 行代码做了一件简单的事
- `permission-gate.ts` 只做 risk level 分类 + force 检查
- `router.ts` 有大量重复的 `routePrepareX` 函数，每个函数逻辑相同

**目标**：合并为 **2 个文件**，总计 ~400 行：

### 新结构

```
src/dispatcher/
├── index.ts          # dispatch() + registerDispatcherTool() (~250行)
└── route-table.ts    # 纯数据映射表 + route() 函数 (~150行)
```

### `route-table.ts` — 纯映射

```typescript
import { getSkillMeta, getSkillPath, isMetaSkill, getOrchestration } from "./skill-registry"

// Intent → handler 的静态映射
const INTENT_ROUTES: Record<string, IntentRoute> = {
  // Skill-based intents (从 skills/index.yml 读取)
  deploy_env:       { type: "skill", skillId: "deploy_musa_base_env" },
  update_driver:    { type: "skill", skillId: "update_musa_driver" },
  prepare_model:    { type: "skill", skillId: "prepare_model_artifacts" },
  prepare_dataset:  { type: "skill", skillId: "prepare_dataset_artifacts" },
  prepare_package:  { type: "skill", skillId: "prepare_musa_package" },
  prepare_repo:     { type: "skill", skillId: "prepare_dependency_repo" },
  manage_images:    { type: "skill", skillId: "manage_container_images" },

  // Tool-based intents (直接映射到工具调用)
  gpu_status:       { type: "tool", tool: "musa_exec", defaultParams: { command: "mthreads-gmi" } },
  sync:             { type: "tool", tool: "musa_sync" },
  run_container:    { type: "tool", tool: "musa_docker" },

  // Direct intents
  validate:         { type: "direct", instructions: "Run: mthreads-gmi → container toolkit check → torch.musa check" },

  // Document execution
  execute_document: { type: "document" },
}

export function route(intent: string, context: Record<string, unknown>): RouteResult {
  const entry = INTENT_ROUTES[intent]
  if (!entry) return { type: "error", message: `Unknown intent: ${intent}` }

  if (entry.type === "skill") {
    const meta = getSkillMeta(entry.skillId)
    const skillPath = getSkillPath(entry.skillId)
    return {
      type: isMetaSkill(entry.skillId) ? "orchestration" : "skill",
      skillId: entry.skillId,
      description: meta?.description,
      readPath: skillPath,
      params: context,
      orchestration: isMetaSkill(entry.skillId) ? getOrchestration(entry.skillId) : undefined,
    }
  }

  if (entry.type === "tool") {
    return { type: "tool", target: entry.tool, params: { ...entry.defaultParams, ...context } }
  }

  // ... document, direct
}
```

### `index.ts` — 精简后的 dispatch()

```typescript
export async function dispatch(params: DispatchParams, stateManager: StateManager): Promise<DispatchResult> {
  const { intent, context = {}, action = "start", force = false } = params

  // 1. Risk check (inline, 不需要单独文件)
  const risk = INTENT_RISK[intent] ?? "safe_write"
  if (risk === "destructive" && !force) {
    return { success: false, error: "destructive_needs_force", guidance: "Pass force=true to confirm." }
  }

  // 2. Mode check (inline)
  // 只在需要远程执行的 intent 上检查
  if (REMOTE_REQUIRED.has(intent)) {
    const mode = await stateManager.getExecutionMode()
    if (mode !== "remote") {
      return { success: false, error: "remote_mode_required" }
    }
  }

  // 3. Route
  const routeResult = route(intent, context)

  // 4. State tracking (仅 destructive 操作)
  let operationId: string | null = null
  if (risk === "destructive") {
    const result = await stateManager.startOperationIfNoConflict(intent, context)
    if (!result.started) return { success: false, error: "operation_conflict" }
    operationId = result.operationId
  }

  return { success: true, route: routeResult, operationId }
}
```

### 删除的文件

```
删除:
  src/dispatcher/intent-parser.ts    # 579行 → 内联到 route-table 的 triggers
  src/dispatcher/router.ts           # 589行 → route-table.ts
  src/dispatcher/pre-check.ts        # 175行 → 内联到 dispatch()
  src/dispatcher/permission-gate.ts  # 169行 → 内联到 dispatch()
  src/dispatcher/error-normalizer.ts # 185行 → 简单 Error 类型即可
  src/dispatcher/orchestrator.ts     # 451行 → 保留 getOrchestration()，其余删除
```

### 保留

- `skill-registry.ts`（335 行）— 读取 `skills/index.yml`，这是必要的
- trace/logger 相关的 `src/shared/` — 保留

**净减少**：~3000 行 → ~600 行

---

## 改进 4：简化文档驱动执行

**现状**：`src/document/` 共 7 个文件 2275 行，实现了完整的文档解析管道：

```
loader.ts (144) → parser.ts (471) → types.ts (354) → plan-generator.ts (245)
→ safety-validator.ts (223) → plan-review.ts (238) → executor.ts (469) → index.ts (131)
```

问题：
- parser 只做了基础的 markdown heading + code block 提取
- plan-generator 把 code block 分到 phases 里，但 LLM 本身就能做这件事
- safety-validator 检查危险命令（`rm -rf /`），但 musa_exec 已有 sudo 管控
- 最终还是要 LLM 逐步执行，整个管道是在帮 LLM "预消化"文档，实际收益不大

**目标**：删除整个 `src/document/`，用 ~50 行替代：

### 新方案

在 `route-table.ts` 中处理 `execute_document`：

```typescript
// route-table.ts 中
execute_document: {
  type: "document",
  handler: async (context) => {
    let content: string

    if (context.path) {
      content = await fs.promises.readFile(context.path as string, "utf-8")
    } else if (context.content) {
      content = context.content as string
    } else {
      return { error: "Provide path or content" }
    }

    return {
      type: "direct",
      guidance: `## Document Loaded

**Source**: ${context.path || "pasted content"}
**Length**: ${content.length} chars

---

${content}

---

**Instructions**: Read the document above. Execute each step sequentially using musa_exec/musa_docker. Validate results at each checkpoint.`
    }
  }
}
```

本质：**加载文档 → 注入到 guidance → LLM 自行解析和执行**。

### 删除

```
删除:
  src/document/          # 整个目录（7 文件，2275 行）
```

**净减少**：2275 行 → ~50 行

---

## 改进 5：工具层自动上报到 StateManager

**现状**：`musa_exec`、`musa_docker`、`musa_sync` 执行后只返回 stdout/stderr/exitCode，不上报任何状态。StateManager 有完整的 operation/job 追踪能力，但只有 dispatcher 层在用。LLM 忘记更新状态时，state 与实际就脱节了。

**目标**：每次 musa_* 工具调用，自动向 StateManager 记录执行日志（job span）。

### 实现

在工具 execute 函数中加入自动上报：

```typescript
// src/tools/musa-exec.ts (改造后)

async execute(_toolCallId: string, params: ExecParams): Promise<string> {
  const startTime = Date.now()

  try {
    const result = await execute(params.command, options)
    const duration = Date.now() - startTime

    // 自动上报到 StateManager
    if (stateManager) {
      await stateManager.recordToolExecution({
        tool: "musa_exec",
        command: params.command,
        exitCode: result.exitCode,
        success: result.exitCode === 0,
        durationMs: duration,
        // 不记录完整 stdout（可能很大），只记录前 500 字符
        stdoutPreview: result.stdout?.substring(0, 500),
        stderrPreview: result.stderr?.substring(0, 500),
        timestamp: new Date().toISOString(),
      })
    }

    return formatToolResult({ success: result.exitCode === 0, ... })
  } catch (err) {
    if (stateManager) {
      await stateManager.recordToolExecution({
        tool: "musa_exec",
        command: params.command,
        exitCode: -1,
        success: false,
        error: err.message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      })
    }
    return formatToolError(err, ...)
  }
}
```

### StateManager 扩展

在 `state-manager.ts` 中添加：

```typescript
interface ToolExecution {
  tool: string
  command: string
  exitCode: number
  success: boolean
  durationMs: number
  stdoutPreview?: string
  stderrPreview?: string
  error?: string
  timestamp: string
}

// 存储到 autodeploy/tool-executions.json（ring buffer，最多保留 200 条）
async recordToolExecution(exec: ToolExecution): Promise<void> {
  const executions = await this.loadState("tool-executions.json") as ToolExecution[]
  executions.push(exec)
  // Ring buffer: keep last 200
  if (executions.length > 200) {
    executions.splice(0, executions.length - 200)
  }
  await this.saveState("tool-executions.json", executions)
}
```

### 与 context-builder 联动

`context-builder.ts` 已经在 `before_prompt_build` 中注入动态上下文。扩展它来包含最近的工具执行摘要：

```typescript
// context-builder.ts 中
const recentExecs = await stateManager.getRecentToolExecutions(5)
if (recentExecs.length > 0) {
  lines.push("## Recent Tool Executions")
  for (const exec of recentExecs) {
    const icon = exec.success ? "✓" : "✗"
    lines.push(`- ${icon} ${exec.tool}: \`${exec.command.substring(0, 80)}\` (${exec.durationMs}ms)`)
  }
}
```

**好处**：
- LLM 每轮都能看到最近 5 次工具执行的结果摘要
- 即使 LLM 忘记汇报，状态也自动记录
- 调试时可以查看 `autodeploy/tool-executions.json` 获取完整执行历史

### 文件影响

```
修改:
  src/tools/musa-exec.ts       # 加入 recordToolExecution 调用
  src/tools/musa-docker.ts     # 同上
  src/tools/musa-sync.ts       # 同上
  src/core/state-manager.ts    # 新增 recordToolExecution / getRecentToolExecutions
  src/adapter/context-builder.ts  # 注入最近执行摘要
```

---

## 执行顺序与依赖

```
改进 1 (废弃 agent-tools)     ← 独立，可先做
     ↓
改进 2 (统一 TS)              ← 依赖改进 1（少转换一堆文件）
     ↓
改进 3 (简化 Dispatcher)      ← 依赖改进 2（在 TS 基础上重构）
改进 4 (简化文档执行)          ← 依赖改进 3（document route 在 dispatcher 中）
     ↓
改进 5 (工具自动上报)          ← 依赖改进 2（工具已经是 TS）
```

**估算工作量**：

| 改进 | 工作量 | 代码变化 |
|------|--------|---------|
| 1. 废弃 agent-tools | 0.5 天 | -30 文件 |
| 2. 统一 TS | 2-3 天 | ~1500 行 JS→TS |
| 3. 简化 Dispatcher | 1-2 天 | -3000 行，+600 行 |
| 4. 简化文档执行 | 0.5 天 | -2275 行，+50 行 |
| 5. 工具自动上报 | 1 天 | +150 行 |
| **合计** | **5-7 天** | **净减 ~4600 行** |

---

## 重构后的目录结构

```
autodeploy/
├── src/
│   ├── tools/                    # TS: musa_exec, musa_docker, musa_sync, set_mode, get_mode
│   ├── dispatcher/
│   │   ├── index.ts              # dispatch() + registerDispatcherTool (~250行)
│   │   ├── route-table.ts        # intent → handler 映射 (~150行)
│   │   └── skill-registry.ts     # skills/index.yml 读取 (保留)
│   ├── core/
│   │   ├── state-manager.ts      # 状态管理 (扩展 tool execution 记录)
│   │   ├── executor.ts           # 命令执行路由（local/remote）
│   │   ├── ssh-client.ts         # SSH 连接
│   │   ├── local-exec.ts         # 本地执行
│   │   ├── docker-builder.ts     # Docker 命令构建
│   │   └── utils.ts              # 工具函数
│   ├── adapter/
│   │   ├── hooks.ts              # OpenClaw hooks (保留)
│   │   └── context-builder.ts    # 动态上下文 (扩展)
│   ├── shared/
│   │   ├── trace.ts              # 追踪 (保留)
│   │   ├── logger.ts             # 日志 (保留)
│   │   └── lark-ticket.ts        # 飞书票据 (保留)
│   └── utils/
│       ├── inject-manager.ts     # 文件注入
│       └── agents-merge.ts       # AGENTS.md 合并
├── index.ts                      # 插件入口 (统一 TS)
├── skills/                       # 保持不变
├── inject/                       # 保持不变
├── references/                   # 保持不变
└── docs/                         # 保持不变
```

**总计 src/ 代码量**：~3500 行 TS（从当前 ~8500 行 JS+TS 精简 ~60%）
