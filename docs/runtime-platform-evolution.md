# OpenClaw-MUSA: 从插件到运行时基座的构建过程

本文档详细解析 `openclaw-musa` 插件如何从简单的 Skill + Tool 集合演变为 OpenClaw 的底层运行时基座能力。

---

## 概述

### 演进路径

```
┌─────────────────────────────────────────────────────────────────────┐
│  阶段 1: 工具集合 (Tool Collection)                                   │
│  - musa_exec, musa_docker, musa_sync                                │
│  - 手动调用，无状态                                                  │
└─────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│  阶段 2: 调度层 (Dispatcher Layer)                                    │
│  - musa_dispatch 统一入口                                            │
│  - Intent 解析、权限门控、状态追踪                                    │
└─────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│  阶段 3: 运行时基座 (Runtime Platform)                                │
│  - 静态规则注入 (AGENTS.md)                                          │
│  - 动态上下文注入 (before_prompt_build hook)                         │
│  - 状态持久化与恢复                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

### 四大核心能力

| 能力 | 机制 | 注入点 |
|------|------|--------|
| Static Rules | AGENTS.md 合并 | `~/.openclaw/workspace/AGENTS.md` |
| Dynamic Context | before_prompt_build hook | 每次对话构建时 |
| Dispatcher | musa_dispatch tool | 手动/自动调用 |
| State Manager | JSON 持久化 | `~/.openclaw/workspace/autodeploy/` |

---

## 1. OpenClaw Workspace 机制解析

### 1.1 Workspace 目录结构

OpenClaw 的 workspace 是 Agent 的"认知家园"，每次对话都会读取其中的文件来构建 Agent 的上下文：

```
~/.openclaw/workspace/
├── AGENTS.md           # 核心规则文件（静态注入点）
├── BOOTSTRAP.md        # 首次启动引导（一次性）
├── SOUL.md             # Agent 身份定义
├── USER.md             # 用户画像
├── TOOLS.md            # 工具使用规范
├── HEARTBEAT.md        # 心跳机制说明
├── memory/             # 记忆存储
│   ├── 2024-03-25.md   # 日期日志
│   └── MEMORY.md       # 长期记忆
├── .openclaw/          # OpenClaw 内部状态
│   └── workspace-state.json
└── autodeploy/         # MUSA 插件状态（插件创建）
    ├── hosts.json
    ├── jobs.json
    ├── operations.json
    └── deployment_state.json
```

### 1.2 AGENTS.md 加载机制

OpenClaw 在每次对话开始时会自动读取 `AGENTS.md` 文件，将其内容作为系统提示词的一部分注入到 LLM 的上下文中：

```
用户发起对话
    ↓
OpenClaw Gateway 接收请求
    ↓
构建 Prompt
    ├─ 读取 ~/.openclaw/workspace/AGENTS.md
    ├─ 读取 SOUL.md, USER.md, TOOLS.md
    └─ 触发 before_prompt_build hook
    ↓
发送给 LLM
```

**关键点**：
- `AGENTS.md` 是 OpenClaw 约定的文件名，会被自动加载
- 文件内容会作为 System Prompt 的一部分，影响 Agent 的行为
- 这是"静态规则注入"的核心机制

---

## 2. 静态规则注入详解

### 2.1 注入原理

静态规则通过修改 `AGENTS.md` 文件实现注入。OpenClaw-MUSA 插件在 `register()` 时自动将 `AGENTS.autodeploy.md` 的内容合并到 workspace 的 `AGENTS.md` 中：

```
插件目录                              OpenClaw Workspace
┌─────────────────────┐              ┌─────────────────────┐
│ AGENTS.autodeploy.md │ ──merge──→  │ AGENTS.md            │
│                     │              │ ┌─────────────────┐ │
│ ## MUSA Platform    │              │ │ OpenClaw 默认规则 │ │
│ Rules               │              │ ├─────────────────┤ │
│ ...                 │              │ │ <!-- AUTODEPLOY:BEGIN --> │
└─────────────────────┘              │ │ ## MUSA Platform Rules │
                                     │ │ ...               │ │
                                     │ │ <!-- AUTODEPLOY:END --> │
                                     │ └─────────────────────┘ │
                                     └─────────────────────┘
```

### 2.2 注入流程

```javascript
// index.js - register() 函数中

// 1. 确定 workspace 路径
const openclawWorkspace = process.env.OPENCLAW_WORKSPACE
  || path.join(require("os").homedir(), ".openclaw", "workspace");

// 2. 自动合并 AGENTS.autodeploy.md
const result = ensureAgentsMerged(openclawWorkspace, pluginDir);

// 3. 验证能力状态
capabilities.staticRules = checkStaticRules(openclawWorkspace);
```

### 2.3 合并算法

`ensureAgentsMerged()` 函数实现了幂等的合并逻辑：

```
┌─────────────────────────────────────────────────────────────┐
│                    ensureAgentsMerged()                      │
├─────────────────────────────────────────────────────────────┤
│  1. 检查目标文件是否存在                                      │
│     - 不存在 → 创建新文件，写入 block                         │
│                                                              │
│  2. 检查 block 是否存在                                       │
│     - 不存在 → 追加到文件末尾                                 │
│     - 存在 → 比较 content hash                                │
│         - 相同 → up_to_date (跳过)                           │
│         - 不同 → updated (替换 block)                        │
│                                                              │
│  3. 使用原子写入 (.tmp + rename)                              │
│  4. 并发锁保护 (.agents.merge.lock)                          │
└─────────────────────────────────────────────────────────────┘
```

### 2.4 Block 标记

使用成对的 HTML 注释作为 block 标记，确保可以精确识别和替换：

```markdown
<!-- AUTODEPLOY:BEGIN -->
## MUSA Platform Rules

### Platform Priority
For tasks involving GPU, MUSA, driver, MCCL, model deployment...

### Intent Routing
| User Intent | Dispatch Call |
|-------------|---------------|
| 部署 MUSA 环境 | `musa_dispatch(intent="deploy_env")` |
...

<!-- AUTODEPLOY:END -->
```

**设计优势**：
- 不干扰原有 AGENTS.md 内容
- 支持幂等更新（内容变化时才写入）
- 可精确识别插件注入的部分

---

## 3. 动态上下文注入详解

### 3.1 Hook 机制

OpenClaw 提供了 `before_prompt_build` hook，允许插件在构建 Prompt 时注入动态内容：

```javascript
// src/adapter/hooks.ts

api.on("before_prompt_build", async (event) => {
  const dynamicContext = await buildDynamicContext(stateManager)
  event.prependSystemContext(dynamicContext)
}, { priority: 100 })
```

### 3.2 动态上下文内容

`buildDynamicContext()` 函数生成运行时状态的快照：

```markdown
## MUSA Runtime Context

- **Mode**: local
- **Default Host**: 192.168.1.100
- **Active Job**: op_xxx (50%) - running
- **Last Deployment**: completed

## Online Hosts
- ✓ 192.168.1.100 (S5000)
- ✓ 192.168.1.101 (S4000) (default)

## Quick Actions
- Check GPU: `musa_dispatch(intent="gpu_status")`
- Resume Deployment: `musa_dispatch(intent="deploy_env", action="resume")`
- Validate: `musa_dispatch(intent="validate")`
```

### 3.3 注入流程

```
用户发起对话
    ↓
OpenClaw 构建 Prompt
    ↓
触发 before_prompt_build hook
    ↓
┌─────────────────────────────────┐
│ buildDynamicContext()          │
│                                 │
│ 1. loadSnapshot()              │
│    - 读取 hosts.json           │
│    - 读取 jobs.json            │
│    - 读取 deployment_state.json │
│                                 │
│ 2. 过滤在线 hosts               │
│    - 按 relevance 排序          │
│    - 限制显示数量               │
│                                 │
│ 3. 生成 Quick Actions          │
└─────────────────────────────────┘
    ↓
event.prependSystemContext()
    ↓
动态上下文被注入到 System Prompt
```

### 3.4 与静态规则的协作

| 层面 | 静态规则 | 动态上下文 |
|------|----------|------------|
| 内容 | 行为规范、路由表 | 运行时状态快照 |
| 更新频率 | 插件版本更新时 | 每次对话 |
| 数据来源 | `AGENTS.autodeploy.md` | `state/*.json` |
| 注入位置 | `AGENTS.md` (文件) | `prependSystemContext()` (内存) |

**协作效果**：
- 静态规则定义 "应该怎么做"（调用哪个 tool）
- 动态上下文提供 "当前状态"（哪个 host 可用、任务进度）

---

## 4. 运行时基座构建全流程

### 4.1 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OpenClaw Gateway                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │
│  │   Agent     │    │   Plugin    │    │    LLM      │              │
│  │  Runtime    │───→│  Registry   │───→│   Client    │              │
│  └─────────────┘    └─────────────┘    └─────────────┘              │
│         │                  │                                        │
│         ↓                  ↓                                        │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    openclaw-musa Plugin                       │   │
│  │                                                              │   │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  │   │
│  │  │ Static Rules   │  │ Dynamic Ctx    │  │   Dispatcher   │  │   │
│  │  │ (AGENTS.md)    │  │ (Hook)         │  │ (musa_dispatch)│  │   │
│  │  └───────┬────────┘  └───────┬────────┘  └───────┬────────┘  │   │
│  │          │                   │                   │           │   │
│  │          └───────────────────┴───────────────────┘           │   │
│  │                              │                               │   │
│  │                              ↓                               │   │
│  │                    ┌────────────────┐                        │   │
│  │                    │ State Manager  │                        │   │
│  │                    │ (JSON 持久化)   │                        │   │
│  │                    └────────────────┘                        │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                      │
└──────────────────────────────│──────────────────────────────────────┘
                               ↓
               ┌───────────────────────────────┐
               │   ~/.openclaw/workspace/      │
               │   ├── AGENTS.md               │
               │   └── autodeploy/             │
               │       ├── hosts.json          │
               │       ├── jobs.json           │
               │       ├── operations.json     │
               │       └── deployment_state.json│
               └───────────────────────────────┘
```

### 4.2 初始化流程

```
OpenClaw Gateway 启动
    │
    ├─→ 扫描已安装插件
    │       │
    │       └─→ 加载 openclaw-musa
    │               │
    │               ├─→ plugin.register(api)
    │               │       │
    │               │       ├─→ [1] Auto-merge AGENTS.autodeploy.md
    │               │       │       ensureAgentsMerged(workspace, pluginDir)
    │               │       │       └─→ 写入 ~/.openclaw/workspace/AGENTS.md
    │               │       │
    │               │       ├─→ [2] Initialize StateManager
    │               │       │       new StateManager(workspacePath)
    │               │       │       └─→ 初始化 JSON 文件
    │               │       │
    │               │       ├─→ [3] Register Hooks
    │               │       │       api.on("before_prompt_build", ...)
    │               │       │       api.on("session_end", ...)
    │               │       │
    │               │       ├─→ [4] Register Dispatcher Tool
    │               │       │       api.registerTool("musa_dispatch", ...)
    │               │       │
    │               │       └─→ [5] Register Execution Tools
    │               │               musa_exec, musa_docker, musa_sync
    │               │
    │               └─→ Plugin loaded ✓
    │
    └─→ Gateway ready
```

### 4.3 对话时流程

```
用户: "部署 MUSA 环境到 192.168.1.100"
    │
    ↓
OpenClaw Gateway
    │
    ├─→ 构建 Prompt
    │       │
    │       ├─→ 读取 AGENTS.md (包含 MUSA Platform Rules)
    │       │
    │       ├─→ 触发 before_prompt_build hook
    │       │       │
    │       │       └─→ buildDynamicContext()
    │       │               - 读取 hosts.json: 192.168.1.100 online
    │       │               - 读取 jobs.json: no active job
    │       │               - 生成 Quick Actions
    │       │               └─→ prependSystemContext()
    │       │
    │       └─→ 发送给 LLM
    │
    ├─→ LLM 识别 Intent
    │       │
    │       └─→ 根据 AGENTS.md 中的路由表:
    │           "部署 MUSA 环境" → musa_dispatch(intent="deploy_env")
    │
    ├─→ 调用 musa_dispatch tool
    │       │
    │       └─→ dispatch() 函数执行
    │               ├─→ Intent 解析
    │               ├─→ Pre-flight check
    │               ├─→ Permission check
    │               ├─→ Atomic conflict check (startOperationIfNoConflict)
    │               ├─→ Route to skill
    │               └─→ 返回 guidance
    │
    └─→ 返回响应给用户
```

### 4.4 状态持久化流程

```
操作执行
    │
    ├─→ stateManager.startOperation(intent, params)
    │       └─→ 写入 operations.json
    │
    ├─→ stateManager.startJob(opId, steps, hostId)
    │       └─→ 写入 jobs.json
    │
    ├─→ stateManager.createCheckpoint(opId, step, rollback)
    │       └─→ 更新 operations.json
    │
    └─→ 对话结束时 (session_end hook)
            │
            └─→ stateManager.persistAll()
                    └─→ 确保所有状态已落盘
```

---

## 5. 关键设计决策

### 5.1 为什么选择 AGENTS.md 作为静态注入点？

| 方案 | 优点 | 缺点 |
|------|------|------|
| 创建新文件 (MUSA_RULES.md) | 干净分离 | OpenClaw 不会自动加载 |
| 修改 SOUL.md | 会被加载 | 干扰 Agent 身份定义 |
| **修改 AGENTS.md** | **OpenClaw 自动加载** | 需要幂等合并逻辑 |

选择 AGENTS.md 的原因：
1. OpenClaw 约定自动加载此文件
2. 文件内容会作为 System Prompt 的一部分
3. 不需要修改 OpenClaw 核心

### 5.2 为什么需要动态上下文？

静态规则的问题：
- 无法感知运行时状态（哪个 host 在线）
- 无法反映任务进度
- 用户每次需要手动查看状态

动态上下文的价值：
```
静态规则: "检查 GPU 用 musa_dispatch(intent='gpu_status')"
动态上下文: "当前有 3 个 host 在线: 192.168.1.100 (default), ..."
```

结合后，Agent 可以：
1. 知道应该调用什么 tool（静态）
2. 知道当前环境状态（动态）

### 5.3 幂等合并的必要性

为什么不直接覆盖？

```
场景 1: 用户在 AGENTS.md 中添加了自定义规则
        覆盖 → 用户规则丢失

场景 2: 多个插件都向 AGENTS.md 注入规则
        覆盖 → 其他插件的规则丢失

场景 3: 插件升级，规则内容变化
        不更新 → 使用旧规则
```

幂等合并策略：
- 使用 block 标记识别插件注入的部分
- 只更新自己注入的内容
- 保留用户和其他插件的内容

### 5.4 并发锁的必要性

```
场景: 两个 OpenClaw Gateway 实例同时启动

实例 A: 读取 AGENTS.md (无 block)
实例 B: 读取 AGENTS.md (无 block)
实例 A: 写入 block A
实例 B: 写入 block B  ← 覆盖了 A 的写入
```

解决方案：
- 文件锁 + 陈旧锁检测
- 原子写入 (.tmp + rename)

---

## 6. 能力验证清单

### 6.1 静态规则验证

```bash
# 检查 AGENTS.md 中是否包含 MUSA 规则
grep "AUTODEPLOY:BEGIN" ~/.openclaw/workspace/AGENTS.md

# 预期输出:
# <!-- AUTODEPLOY:BEGIN -->
# ## MUSA Platform Rules
```

### 6.2 动态上下文验证

查看 OpenClaw 日志：
```
[musa] Dynamic context injected
```

### 6.3 完整能力检查

```
=== Platform Capabilities ===
  Static Rules (AGENTS.md): ✓    ← 静态规则已注入
  Dynamic Context (hook): ✓       ← Hook 已注册
  Dispatcher (manual): ✓          ← Dispatcher 可用
  State Manager: ✓                ← 状态管理可用
=============================
```

---

## 7. 文件清单

### 7.1 插件源文件

| 文件 | 用途 |
|------|------|
| `index.js` | 插件入口，注册所有能力 |
| `AGENTS.autodeploy.md` | 静态规则源文件 |
| `src/utils/agents-merge.js` | AGENTS.md 合并逻辑 |
| `src/adapter/hooks.ts` | Hook 注册（动态注入） |
| `src/adapter/context-builder.ts` | 动态上下文构建 |
| `src/dispatcher/index.ts` | Dispatcher 主逻辑 |
| `src/core/state-manager.ts` | 状态持久化 |

### 7.2 运行时生成文件

| 文件 | 用途 |
|------|------|
| `~/.openclaw/workspace/AGENTS.md` | 合并后的规则文件 |
| `~/.openclaw/workspace/autodeploy/hosts.json` | Host 状态 |
| `~/.openclaw/workspace/autodeploy/jobs.json` | Job 进度 |
| `~/.openclaw/workspace/autodeploy/operations.json` | Operation 记录 |
| `~/.openclaw/workspace/autodeploy/deployment_state.json` | 部署状态 |

---

## 8. 总结

OpenClaw-MUSA 从普通插件演变为运行时基座的关键步骤：

1. **识别注入点** - OpenClaw 的 `AGENTS.md` 加载机制
2. **实现幂等合并** - 不干扰用户和其他插件
3. **注册 Hook** - 利用 `before_prompt_build` 注入动态上下文
4. **构建状态层** - 持久化运行时状态，支持恢复
5. **统一调度入口** - `musa_dispatch` 作为意图路由中心

通过这五层构建，插件不再是"被动调用的工具集"，而是"主动注入认知的运行时基座"。