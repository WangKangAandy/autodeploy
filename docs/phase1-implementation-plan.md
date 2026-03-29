# 第一阶段实施计划：仓库底座升级

> **状态**: ✅ 核心功能已完成（2026-03-29 更新）
>
> **已完成**:
> - Skill 体系重构（11 个 skill）
> - Dispatcher 层实现
> - 状态管理统一
> - Intent 元数据统一（P1-3 已解决）
> - YAML 解析标准化（TD-1 已解决）
> - 回归测试覆盖（172 个测试）
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

### 4.5 测试 ✅

- [x] dispatcher/document/executor 测试
- [x] 核心模块测试（state-manager-init 测试已补充）
- [x] 172 个测试全部通过（2026-03-29）

---

## 5. 遗留问题与技术债

> 2026-03-29 代码库审视更新

### 5.1 高优先级

#### P1-1: StateManager 过于庞大

**文件**: `src/core/state-manager.ts`（1,188 行）

**问题**: 承担 Host/Operation/Job/Document/持久化等多职责

**建议**: 拆分为独立模块

---

#### P1-2: 核心模块测试缺失 ✅ 已补充

| 模块 | 行数 | 风险 | 状态 |
|------|------|------|------|
| state-manager.ts | 1,188 | 高 | ✅ state-manager-init.test.ts 已补充 |
| ssh-client.js | ~200 | 高 | ⏳ 待补充 |
| permission-gate.ts | ~80 | 高 | ✅ 已通过测试 |
| context-builder.ts | ~200 | 中 | ⏳ 待补充 |

---

#### P1-3: Intent 定义分散，工具 enum 未从唯一事实来源派生 ✅ 已解决

**问题**: `musa_dispatch` 工具的 intent enum 硬编码，与 `skills/index.yml` 不同步

**现象**: 飞书用户请求"下载模型"时，AI 无法识别 `prepare_model` intent，直接调用底层工具绕过 dispatcher

**解决方案**（2026-03-29 已实施）:

1. **Intent 元数据统一**：`skills/index.yml` 成为单一事实源
   - `dispatch_intent` → intent enum
   - `risk_level` → INTENT_RISK
   - `triggers` → INTENT_PATTERNS
   - `description` → getIntentDescription()

2. **动态派生**：
   - `getIntentList()` 从 skill registry 获取 intent 列表
   - `dispatcher/index.ts` 动态构建 tool enum
   - 新增 skill 时无需修改 dispatcher 代码

3. **YAML 解析标准化**（TD-1）：
   - 移除自定义 `parseSimpleYaml()`
   - 使用标准 `yaml` 库解析

**验收**:
- [x] skill-registry.ts 新增 `getIntentList()` 函数
- [x] dispatcher/index.ts 改为动态构建 enum
- [x] 新增 skill 时无需修改 dispatcher 代码
- [x] 使用标准 yaml 库解析（TD-1 已解决）

---

### 5.2 技术债清单

#### TD-1: 自定义 YAML Parser 风险 ✅ 已解决

**现状**: 已使用标准 `yaml` 库替换自定义 parser

**收益**:
- 嵌套对象正确解析（`inputs.required`、`depends_on`）
- 删除 ~120 行自定义 parser 代码
- 支持完整 YAML 特性

#### TD-2: 字符串匹配召回不足

**现状**: `parseIntent()` 采用 `query.includes(trigger.toLowerCase())` 字符串匹配

**局限**:
- 中文自然语言表达可能有召回不足
- 触发词维护成本随 skill 增多而上升
- 对复杂表达和模糊说法的鲁棒性弱于正则/向量方案

**建议**:
- 短期：支持 trigger 配置为正则表达式（向后兼容字符串）
- 长期：考虑语义向量匹配或 LLM 意图分类

**优先级**: 中

---

### 5.3 中优先级

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