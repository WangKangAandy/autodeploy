# openclaw-musa 框架设计

## 设计原则

1. **Skill 是知识，代码是工具** — SKILL.md 描述"做什么、怎么做"，src/ 提供执行能力
2. **LLM 是大脑，不是流水线** — 不硬编码工作流，用执行合同约束行为
3. **知识可沉淀、可检索** — 每次操作的经验写入 knowledge/，OpenClaw memory_search 自动索引
4. **复用 OpenClaw 原生能力** — skill 发现、memory search、cron、飞书集成，不重复造轮子

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      OpenClaw Platform                       │
│                                                             │
│  ┌─────────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Native Skills    │  │ Memory Search│  │ Channel       │  │
│  │ (auto-discover)  │  │ (hybrid BM25 │  │ (飞书/Telegram │  │
│  │                  │  │  + vector)   │  │  /webchat)    │  │
│  └────────┬─────────┘  └──────┬───────┘  └───────┬───────┘  │
│           │                   │                   │          │
│  ┌────────┴───────────────────┴───────────────────┴───────┐  │
│  │                    LLM Agent                            │  │
│  │                                                        │  │
│  │  AGENTS.md (注入的平台规则)                               │  │
│  │  Runtime Context (adapter hook 注入的实时状态)             │  │
│  │  Knowledge (memory_search 检索结果)                      │  │
│  │                                                        │  │
│  │  决策：读哪个 SKILL.md → 用哪个工具执行                    │  │
│  └────────┬───────────────────────────────────────────────┘  │
│           │                                                  │
│  ┌────────┴───────────────────────────────────────────────┐  │
│  │              openclaw-musa Plugin (src/)                │  │
│  │                                                        │  │
│  │  Tools:                                                │  │
│  │    musa_exec     — SSH 远程/本地命令执行                  │  │
│  │    musa_docker   — Docker 操作                          │  │
│  │    musa_sync     — 文件同步                              │  │
│  │    musa_dispatch — 操作生命周期 + 执行合同                 │  │
│  │                                                        │  │
│  │  Core:                                                 │  │
│  │    executor      — local/remote 模式自动切换              │  │
│  │    ssh-client    — SSH 连接管理                          │  │
│  │    state-manager — 操作/主机状态持久化                     │  │
│  │                                                        │  │
│  │  Adapter:                                              │  │
│  │    context-builder — 运行时状态注入 LLM 上下文             │  │
│  │    inject-manager  — AGENTS.md/IDENTITY.md 注入          │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Skill 体系

Skills 放在 `skills/` 目录，OpenClaw 原生 skill 发现机制自动扫描并注入 system prompt。
不需要 index.yml 或 skill-registry 代码。

```
skills/
  env/                         ← 环境部署（已有，11 个）
    deploy_musa_base_env/
    ensure_musa_driver/
    ensure_mt_container_toolkit/
    ...

  assets/                      ← 资源管理（已有）
    prepare_musa_package/
    prepare_model_artifacts/
    prepare_dataset_artifacts/
    ...

  migration/                   ← CUDA→MUSA 迁移（新增）
    analyze_cuda_code/         ← 分析 CUDA 项目结构、API、依赖
    map_cuda_to_musa_api/      ← CUDA→MUSA API 映射
    port_source_code/          ← 源码转换（SimplePorting + Python）
    adapt_build_system/        ← 构建系统适配（CMake/setup.py/Makefile）
    build_and_fix/             ← 编译→报错→修复循环
    verify_migration/          ← 功能验证 + 数值对比

  workload/                    ← 工作负载（新增）
    run_training/              ← 训练任务
    run_inference/             ← 推理任务
    run_benchmark/             ← 基准测试

  optimization/                ← 性能优化（新增）
    profile_gpu/               ← GPU profiling
    optimize_training/         ← 训练优化
    optimize_inference/        ← 推理优化
    optimize_memory/           ← 显存优化
```

### Skill 协同方式

Skills 之间不直接调用。协同靠两个机制：

1. **LLM 是调度者** — 执行完一个 skill 后，根据结果决定读下一个 skill
2. **共享文件是通信渠道** — skill A 的输出写到文件，skill B 读这个文件

示例（迁移流程）：
```
analyze_cuda_code → 输出 CODE_ANALYSIS.md
    ↓ LLM 读 CODE_ANALYSIS.md
map_cuda_to_musa_api → 输出 API_MAPPING.md
    ↓ LLM 读 API_MAPPING.md
port_source_code → 修改源码
    ↓
adapt_build_system → 修改构建文件
    ↓
build_and_fix → 编译/修错循环
    ↓
verify_migration → 验证通过
```

## 知识层

### 不写代码，复用 OpenClaw memory_search

OpenClaw 内置 memory search 支持：
- BM25 + 向量混合搜索
- 时间衰减（新知识权重更高）
- MMR 去重
- extraPaths（索引 workspace 外的目录）

只需要在 openclaw.json 配置：

```json5
agents: {
  defaults: {
    memorySearch: {
      provider: "openai",
      query: {
        hybrid: {
          enabled: true,
          vectorWeight: 0.7,
          textWeight: 0.3,
          temporalDecay: { enabled: true, halfLifeDays: 90 },
          mmr: { enabled: true }
        }
      },
      extraPaths: ["./knowledge/base", "./knowledge/learned"]
    }
  }
}
```

### 知识目录

```
knowledge/
  base/                        ← 基础知识（手动维护，随仓库版本化）
    cuda-musa-mapping.md       ← API 映射表
    known-issues.md            ← 已知问题 + 解决方案
    gpu-specs.md               ← GPU 型号/规格
    best-practices.md          ← 最佳实践
    sdk-versions.md            ← SDK 版本兼容矩阵

  learned/                     ← 沉淀知识（LLM 执行后自动写入）
    migration-fixes/           ← 迁移中发现的 fix
    build-errors/              ← 编译错误和解法
    performance-tips/          ← 性能优化经验
    deployment-notes/          ← 部署踩坑记录
```

### 知识沉淀流程

```
LLM 迁移过程中发现：cudaMemcpy → musaMemcpy 还需要改 stream 参数
    ↓
LLM 用 write 工具写入：
  knowledge/learned/migration-fixes/cudaMemcpy-stream-param.md
    ↓
OpenClaw memory_search 自动索引（watcher + debounce）
    ↓
下次有人遇到同样问题 → memory_search 命中 → LLM 直接给出解法
```

### 知识问答流程

```
用户（飞书群）："MUSA 上跑 flash attention 报错"
    ↓
OpenClaw 收到消息
    ↓
LLM 调用 memory_search("MUSA flash attention error")
    ↓
命中 knowledge/base/known-issues.md 和 knowledge/learned/build-errors/flash-attn.md
    ↓
LLM 组织回答，引用知识来源
```

## src/ 代码模块（当前）

```
src/ (3637 行)
  index.ts              (181) ← 插件入口
  core/
    state-manager.ts    (512) ← 状态持久化：hosts + operations + tool executions
    ssh-client.ts       (172) ← SSH 远程执行
    executor.ts          (86) ← local/remote 模式切换
    local-exec.ts        (94) ← 本地命令执行
    docker-builder.ts    (58) ← Docker 命令构建
    utils.ts            (102) ← 工具函数
  tools/
    musa-exec.ts        (353) ← musa_set_mode + musa_exec + musa_get_mode
    musa-docker.ts      (162) ← musa_docker
    musa-sync.ts        (117) ← musa_sync
    index.ts             (22) ← 工具注册汇总
  dispatcher/
    index.ts            (324) ← 操作生命周期 + 执行合同
  adapter/
    context-builder.ts   (75) ← 运行时上下文注入
    hooks.ts            (102) ← before_prompt_build hook
    index.ts              (7) ← 导出
  utils/
    inject-manager.ts   (380) ← AGENTS.md/IDENTITY.md/BOOTSTRAP.md 注入
    agents-merge.ts     (151) ← AGENTS.md 合并
  shared/
    trace.ts            (305) ← tracing
    logger.ts           (283) ← 日志
    lark-ticket.ts      (104) ← 飞书 ticket
    index.ts             (47) ← 导出
```

### 不需要改代码的扩展

| 扩展方向 | 怎么做 | 改代码？ |
|---------|--------|---------|
| 加迁移能力 | 写 `skills/migration/*/SKILL.md` | 否 |
| 加训练/推理能力 | 写 `skills/workload/*/SKILL.md` | 否 |
| 加优化能力 | 写 `skills/optimization/*/SKILL.md` | 否 |
| 加知识问答 | 写 `knowledge/base/*.md` + 配 memorySearch | 否 |
| 知识自动沉淀 | AGENTS.md 注入规则："执行完后写 knowledge/learned/" | 否 |
| 定时巡检 | 配 OpenClaw cron | 否 |
| 飞书群问答 | 已有（飞书 channel 已配置） | 否 |

### 需要写代码的扩展（仅当需要新工具时）

| 场景 | 什么时候需要 |
|------|------------|
| 新增远程执行工具 | 当 musa_exec/docker/sync 不够用时 |
| 对接外部系统 | 比如对接 Jira/Confluence API |
| 复杂状态追踪 | 比如跨多台机器的部署进度 |

## 扩展路线

### Phase 1 ✅（当前完成）
- [x] env skills（环境部署）
- [x] assets skills（资源管理）
- [x] 执行层（musa_exec/docker/sync）
- [x] 状态管理
- [x] 上下文注入
- [x] 执行合同
- [x] 飞书集成

### Phase 2（下一步）
- [ ] knowledge/base/ 基础知识文档
- [ ] memorySearch 配置（hybrid search + extraPaths）
- [ ] migration skills（CUDA→MUSA 迁移）
- [ ] AGENTS.md 注入知识沉淀规则

### Phase 3
- [ ] workload skills（训练/推理任务管理）
- [ ] optimization skills（GPU profiling + 优化）
- [ ] 知识沉淀自动化（learned/ 目录积累）

### Phase 4
- [ ] 多机器并行部署
- [ ] 迁移报告自动生成
- [ ] 知识库质量维护（定期 cron 清理过时知识）
