# OpenClaw-MUSA 平台演进路线图

本文档定义了 openclaw-musa 插件从"基础设施部署器"演进为"MUSA 软件栈交付与研发协同平台"的路线图。

---

## 1. 平台定义

**openclaw-musa 是一个面向 MUSA 软件栈的交付与研发协同平台**，既服务环境/工作负载交付，也服务算子开发、性能剖析和问题诊断。

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
- **OpenClaw hook**：更偏"认知引导"而非"机械强约束"，核心能力建立在 runtime/state/planner/executor 上

### 1.2 Skill 层现状

当前已有 11 个 skill，粒度已拆分为原子级别：

| Skill | 职责 | Kind |
|-------|------|------|
| `deploy_musa_base_env` | 完整环境部署编排 | meta |
| `update_musa_driver` | 驱动更新编排 | meta |
| `ensure_system_dependencies` | 系统依赖安装 | atomic |
| `ensure_musa_driver` | MUSA 驱动安装 | atomic |
| `ensure_mt_container_toolkit` | 容器工具包安装 | atomic |
| `manage_container_images` | 镜像管理 | atomic |
| `validate_musa_container_environment` | 容器环境验证 | atomic |
| `prepare_musa_package` | MUSA 软件包获取 | atomic |
| `prepare_model_artifacts` | 模型文件下载 | atomic |
| `prepare_dataset_artifacts` | 数据集下载 | atomic |
| `prepare_dependency_repo` | 代码仓库准备 | atomic |

### 1.3 能力缺口

| 缺口 | 影响 | 归属线 |
|------|------|--------|
| 缺少多机编排 | 只能单机部署 | 交付线 |
| 缺少 workload skill | 无法运行训练/推理 workload | 交付线 |
| 缺少 operator skill | 无法支持算子开发 | 研发线 |
| 缺少 profiling skill | 无法做性能剖析 | 研发线 |
| 缺少 diagnostics skill | 无法做问题定位 | 研发线 |
| 缺少源码工作区模型 | 研发线无统一 schema | 研发线骨架 |
| 缺少结构化 artifacts | 分析/回归只能靠日志 | 研发线骨架 |
| 缺少 baseline compare | 无法对比历史/CUDA | 研发线骨架 |

---

## 2. 演进目标

### 目标定义

从"环境部署与 AI workload 交付平台"升级为"交付 + 研发双模平台"。

### 为什么不能继续用线性路线

**当前路线问题**：

1. **当前底座已够支撑上层能力**，不再是"从 0 到 1"状态
2. **线性路线会把研发能力持续后置**：env→assets→workload→benchmark→migration 无法自然长出算子开发、性能剖析能力
3. **研发能力与交付能力共享底座**，但上层目标不同，需要并行演进而非串行等待
4. **因此改为双线并行**：V2A 交付线 + V2B 研发线

### 目标 1：交付平台线（V2A）

**定义**：环境、资产、workload、服务验证、多机交付

**当前完成度**：60%

已具备：本地/远程执行、状态追踪、文档驱动执行
缺失：workload skill、多机编排、服务验证

### 目标 2：研发性能平台线（V2B）

**定义**：算子开发、构建验证、性能剖析、问题诊断、基线对比

**当前完成度**：0%

缺失：operator/profiling/diagnostics skill 集、dev_workspace schema、artifact schema、baseline compare system

---

## 3. Skill 目录分类结构

随着双线演进，目录结构扩展为：

```
skills/
├── env/                              # 环境相关 skill
│   ├── deploy_musa_base_env/         # meta skill: 完整环境部署
│   ├── update_musa_driver/           # 用户意图入口: 驱动更新
│   ├── ensure_system_dependencies/   # 确保系统依赖已安装
│   ├── ensure_musa_driver/           # 状态驱动入口: 确保驱动状态
│   ├── ensure_mt_container_toolkit/  # 确保容器工具包
│   ├── manage_container_images/      # 准备运行时镜像
│   └── validate_musa_container_environment/  # 容器环境验证
│
├── assets/                           # 资产准备相关 skill
│   ├── prepare_musa_package/         # MUSA 软件包获取（驱动、toolkit 等）
│   ├── prepare_model_artifacts/      # 模型文件准备
│   ├── prepare_dataset_artifacts/    # 数据集准备
│   └── prepare_dependency_repo/      # 依赖仓库准备
│
├── workload/                         # workload 运行相关 skill（交付线 V2A）
│   ├── run_inference_workload/       # 运行推理 workload
│   ├── run_training_workload/        # 运行训练 workload
│   ├── start_model_service/          # 启动模型服务
│   ├── validate_inference_service/   # 验证推理服务
│   └── validate_training_job/        # 验证训练任务
│
├── operator/                         # 算子开发相关 skill（研发线 V2B）
│   ├── prepare_operator_workspace/   # 准备算子开发工作区
│   ├── build_torch_musa_extension/   # 编译 torch_musa 扩展
│   ├── run_operator_correctness_tests/  # 算子正确性测试
│   ├── run_operator_regression_suite/   # 算子回归测试
│   ├── build_cpp_musa_operator/      # 编译 C++/MUSA 算子
│   └── validate_custom_operator/     # 验证自定义算子
│
├── profiling/                        # 性能剖析相关 skill（研发线 V2B）
│   ├── profile_operator_latency/     # 算子延迟剖析
│   ├── profile_training_step/        # 训练步骤剖析
│   ├── capture_musa_timeline/        # MUSA 时间线采集
│   ├── collect_kernel_hotspots/      # Kernel 热点收集
│   └── compare_profile_baseline/     # 与基线对比
│
├── diagnostics/                      # 问题诊断相关 skill（研发线 V2B）
│   ├── diagnose_runtime_failure/     # 运行时失败诊断
│   ├── diagnose_accuracy_diff/       # 精度差异诊断
│   ├── diagnose_op_fallback/         # OP 回退诊断
│   ├── diagnose_memory_issue/        # 内存问题诊断
│   └── diagnose_collective_comm_issue/  # 集合通信问题诊断
│
├── benchmark/                        # 性能验证 skill（V3）
│   ├── benchmark_compute/            # 算力基准测试
│   ├── benchmark_bandwidth/          # 带宽测试
│   ├── benchmark_p2p/                # P2P 通信测试
│   ├── benchmark_collective_comm/    # 集合通信测试
│   └── benchmark_inference_baseline/ # 推理基准测试
│
└── migration/                        # CUDA 迁移 skill（V3）
    ├── scan_cuda_project/            # 扫描 CUDA 项目
    ├── analyze_musa_compatibility/   # 分析 MUSA 兼容性
    ├── adapt_cuda_project/           # 适配 CUDA 项目
    └── build_and_validate_musa_project/  # 构建验证 MUSA 项目
```

### 分类原则

| 分类 | 职责 | 演进阶段 | 归属线 |
|------|------|----------|--------|
| `env/` | 基础设施部署、环境配置 | V1（已完成） | 共享底座 |
| `assets/` | 宿主机安装包、模型、数据集、依赖仓库准备 | V1（已完成） | 共享底座 |
| `workload/` | 训练/推理 workload 运行 | V2A | 交付线 |
| `operator/` | 算子开发与构建验证 | V2B | 研发线 |
| `profiling/` | 性能剖析与基线对比 | V2B | 研发线 |
| `diagnostics/` | 问题诊断与根因分析 | V2B | 研发线 |
| `benchmark/` | 性能验证 | V3 | 高级能力 |
| `migration/` | CUDA→MUSA 迁移 | V3 | 高级能力 |

### skills/index.yml 分层维度

`skills/index.yml` 使用**三个正交维度**进行分层：

**维度一：category（目录分类）**
- `env` / `assets` / `workload` / `operator` / `profiling` / `diagnostics` / `benchmark` / `migration`
- 对应目录结构，决定 skill 的物理位置

**维度二：kind（执行粒度）**
- `atomic` - 原子 skill，可独立执行
- `meta` - 组合 skill，编排其他 skill

**维度三：exposure（暴露方式）**
- `user` - 用户意图入口，用户直接调用
- `internal` - 状态驱动入口，被其他 skill 调用

---

## 4. 演进路线

### 路线总览

```
V1.5：底座收口（让底座可信）
    ↓
V2A：交付平台线 ←→ V2B：研发性能平台线（双线并行，共享同一 runtime 底座）
    ↓
V3：统一 MUSA 软件栈平台（让平台变强）
```

**关键说明**：V2A 与 V2B 不是两个独立平台，而是基于同一 runtime 底座的两条并行能力主线。

---

### 4.1 V1.5：底座收口

**目标**：让底座可信，支撑后续双线演进。

**收口项目**（详见 `docs/phase1-implementation-plan.md`）：

| 项目 | 说明 |
|------|------|
| intent 单一事实源 | enum 从 `skills/index.yml` 动态派生 |
| StateManager 拆分 | 拆分为 host/operation/job/document/persistence store |
| 核心模块测试补齐 | state-manager / ssh-client 测试覆盖 |
| probeAllHosts 做实 | 完成 SSH reachability 测试 |
| 重复代码收敛 | utils / ssh 执行逻辑统一 |

**验收标准**：
- 状态边界清晰
- intent 路由唯一事实源
- 核心骨架可测试
- 多机/远程探测语义可信

---

### 4.2 V2A：交付平台线

**定义**：环境、资产、workload、服务验证、多机交付

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

#### C. 多机编排

**架构位置**：多机编排在 dispatcher 之上，不在 dispatcher 内部实现。

**执行模型**：

```
deploy_musa_base_env(hosts: ["gpu-01", "gpu-02", "gpu-03"])
  │
  ├─ fan-out: ensure_musa_driver → [gpu-01, gpu-02, gpu-03] (parallel)
  │
  ├─ fan-out: ensure_mt_container_toolkit → [gpu-01, gpu-02, gpu-03] (parallel)
  │
  └─ aggregate: per-host success/failure report
```

**数据模型**：

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

#### D. 外部文档源（Stage 1B）

支持飞书/钉钉文档拉取：
- 鉴权（OAuth / App Token）
- 归一化（HTML/Docx → Markdown）
- 重试机制

---

### 4.3 V2B：研发性能平台线

**定义**：算子开发、构建验证、性能剖析、问题诊断、基线对比

**核心定位**：服务 torch_musa / CPP 算子研发，而非只做部署。

#### A. 研发能力域

详见第 5 节"研发性能平台线详细设计"。

#### B. 核心缺失能力

详见第 6 节"核心缺失能力"。

---

### 4.4 V3：统一 MUSA 软件栈平台

**目标**：让平台变强，整合交付、研发、迁移、benchmark。

#### A. Benchmark 平台化

结构化输出：

```json
{
  "latency": { "p50": 10, "p99": 50 },
  "throughput": 1000,
  "bandwidth": "32 GB/s",
  "tflops": 50.5,
  "environment_fingerprint": {
    "host": "gpu-01",
    "driver": "3.3.5",
    "sdk": "4.3.5",
    "container_image": "torch_musa:4.3.5",
    "torch_version": "2.9.0",
    "torch_musa_version": "4.3.5",
    "commit_sha": "abc123",
    "build_flags": "-O2"
  },
  "threshold": { "pass": true }
}
```

#### B. CUDA→MUSA 迁移

四步能力：

| Skill | 职责 |
|-------|------|
| `scan_cuda_project` | 识别构建系统、CUDA 依赖、关键源文件 |
| `analyze_musa_compatibility` | API 替换建议、算子兼容风险 |
| `adapt_cuda_project` | 生成 patch、编译配置、环境脚本 |
| `build_and_validate_musa_project` | 构建、运行 smoke test、输出报告 |

---

## 5. 研发性能平台线详细设计

### 5.1 operator 域

聚焦算子和扩展开发：

| Skill | 职责 | 输入 | 输出 |
|-------|------|------|------|
| `prepare_operator_workspace` | 准备算子开发工作区 | dev_workspace spec | 工作区路径、Python 环境 |
| `build_torch_musa_extension` | 编译 torch_musa 扩展 | 源码路径、build 配置 | wheel/so 文件、编译日志 |
| `run_operator_correctness_tests` | 算子正确性测试 | 测试集、目标算子 | correctness artifact |
| `run_operator_regression_suite` | 算子回归测试 | 测试集、baseline | regression report |
| `build_cpp_musa_operator` | 编译 C++/MUSA 算子 | 源码路径、CMake 配置 | so 文件、编译日志 |
| `validate_custom_operator` | 验证自定义算子 | 算子文件、测试输入 | correctness artifact |

---

### 5.2 profiling 域

聚焦性能剖析：

| Skill | 职责 | 输入 | 输出 |
|-------|------|------|------|
| `profile_operator_latency` | 算子延迟剖析 | 算子、输入 shape | performance artifact |
| `profile_training_step` | 训练步骤剖析 | 训练脚本、step 数 | performance artifact |
| `capture_musa_timeline` | MUSA 时间线采集 | 容器、workload | profile artifact |
| `collect_kernel_hotspots` | Kernel 热点收集 | profile artifact | hotspot report |
| `compare_profile_baseline` | 与基线对比 | 当前 profile、baseline id | diff report |

---

### 5.3 diagnostics 域

聚焦问题定位：

> **输入工件来源**：diagnostics 域的多数 skill 以已有执行工件为输入，而非独立从空状态启动。

| Skill | 职责 | 输入工件 |
|-------|------|----------|
| `diagnose_runtime_failure` | 运行时失败诊断 | 日志、stderr、stack trace |
| `diagnose_accuracy_diff` | 精度差异诊断 | correctness artifact |
| `diagnose_op_fallback` | OP 回退诊断 | profile artifact、runtime logs |
| `diagnose_memory_issue` | 内存问题诊断 | timeline、memory stats |
| `diagnose_collective_comm_issue` | 集合通信问题诊断 | MCCL logs、profile artifact |

---

### 5.4 develop_musa_operator Meta Skill

**研发模式主入口**，编排完整的算子开发闭环：

```
develop_musa_operator 编排流程:
1. prepare_dependency_repo
2. prepare_operator_workspace
3. build_torch_musa_extension / build_cpp_musa_operator
4. run_operator_correctness_tests
5. profile_operator_latency
6. compare_profile_baseline
7. generate_operator_report（分阶段）
```

**report 分阶段说明**：
- **初期**：执行结果先沉淀为结构化 artifacts
- **后续**：再统一生成 operator report

---

## 6. 核心缺失能力

研发线缺的不是 skill 数量，而是 4 个"平台级能力骨架"。

### 6.1 源码工作区模型（dev_workspace schema）

定义统一的开发工作区规范：

```yaml
dev_workspace:
  repo_path: /workspace/torch_musa
  build_dir: /workspace/torch_musa/build
  python_env: /opt/conda/envs/torch_musa_dev
  patches:
    - patches/op_fix.patch
  targets:
    - aten::add
    - custom::my_op
  test_suites:
    - test/test_ops.py::test_add
    - benchmarks/op_bench.py
```

**作用**：
- 算子开发有统一 schema
- 构建配置可追溯
- 测试集与目标算子关联

---

### 6.2 编译-测试-分析闭环

完整的算子研发闭环：

```
prepare workspace
→ apply patch
→ build extension / build torch_musa
→ run correctness tests
→ run perf microbench
→ capture traces
→ compare baseline
→ generate report（分阶段）
```

**初期目标**：执行结果沉淀为结构化 artifacts
**后续目标**：统一生成 operator report

---

### 6.3 结构化性能工件（artifact schema）

三类 artifact 必须包含 **environment fingerprint**：

```yaml
# Correctness Artifact
correctness_artifact:
  test_case: "test/test_ops.py::test_add"
  input:
    shape: [1024, 1024]
    dtype: float32
  expected: "tensor([[...]])"
  actual: "tensor([[...]])"
  max_diff: 1e-6
  pass: true
  environment_fingerprint:
    host: "gpu-01"
    driver_version: "3.3.5"
    toolkit_sdk_version: "4.3.5"
    container_image: "torch_musa:4.3.5"
    torch_version: "2.9.0"
    torch_musa_version: "4.3.5"
    commit_sha: "abc123"
    build_flags: "-O2"

# Performance Artifact
performance_artifact:
  latency:
    p50: 10.5
    p95: 12.3
    p99: 15.0
  throughput: 1000
  kernel_breakdown:
    - kernel: "add_kernel"
      time_ms: 5.2
      calls: 100
  environment_fingerprint:
    host: "gpu-01"
    driver_version: "3.3.5"
    toolkit_sdk_version: "4.3.5"
    container_image: "torch_musa:4.3.5"
    torch_version: "2.9.0"
    torch_musa_version: "4.3.5"
    commit_sha: "abc123"
    build_flags: "-O2"

# Profile Artifact
profile_artifact:
  timeline_path: "/workspace/profiles/timeline.json"
  top_kernels:
    - name: "add_kernel"
      time_ms: 52.3
      percentage: 35
  memcpy_compute_ratio:
    memcpy: 20
    compute: 80
  launch_count: 1000
  fallback_markers:
    - "aten::add → CPU fallback"
  environment_fingerprint:
    host: "gpu-01"
    driver_version: "3.3.5"
    toolkit_sdk_version: "4.3.5"
    container_image: "torch_musa:4.3.5"
    torch_version: "2.9.0"
    torch_musa_version: "4.3.5"
    commit_sha: "abc123"
    build_flags: "-O2"
```

**作用**：
- profile、correctness、baseline 可真正对比
- 问题诊断有结构化输入

---

### 6.4 Baseline 对比系统

支持多维度对比：

| 对比维度 | 说明 |
|----------|------|
| 历史版本对比 | 同一算子不同 commit 对比 |
| 环境对比 | 同一 workload 不同 driver/sdk/image 对比 |
| CUDA vs MUSA | CUDA baseline 与 MUSA 实现对比 |
| patch 前后对比 | 优化前后对比 |

**初期实现**：本地 JSON 或目录结构
**后续扩展**：数据库存储

---

## 7. 实施优先级

### P0：让底座可信

| 项目 | 预估工时 | 说明 |
|------|----------|------|
| intent 单一事实源 | 1-2 天 | enum 从 index.yml 动态派生 |
| StateManager 拆分 | 3-4 天 | 拆分为 5 个独立 store |
| 核心模块测试补齐 | 2-3 天 | state-manager / ssh-client |
| probeAllHosts 做实 | 1 天 | SSH reachability 测试 |
| 重复代码收敛 | 1 天 | utils / ssh 统一 |

---

### P1：让双线跑起来

**交付线（V2A）**：

| 项目 | 预估工时 | 说明 |
|------|----------|------|
| Workload Spec 定义 | 2-3 天 | 统一 workload 规范 |
| Workload skills（5 个） | 7-10 天 | run_training/run_inference 等 |
| 多机 fan-out | 5-6 天 | inventory/role/fan-out 执行器 |
| 外部文档源 | 4-6 天 | 飞书/钉钉文档拉取 |

**研发线（V2B）**：

| 项目 | 预估工时 | 说明 |
|------|----------|------|
| operator 目录与 schema | 2-3 天 | dev_workspace model |
| 编译-测试-分析闭环 | 3-4 天 | develop_musa_operator meta skill |
| 结构化 artifacts | 2-3 天 | correctness/performance/profile schema |
| baseline compare | 2-3 天 | 对比系统基础版 |

---

### P2：让平台变强

| 项目 | 预估工时 | 说明 |
|------|----------|------|
| benchmark 套件平台化 | 5-7 天 | 结构化输出、报告生成 |
| CUDA→MUSA 迁移 | 7-10 天 | scan/analyze/adapt/build |
| 更完整的 profile/诊断报告 | 3-4 天 | 报告生成增强 |

---

## 8. 验收检查清单

### V1.5 底座收口

- [ ] intent enum 从 index.yml 动态派生
- [ ] StateManager 拆分为 5 个独立 store
- [ ] state-manager / ssh-client 测试覆盖
- [ ] probeAllHosts 完成 SSH reachability 测试
- [ ] utils / ssh 执行逻辑统一

### V2A 交付线

- [ ] Workload Spec 定义完成
- [ ] 训练/推理 workload 可运行
- [ ] 多机 fan-out 执行可用
- [ ] 飞书/钉钉文档源可用
- [ ] 端到端验证通过

### V2B 研发线

- [ ] dev_workspace schema 定义完成
- [ ] operator/profiling/diagnostics 目录就位
- [ ] develop_musa_operator meta skill 可用
- [ ] artifact schema 含 environment fingerprint
- [ ] baseline compare 可用
- [ ] 算子开发闭环跑通

### V3 高级能力

- [ ] Benchmark 报告结构化输出
- [ ] CUDA 项目迁移流程跑通
- [ ] 性能对比报告可用

---

## 附录：已实现能力关键代码

### 统一调度器

文件：`src/dispatcher/index.ts`

- Intent 解析、权限门控、Resume 语义检查
- `dispatch()` 函数实现完整流程
- 支持的 intent：`deploy_env`, `update_driver`, `gpu_status`, `run_container`, `validate`, `sync`, `auto`, `execute_document`, `prepare_model`, `prepare_dataset`, `prepare_package`, `prepare_repo`

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

### Skill 索引

文件：`skills/index.yml`

- 11 个 skill 已注册
- 已有 `dispatch_intent` 和 `dispatch_entry` 映射
- 包含 inputs/outputs 定义