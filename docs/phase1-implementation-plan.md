# 第一阶段实施计划：仓库底座升级

> **状态**: ✅ 核心底座已完成（2026-03-28 更新）
>
> **定位**: 第一阶段已具备继续演进的基础，后续工作以底座收口为主，不再新增能力域。
>
> **已完成**:
> - Skill 体系重构（11 个 skill）
> - Dispatcher 层实现
> - 状态管理统一
> - 回归测试覆盖（157 个测试）
>
> **收口工作**: 见第 5 节

---

## 1. 完成状态

### 1.1 目标

从"两个粗粒度 skill"升级为"原子 skill + 资产准备"，构建可长期演进的底座。

**第一阶段后续定位**：底座收口而非扩面。

### 1.2 当前状态

| 项目 | 状态 |
|------|------|
| Skill 数量 | 11 个（2 meta + 9 atomic） ✅ |
| Skill 粒度 | 已拆分为原子 skill，可独立复用 ✅ |
| 资产准备 | 4 个 skill ✅ |
| Dispatcher | orchestrator + router + skill-registry ✅ |
| 状态管理 | 已统一到 StateManager ✅ |
| 测试覆盖 | 157 个测试 ✅ |

**评估结论**：当前底座已够支撑上层能力演进，不再是"从 0 到 1"状态。

---

## 2. Skill 清单

### 2.1 环境 Skill（env/）

| ID | Kind | 职责 |
|----|------|------|
| `deploy_musa_base_env` | meta | 完整环境部署编排 |
| `update_musa_driver` | meta | 驱动更新编排 |
| `ensure_system_dependencies` | atomic | 系统依赖安装 |
| `ensure_musa_driver` | atomic | MUSA 驱动安装 |
| `ensure_mt_container_toolkit` | atomic | 容器工具包安装 |
| `manage_container_images` | atomic | 镜像管理 |
| `validate_musa_container_environment` | atomic | 容器环境验证 |

### 2.2 资产 Skill（assets/）

| ID | 职责 |
|----|------|
| `prepare_musa_package` | MUSA 软件包获取 |
| `prepare_model_artifacts` | 模型文件下载 |
| `prepare_dataset_artifacts` | 数据集下载 |
| `prepare_dependency_repo` | 代码仓库准备 |

### 2.3 第一阶段边界说明

> **收口边界**：第一阶段后续工作以底座收口为主，不再新增 workload/operator/profiling/diagnostics 等新能力域；这些能力进入下一阶段双线演进。
>
> 第一阶段是双线演进的起点，不再承担未来 operator/profiling 设计细节。

---

## 3. 目录结构（最终状态）

```
skills/
├── index.yml
├── env/
│   ├── deploy_musa_base_env/
│   ├── update_musa_driver/
│   ├── ensure_system_dependencies/
│   ├── ensure_musa_driver/
│   ├── ensure_mt_container_toolkit/
│   ├── manage_container_images/
│   └── validate_musa_container_environment/
├── assets/
│   ├── prepare_musa_package/
│   ├── prepare_model_artifacts/
│   ├── prepare_dataset_artifacts/
│   └── prepare_dependency_repo/
└── _templates/
```

---

## 4. 验收检查清单

> **说明**：以下检查项反映第一阶段核心交付结果；后续仅补充底座收口项，不再新增同阶段能力范围。

### 4.1 目录结构 ✅

- [x] skills/env/ 和 skills/assets/ 目录
- [x] 11 个 skill 已就位
- [x] skills/_templates/ 模板目录

### 4.2 Skill 体系 ✅

- [x] 5 个原子 env skill
- [x] 2 个 meta skill
- [x] 4 个资产准备 skill

### 4.3 Dispatcher ✅

- [x] orchestrator.ts 编排执行器
- [x] router.ts 分类路由
- [x] skill-registry.ts 注册表
- [x] intent-parser.ts 新增 intent

### 4.4 状态管理 ✅（2026-03-28）

- [x] StateManager 成为唯一状态源
- [x] refreshCache 失败策略（remote 阻断，local 继续）
- [x] musa_get_mode 脱敏
- [x] hosts.json 权限 600

### 4.5 测试 ⏳

- [x] dispatcher/document/executor 测试
- [ ] 核心模块测试缺失（见 5.2）

---

## 5. 收口工作

> 第一阶段后续工作只做收口，目标是让底座"可长期演进"。

### 5.1 收口目标

让底座可信，支撑后续双线演进：

- 状态边界清晰
- intent 路由唯一事实源
- 核心骨架可测试
- 多机/远程探测语义可信

### 5.2 收口项目

#### C-1: Intent 单一事实源

**问题**: `musa_dispatch` 工具的 intent enum 硬编码，与 `skills/index.yml` 不同步

**现象**: 飞书用户请求"下载模型"时，AI 无法识别 `prepare_model` intent，直接调用底层工具绕过 dispatcher

**当前状态**（2026-03-28 已临时修复 enum）:
- `state-manager.ts` 类型定义：13 个 intent ✅
- `intent-parser.ts` 模式匹配：完整 ✅
- `router.ts` 路由逻辑：完整 ✅
- `skills/index.yml` dispatch_intent：完整 ✅
- `dispatcher/index.ts` enum：临时补全 ✅（仍为硬编码）

**方案**:

```typescript
// dispatcher/index.ts
import { loadRegistry, getIntentList } from "./skill-registry.js"

export function registerDispatcherTool(api: any, stateManager: StateManager): void {
  loadRegistry()

  // 从 skill-registry 动态构建 intent enum
  const intentEnum = getIntentList()  // 新增：从 index.yml 派生

  api.registerTool({
    parameters: {
      properties: {
        intent: { enum: intentEnum }  // 动态生成
      }
    }
  })
}
```

**验收**:
- [ ] skill-registry.ts 新增 `getIntentList()` 函数
- [ ] dispatcher/index.ts 改为动态构建 enum
- [ ] 新增 skill 时无需修改 dispatcher 代码

---

#### C-2: StateManager 拆分

**文件**: `src/core/state-manager.ts`（1,188 行）

**问题**: 承担 Host/Operation/Job/Document/持久化等多职责

**建议拆分为**:

| 模块 | 职责 |
|------|------|
| `host-store.ts` | Host 状态管理 |
| `operation-store.ts` | Operation 状态管理 |
| `job-store.ts` | Job 状态管理 |
| `document-store.ts` | Document 执行状态管理 |
| `persistence-store.ts` | 持久化层 |

**验收**:
- [ ] 各模块独立，职责单一
- [ ] StateManager facade 保持接口兼容
- [ ] 原有测试不受影响

---

#### C-3: 核心模块测试补齐

| 模块 | 行数 | 风险 | 状态 |
|------|------|------|------|
| state-manager.ts | 1,188 | 高 | 待补充 |
| ssh-client.js | ~200 | 高 | 待补充 |
| permission-gate.ts | ~80 | 高 | 待补充 |
| context-builder.ts | ~200 | 中 | 待补充 |

**建议**: 优先补充 state-manager 和 ssh-client 测试

**验收**:
- [ ] state-manager 核心路径有测试覆盖
- [ ] ssh-client 连接/执行/错误处理有测试
- [ ] 测试通过

---

#### C-4: probeAllHosts 做实

**问题**: 只更新时间戳，不探测主机状态

**建议**: 实现 SSH 连接测试或重命名方法

**验收**:
- [ ] probeAllHosts 完成 SSH reachability 测试
- [ ] 或方法重命名为 `touchAllHosts`
- [ ] 主机状态语义可信

---

#### C-5: 重复代码收敛

**问题 1**: `src/core/utils.js` 和 `agent-tools/src/shared/utils.ts` 完全重复（~70 行）

**建议**: 提取到 `src/shared/utils.ts`

**问题 2**: `src/core/ssh-client.js` 和 `agent-tools/src/core/executors.ts` 重复

**建议**: 提取共享逻辑

**验收**:
- [ ] utils 统一到 `src/shared/utils.ts`
- [ ] SSH 执行逻辑收敛

---

### 5.3 不在收口范围内

以下低优先级问题不阻塞底座收口：

| 问题 | 说明 |
|------|------|
| 双重架构 | OpenClaw/MCP 并行实现（设计决策） |
| 配置分散 | 多目录配置文件（可接受） |
| 编译输出 | dist/ 目录污染（CI/CD 待解决） |

---

## 6. 收口验收标准

### 6.1 底座可信指标

| 指标 | 验收标准 |
|------|----------|
| 状态边界清晰 | StateManager 拆分完成，各模块职责单一 |
| intent 唯一事实源 | enum 从 index.yml 动态派生 |
| 核心骨架可测试 | state-manager / ssh-client 测试覆盖 |
| 多机探测可信 | probeAllHosts 完成真实探测 |

### 6.2 可长期演进指标

- 第一阶段不再新增能力域
- 底座支撑 V2A/V2B 双线演进
- 技术债可控，不阻塞后续开发

---

## 7. 后续优化：ensure_system_dependencies 增强

> 状态：待实施
> 优先级：P1（可在收口期间并行）

**目标**: 支持 GROUPS 分组选择和 CHECK_ONLY 模式

**配置示例** (`config/dependencies.yml`):

```yaml
groups:
  driver_prerequisites: [build-essential, dkms, linux-headers]
  download_tools: [git-lfs, huggingface_hub, modelscope]
  utilities: [wget, curl, jq, yq]
```

**调用示例**:

```bash
musa_dispatch(intent="ensure_system_dependencies", context={
  "GROUPS": "download_tools",
  "CHECK_ONLY": true
})
```

**验收**:
- [ ] GROUPS 分组安装
- [ ] CHECK_ONLY 模式
- [ ] 与 prepare_model_artifacts 集成