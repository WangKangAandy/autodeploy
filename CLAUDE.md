# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Available Skills

This repository contains executable automation skills. Match user requests to skills by trigger patterns.

| Skill | Description | Triggers |
|-------|-------------|----------|
| `deploy_musa_base_env` | Complete MUSA environment deployment | "部署 MUSA 环境", "install MUSA SDK", "full MUSA setup" |
| `update_musa_driver` | Driver-only update or reinstall | "更新驱动", "upgrade driver", "reinstall driver", "配置 GPU 驱动" |

**Skill Index:** `skills/index.yml` provides machine-readable skill definitions with inputs, outputs, and trigger patterns.

**Reference Documents:** `references/` contains non-executable knowledge resources (MOSS download guide, driver install guide, validation runbook, execution policy).

## Overview

This is an OpenClaw plugin for MUSA SDK environment deployment. It provides:
- OpenClaw plugin with `musa_*` tools for local/remote deployment
- MCP server (`agent-tools/`) for Claude Code integration via SSH
- Executable skills for full MUSA environment setup and driver management
- Feishu bot integration for AI-powered operations

## Architecture

The repository has two parallel tool implementations:

| Layer | Path | Protocol | Tools |
|-------|------|----------|-------|
| OpenClaw Plugin | `src/` | OpenClaw API | `musa_exec`, `musa_docker`, `musa_sync`, `musa_set_mode`, `musa_get_mode` |
| MCP Server | `agent-tools/src/` | MCP Protocol | `remote-exec`, `remote-docker`, `remote-sync` |

Both layers share the same execution model (local vs remote) and credentials.

## Repository Structure

| Path | Purpose |
|------|---------|
| `index.js` | OpenClaw plugin entry point |
| `src/core/` | Core executors: executor.js, ssh-client.js, local-exec.js |
| `src/tools/` | OpenClaw tool definitions (musa_*) |
| `agent-tools/src/core/` | MCP core executors (TypeScript) |
| `agent-tools/src/tools/` | MCP tool definitions (remote-*) |
| `agent-tools/src/server.ts` | MCP Server entry point |
| `feishu-claude-bridge/` | Feishu bot with Claude API integration |
| `skills/deploy_musa_base_env/SKILL.md` | Primary automated workflow for base environment deployment |
| `skills/update_musa_driver/SKILL.md` | Driver-only upgrade, downgrade, or reinstall workflow |
| `skills/deploy_musa_base_env/config/sdk_compatibility.yml` | SDK, driver, GPU, and image compatibility mapping |
| `references/` | Non-executable knowledge resources |

## Local Build Commands

### OpenClaw Plugin (root)
```bash
npm install
```

### Agent Tools (MCP Server)
```bash
cd agent-tools && npm install && npm run build
```

### Feishu Bridge
```bash
cd feishu-claude-bridge && npm install && npm run build
```

## Test Commands

```bash
# Agent Tools unit tests
cd agent-tools && npm test

# Feishu Bridge unit tests
cd feishu-claude-bridge && npm test
```

## Deployment Validation Commands

### Host validation
```bash
mthreads-gmi
```

### Container toolkit validation
```bash
docker run --rm --env MTHREADS_VISIBLE_DEVICES=all \
  registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi
```

### In-container validation
```bash
docker exec torch_musa_test musaInfo
docker exec torch_musa_test python -c "import torch; print(torch.musa.is_available()); print(torch.tensor(1, device='musa') + 1)"
```

## Remote Execution Architecture

The repo operates in a split-machine model:
- **Machine A (local)** — runs Claude Code/OpenCode, holds codebase, performs code analysis and editing
- **Remote MT-GPU Machine** — runs Docker containers with MUSA SDK, accessed via SSH

### Mode Management

Before executing remote commands, set the deployment mode:
- OpenClaw tools: Use `musa_set_mode(mode="remote", host, user, password, port)`
- MCP tools: Credentials are loaded from environment or config file

### Tool Routing (OpenClaw vs MCP)

| OpenClaw Tool | MCP Tool | Purpose |
|---------------|----------|---------|
| `musa_exec` | `remote-exec` | Execute shell commands on remote host via SSH |
| `musa_docker` | `remote-docker` | Execute commands in Docker containers (supports `docker exec` and `docker run`) |
| `musa_sync` | `remote-sync` | Sync files between local and remote via rsync |

### Command Routing Rules

Route commands to the appropriate tool based on target:

| Target | Tool | Parameters |
|--------|------|------------|
| `docker exec <container> <cmd>` | `musa_docker` / `remote-docker` | `name=<container>`, `command=<cmd>` |
| `docker run ... <image> <cmd>` | `musa_docker` / `remote-docker` | `image=<image>`, `command=<cmd>` |
| `docker cp`, `docker logs`, other docker commands | `musa_exec` / `remote-exec` | `command=<full docker command>` |
| Host commands (`dpkg`, `systemctl`, driver checks) | `musa_exec` / `remote-exec` | `command=<cmd>` |
| File transfer local ↔ remote | `musa_sync` / `remote-sync` | `localPath`, `remotePath`, `direction` |
| Local-only commands (`git`, file reads, code edits) | Standard tools | Bash, Read, Edit, Write |

**NEVER use Bash tool for Remote MT-GPU Machine commands.**

### Path Conventions

| Location | Path Pattern |
|----------|-------------|
| Machine A (local) | `repositories/<project-name>/` |
| Remote host | `~/workspace/<project-name>/` |
| Container | `/workspace/<project-name>/` |

The container mounts `~/workspace` → `/workspace` via `-v /home/${GPU_USER}/workspace:/workspace`.

### Credentials

**OpenClaw Plugin:** Credentials are set dynamically via `musa_set_mode` tool at runtime.

**MCP Server:** Credentials are loaded from:
1. Environment variables (`process.env`) — priority
2. `agent-tools/config/remote-ssh.env` — fallback (gitignored)

Required variables:
- `GPU_HOST` — Remote MT-GPU Machine hostname or IP
- `GPU_USER` — SSH username
- `GPU_SSH_PASSWD` — SSH password
- `GPU_PORT` — SSH port (default: 22)
- `GPU_WORK_DIR` — Default remote working directory (default: ~)
- `TORCH_MUSA_DOCKER_IMAGE` — Default Docker image for `remote-docker` one-shot runs

## Deployment Workflow Priority

When instructions conflict, prefer:
1. `skills/` workflow definitions
2. `references/` policy documents
3. `docs/` reference material

### Default Scope

The default automation scope is base environment only:
- System dependencies
- MUSA driver
- MT container toolkit
- Docker image preparation
- Container validation

Do not expand to muDNN, MCCL, Triton, or other extra host-side components unless explicitly requested.

### Driver-Only Requests

For driver-only operations (upgrade, downgrade, reinstall), use `skills/update_musa_driver/SKILL.md` instead of the full deployment workflow.

## Configuration Files

### SDK Compatibility Mapping

`skills/deploy_musa_base_env/config/sdk_compatibility.yml` contains compatibility mapping for SDK version, driver version, target environment, and supported validation images.

Current default:
- `sdk_version`: `4.3.5`
- `driver_version`: `3.3.5`
- `gpu_type`: `S5000`
- `gpu_arch`: `ph1`
- `supported_images`: `sh-harbor.mthreads.com/mcctest/musa-train:4.3.5_kuae2.1_torch2.9_deb_2026-03-02_ubuntu`

### OpenClaw Plugin Installation

```bash
# Install as OpenClaw plugin (linked to source for development)
openclaw plugins install -l /path/to/autodeploy

# Verify installation
openclaw plugins info openclaw-musa

# Reinstall after changes
openclaw plugins uninstall openclaw-musa && openclaw plugins install -l /path/to/autodeploy
```

### Remote Configuration Template

Create local runtime config from template (do not commit real credentials):

```bash
cp agent-tools/config/remote-ssh.env.example agent-tools/config/remote-ssh.env
```

## Code Style Guidelines

Based on checked-in TypeScript files:

### Imports
- Order: package imports, Node built-ins, local modules
- Use `import type` for type-only imports
- Prefer namespace imports for Node built-ins (e.g., `import * as fs from "fs"`)

### Formatting
- 2-space indentation in TypeScript and Markdown
- Double quotes in TypeScript
- Omit semicolons (existing files are semicolon-free)
- Prefer readable wrapped arrays and objects over dense one-liners

### Types
- Add explicit types for non-trivial values
- Prefer `Record<string, string>` for string maps
- Type plugin entry points explicitly: `const RemoteSSHPlugin: Plugin = async (...) =>`
- Avoid `any` except at external boundaries

### Naming
- `camelCase` for variables and functions
- `PascalCase` for plugin objects and types
- `UPPER_SNAKE_CASE` for constants (e.g., `SSH_FLAGS`)

### Error Handling
- Fail early when required env vars are missing
- Return actionable error messages naming missing variables
- Use narrow `try/catch` blocks around filesystem or process boundaries
- Preserve stderr in command output for remote debugging

## Operational Constraints

- **Do NOT auto-commit changes** — Only commit when user explicitly requests it (e.g., "commit this", "提交修改"). Never commit automatically after making edits.
- Never auto-run `sudo reboot`
- After driver installation, prefer documented manual reload: `modprobe -rv mtgpu && modprobe mtgpu` or `sudo modprobe mtgpu`
- Ask for manual reboot only if documented reload path fails
- Do not use sudo credentials for `git` operations or `docker pull`
- Verify `mc` means MinIO Client, not Midnight Commander, before MOSS download steps
- Prefer targeted verification after each install step instead of batching commands

## 文档驱动执行

当用户提供飞书/钉钉文档链接并要求部署时，将文档视为"执行计划"：

### 执行流程

1. **获取文档内容** — 通过飞书/钉钉插件获取文档全文
2. **解析文档结构** — 识别以下部分：
   - 环境依赖（驱动版本、镜像名称）
   - 基础环境步骤 → 调用 `deploy_musa_base_env` skill
   - 应用层步骤 → 在容器内执行命令
   - 验证步骤 → 执行并检查输出
3. **逐步执行** — 按文档顺序执行，直到验证步骤完成

### 阶段划分

| 阶段 | 内容 | 执行方式 |
|------|------|----------|
| 阶段 1 | 基础环境（驱动、容器） | 调用 Skill |
| 阶段 2 | 应用部署（模型下载、服务启动） | 执行文档命令 |
| 阶段 3 | 验证（功能测试、性能测试） | 执行文档命令 |

### 验证终点

执行到文档中的验证步骤为止，例如：
- `curl http://localhost:8000/v1/chat/completions` (vllm 服务验证)
- 推理命令输出视频文件 (wan2.2 推理验证)

### 文档格式建议

为便于 AI 解析，文档应包含：
- 明确的版本信息表格
- 分步骤的代码块
- 验证命令和预期输出

## Sudo Password Handling

Check `MY_SUDO_PASSWD` environment variable first:

```bash
if [ -n "$MY_SUDO_PASSWD" ] && echo "$MY_SUDO_PASSWD" | sudo -S -v 2>/dev/null; then
    SUDO_PASSWORD="$MY_SUDO_PASSWD"
else
    # Prompt user
fi
```

**SUDO_PASSWORD Usage Scope:**
- System package installation (`apt install`)
- Driver package installation (`dpkg -i`)
- Toolkits installation scripts
- Container toolkit installation
- Docker service restart

**Never use SUDO_PASSWORD for:**
- Docker pull operations
- File downloads
- Git operations

## State Persistence

Save deployment state to JSON files for recovery:
- `./.musa_deployment_state.json` — Full deployment state
- `./.musa_sdk_install_state.json` — SDK installation state

Use `jq` to read/write state fields.

### State Values (deployment)
- `initialized` — Skill started, variables collected
- `dependencies_installed` — System dependencies installed
- `driver_installed` — GPU driver installed
- `driver_loaded` — GPU driver loaded
- `container_toolkit_installed` — Container toolkit installed and bound
- `docker_image_pulled` — Docker image pulled
- `container_validated` — Container environment validated
- `completed` — All steps completed

## Troubleshooting

### Common Issues

1. **Driver installation fails** — Check kernel headers: `apt install linux-headers-$(uname -r)`
2. **Container toolkit binding fails** — Ensure Docker is running: `systemctl status docker`
3. **Docker image pull fails** — Verify registry credentials and network connectivity
4. **MUSA not available in container** — Check container toolkit installation and Docker restart
5. **"mthreads-container-runtime not found in PATH"** — Create symbolic links:
   ```bash
   sudo ln -sf /usr/bin/musa/mthreads-container-runtime /usr/bin/mthreads-container-runtime
   sudo ln -sf /usr/bin/musa/mthreads-container-runtime /usr/bin/mthreads-container-runtime-experimental
   sudo systemctl restart docker
   ```
6. **Container validation fails in specific image** — Follow `references/container-validation-runbook.md` to distinguish toolkit binding issues from image-side runtime or architecture issues

## Documentation Language

The repository keeps operational docs in mixed Chinese and English to match original deployment notes and command references. Preserve existing bilingual documentation where helpful. Do not translate technical filenames or commands.