# OpenClaw-MUSA 平台演进路线图

本文档定义了 openclaw-musa 插件从"基础设施部署器"演进为"AI workload 交付平台"的路线图。

---

## 1. 当前仓库能力评估

### 1.1 已具备的核心能力

| 能力层 | 模块 | 实现状态 | 关键文件 |
|--------|------|----------|----------|
| 统一调度器 | `musa_dispatch` | ✅ 完整实现 | `src/dispatcher/index.ts` |
| 状态管理 | `StateManager` | ✅ 完整实现 | `src/core/state-manager.ts` |
| 文档驱动执行 | Document Execution | ✅ V1/Stage 1A 底座已实现 | `src/document/` |
| 静态规则注入 | AGENTS.md 合并 | ✅ 已通过插件自举实现 | `src/utils/agents-merge.js` |
| 动态上下文注入 | `before_prompt_build` hook | ✅ 完整实现 | `src/adapter/hooks.ts` |
| 本地/远程双模执行 | Executor | ✅ 完整实现 | `src/core/executor.js` |
| MCP Server | Agent Tools | ✅ 完整实现 | `agent-tools/src/` |

**说明**：
- **文档驱动执行**：V1 只支持高确定性解析，外部文档源（飞书/钉钉）和完整应用层能力待扩展
- **静态规则注入**：⚠️ 核心 `installHook` 标准化仍属长期改进，当前通过插件自举实现

### 1.2 Skill 层现状

当前仅有 2 个 skill，粒度过粗：

| Skill | 职责 | 阶段数 | 问题 |
|-------|------|--------|------|
| `deploy_musa_base_env` | 完整环境部署 | 6 | 无法独立复用各阶段 |
| `update_musa_driver` | 驱动更新 | 4 | 相对独立，但缺乏资产准备能力 |

### 1.3 能力缺口

| 缺口 | 影响 |
|------|------|
| 缺少原子 skill | 文档执行映射粗粒度、失败重试困难 |
| 缺少资产准备层 | 无法自动准备模型、数据集、依赖仓库 |
| 缺少多机编排 | 只能单机部署 |
| 缺少 workload skill | 无法运行训练/推理 workload |
| 缺少 benchmark skill | 无法验证性能 |
| 缺少 CUDA 迁移能力 | 无法自动化迁移流程 |

---

## 2. 演进目标

### 目标 1：环境交付平台

自动部署 MUSA 环境，支持单机/多机。

**当前完成度：60%**

已具备：本地/远程执行、状态追踪、文档驱动执行
缺失：原子 skill、多机编排

### 目标 2：AI Workload 平台

自动准备模型、数据集、依赖仓库并运行训练/推理 workload。

**当前完成度：10%**

已具备：文档执行框架
缺失：资产准备 skill、workload skill、Workload Spec

### 目标 3：性能验证平台

自动验证通信、算力、带宽等基础性能。

**当前完成度：0%**

缺失：benchmark skill 集

### 目标 4：CUDA→MUSA 迁移平台

自动把 CUDA 项目适配到 MUSA。

**当前完成度：0%**

缺失：迁移 skill 集

---

## 3. Skill 目录分类结构

随着 skill 颗粒度细化，建议在目录结构上增加一层分类：

```
skills/
  env/                              # 环境相关 skill
    deploy_musa_base_env/           # meta skill: 完整环境部署
    update_musa_driver/             # 用户意图入口: 驱动更新
    ensure_system_dependencies/     # 确保系统依赖已安装
    ensure_musa_driver/             # 状态驱动入口: 确保驱动状态
    ensure_mt_container_toolkit/    # 确保容器工具包
    prepare_runtime_image/          # 准备运行时镜像
    validate_musa_container_environment/  # 容器环境验证

  assets/                           # 资产准备相关 skill
    prepare_musa_package/           # MUSA 软件包获取（驱动、toolkit 等）
    prepare_model_artifacts/        # 模型文件准备
    prepare_dataset_artifacts/      # 数据集准备
    prepare_dependency_repo/        # 依赖仓库准备

  workload/                         # workload 运行相关 skill
    run_inference_workload/         # 运行推理 workload
    run_training_workload/          # 运行训练 workload
    start_model_service/            # 启动模型服务
    validate_inference_service/     # 验证推理服务
    validate_training_job/          # 验证训练任务

  benchmark/                        # (第三阶段) 性能验证 skill
    benchmark_compute/              # 算力基准测试
    benchmark_bandwidth/            # 带宽测试
    benchmark_p2p/                  # P2P 通信测试
    benchmark_collective_comm/      # 集合通信测试
    benchmark_inference_baseline/   # 推理基准测试

  migration/                        # (第三阶段) CUDA 迁移 skill
    scan_cuda_project/              # 扫描 CUDA 项目
    analyze_musa_compatibility/     # 分析 MUSA 兼容性
    adapt_cuda_project/             # 适配 CUDA 项目
    build_and_validate_musa_project/  # 构建验证 MUSA 项目
```

### 分类原则

| 分类 | 职责 | 阶段 |
|------|------|------|
| `env/` | 基础设施部署、环境配置 | 第一阶段 |
| `assets/` | 宿主机安装包、模型、数据集、依赖仓库准备 | 第一阶段 |
| `workload/` | 训练/推理 workload 运行 | 第二阶段 |
| `benchmark/` | 性能验证 | 第三阶段 |
| `migration/` | CUDA→MUSA 迁移 | 第三阶段 |

### skills/index.yml 分层维度

`skills/index.yml` 使用**三个正交维度**进行分层：

**维度一：category（目录分类）**
- `env` / `assets` / `workload` / `benchmark` / `migration`
- 对应目录结构，决定 skill 的物理位置

**维度二：kind（执行粒度）**
- `atomic` - 原子 skill，可独立执行
- `meta` - 组合 skill，编排其他 skill

**维度三：exposure（暴露方式）**
- `user` - 用户意图入口，用户直接调用
- `internal` - 状态驱动入口，被其他 skill 调用

**示例**：
```yaml
skills:
  - id: deploy_musa_base_env
    category: env
    kind: meta
    exposure: user
    # ...

  - id: update_musa_driver
    category: env
    kind: meta            # 轻量用户入口包装器
    exposure: user
    # 注：不承担复杂多阶段环境编排，只做前置检查 → 调用 ensure_musa_driver
    # ...

  - id: ensure_musa_driver
    category: env
    kind: atomic
    exposure: internal
    # ...

  - id: prepare_model_artifacts
    category: assets
    kind: atomic
    exposure: user
    # ...
```

### 与 `skills/index.yml` 的关系

`index.yml` 作为 skill 索引，通过 `category` 字段关联目录分类：

```yaml
skills:
  - id: deploy_musa_base_env
    name: deploy_musa_base_env
    path: env/deploy_musa_base_env/SKILL.md
    category: env
    # ...

  - id: prepare_model_artifacts
    name: prepare_model_artifacts
    path: assets/prepare_model_artifacts/SKILL.md
    category: assets
    # ...
```

### 约束规则

`kind` 与 `exposure` 为正交维度，但并非任意组合都推荐：

| kind | 推荐 exposure | 说明 |
|------|--------------|------|
| `meta` | `user` | 组合 skill 面向用户入口 |
| `atomic` | `user` 或 `internal` | 原子 skill 可暴露给用户或内部调用 |
| `internal` skill | - | 默认不直接参与自然语言意图路由 |
| `user` skill | - | 必须有 `dispatch_intent` 或明确的调用入口方式 |

**说明**：`exposure=user` 表示允许作为显式入口使用，**不等于默认参与自然语言自动路由**。是否参与自动路由由 `dispatch_intent` 是否存在决定。

---

## 4. 演进路线

### 4.1 第一阶段：仓库底座升级（一等优先级）

**第一阶段新增的正式 skill 为 5 个环境主 skill + 4 个资产 skill。`ensure_musa_driver` 的 4 个内部步骤为实现细节，不作为对外独立 skill 注册。**

**目标：从"两个粗 skill"升级成"原子 skill + 资产准备 + 多机基础"**

#### A. Skill 体系重构

##### 当前问题

- `deploy_musa_base_env` 包含 6 个阶段，无法独立复用
- 文档执行映射到 skill 时粒度过粗
- 失败重试只能从阶段开始，无法精确到步骤

##### 重构原则

命名规范：
- `ensure_*`：把某个系统组件带到目标状态
- `prepare_*`：把运行资源准备到可用状态
- `validate_*`：做显式验证和验收

##### 新增原子 skill

| Skill | 职责 | 对应原阶段 |
|-------|------|-----------|
| `ensure_system_dependencies` | 确保系统依赖已安装 | Step 1 |
| `ensure_musa_driver` | 确保驱动处于正确状态 | Step 2 |
| `ensure_mt_container_toolkit` | 确保容器工具包安装并绑定 | Step 3 |
| `prepare_runtime_image` | 拉取/校验运行时镜像 | Step 4 |
| `validate_musa_container_environment` | 容器内环境验证 | Step 5 |

**关于 `ensure_system_dependencies`**：
- 命名遵循 `ensure_*` 规范，语义清晰：检查缺失 → 补齐
- 它可以被其他 skill（如 `update_musa_driver`）以"检查/补齐"模式复用
- 实现时支持：`mode=full`（完整检查安装）和 `mode=check_and_fix`（仅补齐缺失项）

##### 组合 skill 保留

`deploy_musa_base_env` 改为 meta skill，编排上述 5 个原子 skill：

```
deploy_musa_base_env:
  1. ensure_system_dependencies
  2. ensure_musa_driver
  3. ensure_mt_container_toolkit
  4. prepare_runtime_image
  5. validate_musa_container_environment
```

##### `update_musa_driver` 精细化

**当前状态（7 个）**：

| 状态 | 含义 | 对应步骤 |
|------|------|----------|
| `initialized` | 已初始化 | Step 1-2: 检查驱动、检查前提条件 |
| `package_ready` | 驱动包已准备 | Step 3: 准备驱动包 |
| `driver_removed` | 旧驱动已移除 | Step 4: 移除现有驱动 |
| `driver_installed` | 新驱动已安装 | Step 5: 安装目标驱动 |
| `driver_loaded` | 驱动已加载 | Step 6: 重载驱动 |
| `validated` | 主机验证通过 | Step 7: 验证主机驱动 |
| `completed` | 完成 | Step 8: 可选容器验证 |

**问题**：
- `initialized` 包含两个步骤，粒度粗
- Step 2/7/8 与 `deploy_musa_base_env` 有重复，可复用性差

**精细化建议**：

**`ensure_musa_driver` 的 4 个内部实现步骤**（不计入第一阶段 skill 总数）：

```
ensure_musa_driver 内部步骤:
├── check_driver_status          # 检查当前驱动状态
├── prepare_driver_package       # 准备驱动包（调用 assets/prepare_musa_package）
├── apply_musa_driver            # 应用驱动（卸载+安装+加载）
└── validate_musa_driver         # 验证驱动
```

**说明**：第一阶段是 **5 个环境主 skill**（上文列出的），这 4 个是 `ensure_musa_driver` 的内部实现，不对用户直接暴露。

**设计决策**：
- 去掉 `ensure_driver_prerequisites`：并入通用的 `ensure_system_dependencies`
- 用 `apply_musa_driver` 而非 `install_musa_driver`："install"语义太窄，实际包含卸载+安装+加载
- 驱动/toolkit 包的获取逻辑抽到 assets 层

**与 `ensure_musa_driver` 的关系**：

| Skill | 语义 | 调用关系 |
|-------|------|----------|
| `update_musa_driver` | 用户意图入口：我要更新驱动 | 用户直接调用 |
| `ensure_musa_driver` | 状态驱动入口：确保驱动处于正确状态 | 被 `deploy_musa_base_env` 等调用 |

**共享实现**：
```
ensure_musa_driver (内部状态入口):
  1. check_driver_status
  2. if current != target:
       prepare_driver_package  # 内部调用 prepare_musa_package
       apply_musa_driver
  3. validate_musa_driver

update_musa_driver (用户入口):
  1. 必要的前提检查（复用 ensure_system_dependencies）
  2. ensure_musa_driver(targetVersion)
```

##### 现有 skill 处理

- `update_musa_driver`：保留作为用户意图入口
- 新增 `ensure_musa_driver` 作为状态驱动入口
- 两者共享底层实现

##### 交付顺序

1. 定义 `skills/index.yml` 字段规范：category / kind / exposure / path / dispatch_* / inputs / outputs
2. 抽出 5 个原子 skill
3. 改写 `deploy_musa_base_env` 为编排型
4. 更新 `musa_dispatch` 的路由逻辑

##### 验收标准

- [ ] 5 个原子 skill 都能独立执行
- [ ] `deploy_musa_base_env` 内部只负责编排
- [ ] 基础设施类文档步骤**优先映射**到 env / assets 原子 skill，无法映射时才退回 shell

##### Skill 到 Intent 的映射策略

新增 skill 默认通过 meta skill、内部调度或文档执行 planner 调用，**不要求为每个 skill 单独新增顶层 intent**。只有确实需要用户直达调用的 skill，才补充顶层 intent。

当前顶层 intent：
- `deploy_env` → `deploy_musa_base_env`
- `update_driver` → `update_musa_driver`
- `execute_document` → 文档驱动执行
- `gpu_status` / `validate` / `sync` / `run_container` / `auto`

#### B. 资产准备层

##### 新增 skill

| Skill | 职责 | 资产类型 |
|-------|------|----------|
| `prepare_musa_package` | MUSA 软件包获取（驱动、toolkit 等） | **系统安装包资产** |
| `prepare_model_artifacts` | 发现/下载/校验模型文件 | AI workload 资产 |
| `prepare_dataset_artifacts` | 发现/下载/校验数据集 | AI workload 资产 |
| `prepare_dependency_repo` | 准备代码与依赖源（repo checkout / mirror / package source） | AI workload 资产 |

**说明**：
- `prepare_musa_package` 属于系统安装包资产
- `prepare_model_artifacts` / `prepare_dataset_artifacts` 属于 AI workload 资产
- `prepare_dependency_repo` **第一阶段最小范围**：repo checkout 和本地/镜像依赖源准备。包管理生态集成（pip/conda 私有源、wheelhouse、认证配置）属于第二阶段增强项。

##### 统一策略

每个资产 skill 遵循：
1. **发现**：检查本地是否已有目标资源
2. **解析提示**：文档路径、上下文路径、显式参数
3. **下载/同步**：仅当缺失且允许时
4. **校验**：有校验和就校验，不强制

**说明**：文档和上下文会提供路径提示，平台不应该一上来就默认下载。尤其是模型、数据集这类资源，经常是"先找已有目录，再考虑拉取"。

##### 标准化输出

```json
{
  "status": "found | downloaded | missing",
  "resolvedPath": "./musa_packages/musa_3.3.5-server_amd64.deb",
  "source": "existing | moss | mirror",
  "integrity": "sha256:xxx (if available)"
}
```

##### 实现位置

作为现有 skill 体系的一部分，不放在 MCP 层。

#### C. 多机执行模型

##### 架构位置

多机编排在 **dispatcher 之上**，不在 dispatcher 内部实现。

Dispatcher 的职责是单操作路由和状态追踪。多机编排涉及批量下发、并行/串行调度、结果聚合、失败回滚策略，这些应该在更高层实现。

##### 第一阶段只做三件事

1. **Host Inventory**：host 清单、标签、状态、来源
2. **Role 定义**：`master / worker / inference / storage`
3. **Fan-out 执行器**：按 role 批量下发 skill 或 plan phase

##### 数据模型

```typescript
interface HostInventory {
  hosts: HostState[]      // 复用现有 StateManager
  roles: Record<string, HostRole[]>
}

interface HostRole {
  hostId: string
  role: "master" | "worker" | "inference" | "storage"
  tags: string[]
}
```

##### 执行模型

```
deploy_musa_base_env(hosts: ["gpu-01", "gpu-02", "gpu-03"])
  │
  ├─ fan-out: ensure_musa_driver → [gpu-01, gpu-02, gpu-03] (parallel)
  │
  ├─ fan-out: ensure_mt_container_toolkit → [gpu-01, gpu-02, gpu-03] (parallel)
  │
  └─ aggregate: per-host success/failure report
```

##### 验收标准

- [ ] 同一 skill 可对多台 host 并行下发
- [ ] 输出 per-host 成功/失败报告
- [ ] 文档执行支持按 host role 分发

##### 最小边界

第一阶段的多机 orchestrator 只做 fan-out 和结果聚合，**不做**：
- 资源抢占
- DAG 调度
- 自动回滚编排
- 跨主机依赖图优化

##### 默认失败策略

**best-effort**：任一 host 失败时，其他 host 继续执行，最终聚合失败列表，**不做自动回滚**。
- 跨主机依赖图优化

#### D. Readiness 验证

##### 新增 skill

| Skill | 职责 |
|-------|------|
| `validate_driver_runtime` | 驱动层验证 |
| `validate_container_runtime` | 容器运行时验证 |
| `validate_model_runtime_readiness` | 模型运行准备验证 |

##### 与 `validate_musa_container_environment` 的关系

**两层验证体系**：

| 层次 | Skill | 用途 |
|------|-------|------|
| 组合 skill 终态验收 | `validate_musa_container_environment` | `deploy_musa_base_env` 的最后验收步骤 |
| 可复用细粒度检查 | `validate_driver_runtime` 等 | 通用检查件，可被多个 skill 调用 |

**说明**：
- `validate_musa_container_environment` 是"环境交付主链的终态验证"，作为 `deploy_musa_base_env` 的最后一步
- Readiness 验证 skill 是"通用检查件"，可以独立调用或被其他 skill 复用
- 前者关注"整个环境是否可用"，后者关注"某个组件是否就绪"

---

### 4.2 第二阶段：AI Workload 平台化（二等优先级）

**前置条件：第一阶段完成**

#### A. Workload Spec 定义

定义统一的 workload 规范：

```yaml
workload:
  type: training | inference
  mode: single_node | multi_node    # 部署模式
  entrypoint: "python train.py"
  model:
    name: "llama-7b"
    path: "/data/models/llama-7b"
  dataset:
    name: "alpaca"
    path: "/data/datasets/alpaca"
  repo:
    url: "https://github.com/xxx/train-repo"
    branch: "main"
  resources:
    gpu: 4
    memory: "80G"
  validation:
    - command: "python validate.py"
      expectedOutput: "loss < 0.5"

# 未来可扩展：
# launcher: torchrun | mpirun | custom
# topology: standalone | distributed
# nodes: 4
# master_addr: "10.0.0.1"
```

#### B. Workload Skills

| Skill | 职责 |
|-------|------|
| `run_inference_workload` | 运行推理 workload |
| `run_training_workload` | 运行训练 workload |
| `start_model_service` | 启动模型服务（vLLM 等） |
| `validate_inference_service` | 验证推理服务 |
| `validate_training_job` | 验证训练任务 |

#### C. 资产准备接入

生命周期串联：

```
prepare_dependency_repo
    → prepare_dataset_artifacts
    → prepare_model_artifacts
    → run_*_workload
    → validate_*
```

#### D. 外部文档源（Stage 1B）

支持飞书/钉钉文档拉取：
- 鉴权（OAuth / App Token）
- 归一化（HTML/Docx → Markdown）
- 重试机制

---

### 4.3 第三阶段：性能验证与 CUDA 迁移（三等优先级）

#### A. GPU 性能验证平台

**注**：第三阶段的 benchmark / migration skill 也遵循 kind/exposure 分层，不默认全部是 atomic skill。例如：
- `benchmark_compute` 可能是 `kind: atomic, exposure: user`
- `build_and_validate_musa_project` 可能是 `kind: meta, exposure: user`

第三阶段新增 skill 同样不要求默认新增顶层 intent，仍优先通过 meta skill、planner 或显式入口调用。

##### Benchmark skill 集

| Skill | 职责 |
|-------|------|
| `benchmark_compute` | 算力基准测试 |
| `benchmark_bandwidth` | 带宽测试 |
| `benchmark_p2p` | P2P 通信测试 |
| `benchmark_collective_comm` | 集合通信测试（MCCL） |
| `benchmark_inference_baseline` | 推理基准测试 |

##### 结构化输出

```json
{
  "latency": { "p50": 10, "p99": 50 },
  "throughput": 1000,
  "bandwidth": "32 GB/s",
  "tflops": 50.5,
  "environment": {
    "host": "gpu-01",
    "driver": "3.3.5",
    "sdk": "4.3.5"
  },
  "threshold": { "pass": true }
}
```

#### B. CUDA→MUSA 迁移平台

##### 四步能力

| Skill | 职责 |
|-------|------|
| `scan_cuda_project` | 识别构建系统、CUDA 依赖、关键源文件 |
| `analyze_musa_compatibility` | API 替换建议、算子兼容风险 |
| `adapt_cuda_project` | 生成 patch、编译配置、环境脚本 |
| `build_and_validate_musa_project` | 构建、运行 smoke test、输出报告 |

---

## 5. 实施优先级

### 5.1 一等优先级（必须先做）

| 序号 | 任务 | 预估工时 | 依赖 |
|------|------|----------|------|
| 1 | 定义 `skills/index.yml` 结构和字段规范 | 0.5 天 | 无 |
| 2 | Skill 体系重构（5 个原子 skill） | 5-7 天 | 1 |
| 3 | 改写 `deploy_musa_base_env` 为编排型 | 1 天 | 2 |
| 4 | 更新 dispatcher 路由逻辑 | 1-2 天 | 2, 3 |
| 5 | 资产准备层（4 个 skill） | 4-5 天 | 1 |
| 6 | 多机 inventory/role/fan-out | 5-6 天 | 无 |
| 7 | Readiness 验证 skill | 2-3 天 | 2 |
| 8 | 文档执行与新 skill 映射 | 1-2 天 | 2, 5 |

**实施顺序说明**：
1. 先定规则（index.yml 结构），再填实例（具体 skill）
2. skill 索引结构是"规则"，具体 skill 是"实例"
3. 工时预估已包含文档更新、tests、dispatcher/router 适配、state manager 扩展、回归验证

### 5.2 二等优先级（底座稳了再做）

| 序号 | 任务 | 预估工时 | 依赖 |
|------|------|----------|------|
| 9 | Workload Spec 定义 | 2-3 天 | 一等完成 |
| 10 | Workload skills（5 个） | 7-10 天 | 9 |
| 11 | 资产与 workload 生命周期打通 | 3-4 天 | 5, 10 |
| 12 | 外部文档源（飞书/钉钉） | 4-6 天 | 一等完成 |

### 5.3 三等优先级（最后做）

| 序号 | 任务 | 预估工时 | 依赖 |
|------|------|----------|------|
| 13 | Benchmark skill 集 | 5-7 天 | 二等完成 |
| 14 | CUDA 迁移 skill 集 | 7-10 天 | 二等完成 |

---

## 6. 关键设计决策

### 6.1 为什么不让 dispatcher 支持多机？

Dispatcher 的职责是 **单操作路由** 和 **状态追踪**。多机编排涉及：
- 批量下发
- 并行/串行调度
- 结果聚合
- 失败回滚策略

这些应该在 **更高层** 实现，保持 dispatcher 单一职责。

### 6.2 为什么保留 `update_musa_driver`？

当前 skill 设计是 **用户意图驱动**：
- 用户说"更新驱动" → `update_musa_driver`
- 用户说"部署环境" → `deploy_musa_base_env`

新增 `ensure_musa_driver` 作为 **状态驱动入口**，两者共存：
- `update_musa_driver`：响应用户意图
- `ensure_musa_driver`：被其他 skill 调用，确保状态

### 6.3 为什么资产准备不在 MCP 层？

资产准备 skill 需要：
- 与 StateManager 集成（状态持久化）
- 与 dispatcher 集成（意图路由）
- 与文档执行集成（参数传递）

MCP 是对外暴露层，应该在 skill 成熟后再包装。

### 6.4 原子 skill 拆分粒度如何确定？

原则：
- **可独立执行**：能单独调用并产生有意义结果
- **可复用**：被多个 meta skill 复用
- **可映射**：文档步骤能精确映射

不符合原则的（如单独的 `start_runtime_validation_container`）应该合并到更完整的 skill。

---

## 7. 验收检查清单

### 7.1 第一阶段完成标准

- [ ] 5 个原子 skill 可独立执行
- [ ] `deploy_musa_base_env` 改为编排型
- [ ] 4 个资产准备 skill 可用
- [ ] 多机 fan-out 执行可用
- [ ] 基础设施类文档步骤优先映射到 env/assets 原子 skill
- [ ] 所有测试通过

### 7.2 第二阶段完成标准

- [ ] Workload Spec 定义完成
- [ ] 训练/推理 workload 可运行
- [ ] 飞书/钉钉文档源可用
- [ ] 端到端验证通过

### 7.3 第三阶段完成标准

- [ ] Benchmark 报告结构化输出
- [ ] CUDA 项目迁移流程跑通
- [ ] 性能对比报告可用

---

## 附录：已实现能力关键代码

### 统一调度器

文件：`src/dispatcher/index.ts`

- Intent 解析、权限门控、Resume 语义检查
- `dispatch()` 函数实现完整流程
- 支持的 intent：`deploy_env`, `update_driver`, `gpu_status`, `run_container`, `validate`, `sync`, `auto`, `execute_document`

### 状态管理

文件：`src/core/state-manager.ts`

- Operation/Job/Host/DocumentExecutionState 状态机
- 锁机制（V1 粗粒度锁）、checkpoint、rollback 支持
- OperationKey 幂等检查

### 文档驱动执行

文件：`src/document/types.ts`

`ExecutionStep.type` 支持：
- `shell` - 直接执行 shell 命令
- `docker_exec` - 在容器内执行命令
- `docker_run` - 运行容器
- `validation` - 验证步骤
- `skill_invoke` - 调用现有 skill
- `manual` - 需要人工确认

不是只能映射到 `deploy_env`。

### Skill 索引

文件：`skills/index.yml`

- 当前只有 `deploy_musa_base_env` 和 `update_musa_driver`
- 已有 `dispatch_intent` 和 `dispatch_entry` 映射
- 包含 inputs/outputs 定义