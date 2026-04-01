# openclaw-musa

OpenClaw 平台运行时基座，为 MUSA GPU 环境部署和管理提供底层能力。

## 核心能力

```
┌─────────────────────────────────────────────────────────────────┐
│                    三大核心能力                                  │
├─────────────────────────────────────────────────────────────────┤
│  1. Static Rules    — AGENTS.autodeploy.md 自动合并注入         │
│  2. Dynamic Context — before_prompt_build hook 动态上下文注入    │
│  3. State Manager   — 部署状态持久化与恢复                       │
└─────────────────────────────────────────────────────────────────┘
```

| 能力 | 机制 | 注入点 |
|------|------|--------|
| Static Rules | AGENTS.md 合并 | `~/.openclaw/workspace/AGENTS.md` |
| Dynamic Context | before_prompt_build hook | 每次对话构建时 |
| State Manager | JSON 持久化 | `~/.openclaw/workspace/autodeploy/` |

## 快速开始

### 安装

```bash
npm install
npm run build  # 编译 TypeScript 模块
```

### 安装为 OpenClaw 插件

```bash
# 开发模式（链接到源码）
openclaw plugins install -l /path/to/autodeploy

# 验证安装
openclaw plugins info openclaw-musa
```

## 工具集

| 工具 | 用途 |
|------|------|
| `musa_mode` | 获取/设置部署模式 (local/remote) |
| `musa_exec` | 执行主机命令 |
| `musa_docker` | Docker 容器操作 |
| `musa_sync` | 文件传输 |

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
│  │  ┌────────────────────────────────────┐             │  │
│  │  │        State Manager               │             │  │
│  │  │        (JSON 持久化)                │             │  │
│  │  └────────────────────────────────────┘             │  │
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
| `src/adapter/` | OpenClaw 适配器 hooks |
| `src/core/state-manager.ts` | 状态持久化 |
| `src/utils/inject-manager.js` | AGENTS.md 合并逻辑 |
| `src/tools/` | musa_* 工具定义 |
| `inject/` | 注入源文件 |
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
npm test
```

## 部署范围

默认自动化范围仅限基础环境：

- 系统依赖
- MUSA 驱动
- MT 容器工具链
- Docker 镜像准备
- 容器验证

muDNN、MCCL、Triton 等额外组件不在默认范围内，需显式请求。

## 推荐阅读

1. [references/remote-execution-policy.md](references/remote-execution-policy.md) — 本地/远程命令路由策略
2. [skills/deploy_musa_base_env/SKILL.md](skills/deploy_musa_base_env/SKILL.md) — 完整部署工作流
3. [references/container-validation-runbook.md](references/container-validation-runbook.md) — 容器验证故障排查

## License

MIT