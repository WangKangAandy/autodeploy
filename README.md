# openclaw-musa

OpenClaw 平台运行时基座，为 MUSA GPU 环境部署和管理提供底层能力。

## 核心价值

本仓库是 OpenClaw 的平台运行时层，通过以下四层能力构建，将普通插件演变为"主动注入认知的运行时基座"：

```
┌─────────────────────────────────────────────────────────────────┐
│  阶段 1: 工具集合 → 阶段 2: 调度层 → 阶段 3: 运行时基座          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    四大核心能力                                  │
├─────────────────────────────────────────────────────────────────┤
│  1. Static Rules    — AGENTS.autodeploy.md 自动合并注入         │
│  2. Dynamic Context — before_prompt_build hook 动态上下文注入    │
│  3. Dispatcher      — musa_dispatch 统一意图路由                 │
│  4. State Manager   — 部署状态持久化与恢复                       │
└─────────────────────────────────────────────────────────────────┘
```

| 能力 | 机制 | 注入点 |
|------|------|--------|
| Static Rules | AGENTS.md 合并 | `~/.openclaw/workspace/AGENTS.md` |
| Dynamic Context | before_prompt_build hook | 每次对话构建时 |
| Dispatcher | musa_dispatch tool | 手动/自动调用 |
| State Manager | JSON 持久化 | `~/.openclaw/workspace/autodeploy/` |

详细设计文档：[docs/runtime-platform-evolution.md](docs/runtime-platform-evolution.md)

## 快速开始

### 安装

```bash
npm install
npm run build  # 编译 TypeScript 模块
```

### 配置远程访问

```bash
cp agent-tools/config/remote-ssh.env.example agent-tools/config/remote-ssh.env
# 编辑配置文件
```

必需变量：

```env
GPU_HOST=<remote-gpu-ip>
GPU_USER=<ssh-username>
GPU_SSH_PASSWD=<ssh-password>
MY_SUDO_PASSWD=<optional-sudo-password>
GPU_PORT=22
TORCH_MUSA_DOCKER_IMAGE=<default-docker-image>
```

### 安装为 OpenClaw 插件

```bash
# 开发模式（链接到源码）
openclaw plugins install -l /path/to/autodeploy

# 验证安装
openclaw plugins info openclaw-musa
```

## 统一调度器

`musa_dispatch` 是所有 MUSA 操作的统一入口：

| Intent | 描述 | 风险级别 |
|--------|------|----------|
| `deploy_env` | 完整 MUSA 环境部署 | destructive |
| `update_driver` | 驱动操作 | destructive |
| `gpu_status` | GPU 状态检查 | read_only |
| `validate` | 环境验证 | read_only |
| `execute_document` | 文档驱动部署 | destructive |

### 文档驱动执行

支持从 Markdown 文档执行部署：

```javascript
// 从本地文件
musa_dispatch(intent="execute_document", context={path: "/path/to/deploy.md"})

// 从粘贴内容
musa_dispatch(intent="execute_document", context={content: "# Guide\n..."})
```

详见：[references/document-driven-execution.md](references/document-driven-execution.md)

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway                         │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐  │
│  │                  openclaw-musa Plugin                 │  │
│  │                                                      │  │
│  │  ┌────────────────┐  ┌────────────────┐             │  │
│  │  │ Static Rules   │  │ Dynamic Ctx    │             │  │
│  │  │ (AGENTS.md)    │  │ (Hook)         │             │  │
│  │  └────────────────┘  └────────────────┘             │  │
│  │                                                      │  │
│  │  ┌────────────────┐  ┌────────────────┐             │  │
│  │  │   Dispatcher   │  │ State Manager  │             │  │
│  │  │ (musa_dispatch)│  │ (JSON 持久化)   │             │  │
│  │  └────────────────┘  └────────────────┘             │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    agent-tools/                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ core/executors.ts                                    │  │
│  │ - execRemote(config, command)                        │  │
│  │ - execDocker(config, args)                           │  │
│  │ - syncFiles(config, args)                            │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Remote MT-GPU Machine                       │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │ Host (via SSH)  │  │ Docker Containers (MUSA SDK)    │  │
│  └─────────────────┘  └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 仓库结构

| 路径 | 用途 |
|------|------|
| `index.js` | OpenClaw 插件入口 |
| `src/dispatcher/` | 统一调度器 (`musa_dispatch`) |
| `src/adapter/` | OpenClaw 适配器 hooks |
| `src/core/state-manager.ts` | 状态持久化 |
| `src/utils/agents-merge.js` | AGENTS.md 合并逻辑 |
| `src/document/` | 文档驱动执行引擎 |
| `AGENTS.autodeploy.md` | 平台静态规则（自动合并到 workspace） |
| `agent-tools/` | MCP 工具层，提供 remote-exec/docker/sync |
| `skills/` | 可执行技能定义 |
| `references/` | 非执行性知识资源 |

## 可用技能

| 技能 | 描述 | 触发模式 |
|------|------|----------|
| `deploy_musa_base_env` | 完整 MUSA 环境部署 | "部署 MUSA 环境", "install MUSA SDK" |
| `update_musa_driver` | 驱动更新/重装 | "更新驱动", "upgrade driver" |

## 验证命令

### 主机验证

```bash
mthreads-gmi
```

### 容器工具链验证

```bash
docker run --rm --env MTHREADS_VISIBLE_DEVICES=all \
  registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi
```

### 容器内验证

```bash
docker exec torch_musa_test musaInfo
docker exec torch_musa_test python -c "import torch; print(torch.musa.is_available())"
```

## 运行测试

```bash
# 根目录测试
npm test

# agent-tools 测试
cd agent-tools && npm test
```

## 部署范围

默认自动化范围仅限基础环境：

- 系统依赖
- MUSA 驱动
- MT 容器工具链
- Docker 镜像准备
- 容器验证

muDNN、MCCL、Triton 等额外组件不在默认范围内，需显式请求。

## 推荐阅读顺序

1. [docs/runtime-platform-evolution.md](docs/runtime-platform-evolution.md) — 运行时基座构建过程
2. [references/remote-execution-policy.md](references/remote-execution-policy.md) — 本地/远程命令路由策略
3. [skills/deploy_musa_base_env/SKILL.md](skills/deploy_musa_base_env/SKILL.md) — 完整部署工作流
4. [references/container-validation-runbook.md](references/container-validation-runbook.md) — 容器验证故障排查

## License

MIT