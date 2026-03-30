# 多机编排第一阶段实施计划

## Context

用户已提供详细设计稿，需要实施多机编排层的第一阶段功能。

**设计决策：**
- 多机编排在 dispatcher 之上构建，不修改 dispatcher 内部
- 第一阶段边界：inventory、role、fan-out，不做 DAG 调度、自动回滚

**已采纳用户建议：**
1. `selectHosts()` 默认过滤不可用 host（新增 `isHostAvailable()` 和 `no_available_hosts` 错误）
2. `HostInventoryManager` 使用 `path.join` 和 StateManager state dir 概念
3. `FanOutExecutor` 空目标保护（返回 `empty_target_hosts` 错误）
4. `PerHostResult.hostRole` 来源明确注释（当前阶段来自 HostAssignment.role）

---

## 实施步骤

### Step 1: 创建类型定义

**文件：** `src/orchestration/types.ts`

定义所有类型：
- `HostAssignment` — 带 role、tags、enabled 的调度单元
- `HostInventory` — hosts + assignments
- `HostSelector` — hosts/role/tags 三种入口
- `FanOutTask` — 执行单元，预留 jobContext
- `PerHostResult` — 单机结果，含 hostRole、metadata 预留
- `FanOutResult` — 结构化输出
- `OrchestrationFailureReason` — 含 `no_available_hosts`、`empty_target_hosts`
- `HostActionExecutor` interface — 底层抽象

**重要：** `HostState` 从 `state-manager.ts` 导入，需确认类型已导出。

### Step 2: 实现 Host Inventory Manager

**文件：** `src/orchestration/host-inventory.ts`

关键点：
- 构造函数接收 StateManager
- **复用 StateManager 的 state dir：** StateManager 暴露 `getStateDir()` getter，HostInventoryManager 直接使用，不自己推导目录
- **复用 StateManager 的原子写能力：** 持久化时使用 StateManager 提供的 atomic write helper，保持与现有 state 文件一致的可靠性
- `loadInventory()` 从 StateManager.loadSnapshot() 获取 hosts，从 inventory 文件获取 assignments
- `assignHost()` 添加/更新 assignment 并持久化
- `getHostsByRole()` / `getHostsByTags()` 查询方法

**StateManager 扩展（最小改动）：**
```typescript
// state-manager.ts 新增
getStateDir(): string {
  return this.stateDir
}

async atomicWriteFile(filename: string, data: unknown): Promise<void> {
  // 复用现有 saveState 的原子写逻辑
}
```

### Step 3: 实现 Host Selector

**文件：** `src/orchestration/selection.ts`

关键点：
- **导入：** 需导入 `HostState`、`HostAssignment`、`HostInventory`、`OrchestrationFailure` 类型
- `isHostAvailable(host, assignment)` — 检查 `enabled !== false && status !== "offline"`
- `selectHosts(selector, inventory)` — 返回 `{ hosts }` 或 `{ error: OrchestrationFailure }`
- 优先级：hosts > role > tags
- 每种入口匹配后都要过滤不可用 host
- 匹配到 host 但全部不可用时返回 `no_available_hosts` 错误

### Step 4: 实现 Host Action Executor

**文件：** `src/orchestration/host-action-executor.ts`

关键点：
- `DispatchFunction` 类型定义（匹配 dispatcher callback signature）
- `DefaultHostActionExecutor` 实现 `HostActionExecutor` interface
- `execute()` 方法调用 dispatcher，返回 `PerHostResult`

**一期边界明确：**
- **正式实现：** `actionType: "skill"` — 调用 dispatcher 执行 atomic skill
- **仅占位：** `dispatch_phase` 和 `validate` — 返回 `not_implemented` 占位错误，**不纳入一期验收**

### Step 5: 实现 Fan-out Executor

**文件：** `src/orchestration/fanout-executor.ts`

关键点：
- `execute()` 开头检查 `targetHosts.length === 0`，返回 `empty_target_hosts` 错误
- `batchHosts(hosts, concurrency)` 分批方法
- 并行执行每批，聚合结果到 `perHost[]`
- `failurePolicy` 处理：best_effort 继续，stop_on_first_failure 标记剩余为 skipped
- 直接产出 `FanOutResult`（不单独抽 result-aggregator）

**hostRole 注入责任：**
- FanOutExecutor 在聚合 PerHostResult 时，根据 `hostId -> assignment` 映射注入 `hostRole` 字段
- 需要访问 HostInventory 或接收 assignments 映射作为参数
- **不由 HostActionExecutor 填充**，避免职责不清

```typescript
// FanOutExecutor 聚合时
const assignmentMap = new Map(assignments.map(a => [a.hostId, a]))
perHostResults.forEach(r => {
  r.hostRole = assignmentMap.get(r.hostId)?.role
})
```

### Step 6: 扩展 Document Execution

**修改文件：**
- `src/document/types.ts` — ExecutionStep 增加 `target?: HostSelector` 字段
- `src/document/executor.ts` — executeStep 检查 target selector

**一期边界明确：**
- **仅 `skill_invoke` 类型 step 支持 target selector**
- `shell` / `docker_exec` / `docker_run` / `validation` / `manual` **暂不放开** target selector
- 避免 document executor 与多机远程执行耦合过深

### Step 7: 创建入口和导出

**文件：** `src/orchestration/index.ts`

导出所有公共接口。

---

## 验证方式

**测试文件：** `tests/orchestration/selection.test.ts` 和 `tests/orchestration/fanout-executor.test.ts`

**测试用例：**

selection.test.ts:
- `selectHosts({ hosts: ["gpu-01", "gpu-02"] })` — 显式 hosts 选择
- `selectHosts({ role: "worker" })` — role 选择，验证过滤 disabled/offline
- `selectHosts({ tags: ["inference"] })` — 单 tag 选择
- `selectHosts({ tags: ["training", "gpu"] })` — **多 tag AND 语义验证**（必须同时匹配两个 tag）
- 匹配到 host 但全部 offline/disabled — 返回 `no_available_hosts` 错误
- 无匹配 host — 返回 `no_hosts_matched` 错误

fanout-executor.test.ts:
- 并行执行多 host，验证 FanOutResult.summary
- `targetHosts: []` — 返回 `empty_target_hosts` 错误
- `stop_on_first_failure` 策略 — 验证剩余 host 标记为 skipped
- **hostRole 注入验证** — PerHostResult 包含正确的 hostRole

**运行命令：**
```bash
npm run build
npm test
```

---

## 关键文件

| 文件 | 用途 |
|------|------|
| `src/core/state-manager.ts` | 现有 HostState、loadSnapshot；新增 getStateDir()、atomicWriteFile() |
| `src/dispatcher/index.ts` | 现有 internalDispatch |
| `src/document/types.ts` | 扩展 ExecutionStep（仅 skill_invoke 支持 target） |
| `src/orchestration/types.ts` | 新增类型定义 |
| `src/orchestration/host-inventory.ts` | 新增 inventory 管理（复用 StateManager 能力） |
| `src/orchestration/selection.ts` | 新增 selector（导入 HostAssignment） |
| `src/orchestration/host-action-executor.ts` | 新增执行器抽象（一期仅 skill 正式实现） |
| `src/orchestration/fanout-executor.ts` | 新增 fan-out（负责注入 hostRole） |
| `src/orchestration/index.ts` | 新增导出入口 |

---

## 不实现（第一阶段边界）

- DAG 调度、自动回滚、资源抢占
- Distributed Workload Orchestrator（JobSpec、runtime role、rendezvous）
- coordinated failure（fail_together、coordinated_cancel）
- dispatch_phase / validate actionType 的正式实现（仅占位）
- shell / docker_* / validation / manual step 的 target selector