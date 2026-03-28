# 第一阶段实施计划：仓库底座升级

> **状态**: ✅ 核心功能已完成（2026-03-28 更新）
>
> **已完成**:
> - Skill 体系重构（11 个 skill）
> - Dispatcher 层实现
> - 状态管理统一
> - 回归测试覆盖（157 个测试）
>
> **遗留问题**: 见第 5 节

---

## 1. 完成状态

### 1.1 目标

从"两个粗粒度 skill"升级为"原子 skill + 资产准备"。

### 1.2 当前状态

| 项目 | 状态 |
|------|------|
| Skill 数量 | 11 个（2 meta + 9 atomic） ✅ |
| Skill 粒度 | 已拆分为原子 skill，可独立复用 ✅ |
| 资产准备 | 4 个 skill ✅ |
| Dispatcher | orchestrator + router + skill-registry ✅ |
| 状态管理 | 已统一到 StateManager ✅ |
| 测试覆盖 | 157 个测试 ✅ |

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
- [ ] 核心模块测试缺失（见 5.1 P1-2）

---

## 5. 遗留问题与技术债

> 2026-03-28 代码库审视发现

### 5.1 高优先级

#### P1-1: StateManager 过于庞大

**文件**: `src/core/state-manager.ts`（1,188 行）

**问题**: 承担 Host/Operation/Job/Document/持久化等多职责

**建议**: 拆分为独立模块

---

#### P1-2: 核心模块测试缺失

| 模块 | 行数 | 风险 |
|------|------|------|
| state-manager.ts | 1,188 | 高 |
| ssh-client.js | ~200 | 高 |
| permission-gate.ts | ~80 | 高 |
| context-builder.ts | ~200 | 中 |

**建议**: 优先补充 state-manager 和 ssh-client 测试

---

#### P1-3: Intent 定义分散，工具 enum 未从唯一事实来源派生

**问题**: `musa_dispatch` 工具的 intent enum 硬编码，与 `skills/index.yml` 不同步

**现象**: 飞书用户请求"下载模型"时，AI 无法识别 `prepare_model` intent，直接调用底层工具绕过 dispatcher

**当前状态**（2026-03-28 已临时修复 enum）:
- `state-manager.ts` 类型定义：13 个 intent ✅
- `intent-parser.ts` 模式匹配：完整 ✅
- `router.ts` 路由逻辑：完整 ✅
- `skills/index.yml` dispatch_intent：完整 ✅
- `dispatcher/index.ts` enum：临时补全 ✅（仍为硬编码）

**根本原因**: 工具 enum 未从 `skills/index.yml` 派生

**方案 C（完整方案）**:

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

### 5.2 中优先级

#### P2-1: utils 重复

`src/core/utils.js` 和 `agent-tools/src/shared/utils.ts` 完全重复（~70 行）

**建议**: 提取到 `src/shared/utils.ts`

---

#### P2-2: SSH 执行逻辑重复

`src/core/ssh-client.js` 和 `agent-tools/src/core/executors.ts` 重复

**建议**: 提取共享逻辑

---

#### P2-3: probeAllHosts 未实现

只更新时间戳，不探测主机状态

**建议**: 实现 SSH 连接测试或重命名方法

---

### 5.3 低优先级

| 问题 | 说明 |
|------|------|
| 双重架构 | OpenClaw/MCP 并行实现 |
| 配置分散 | 多目录配置文件 |
| 编译输出 | dist/ 目录污染 |

---

## 6. 不在第一阶段范围内

- Workload Spec 定义（第二阶段）
- 训练/推理 workload skill（第二阶段）
- Benchmark skill（第三阶段）
- CUDA 迁移 skill（第三阶段）

---

## 7. 后续优化：ensure_system_dependencies 增强

> 状态：待实施
> 优先级：P1

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