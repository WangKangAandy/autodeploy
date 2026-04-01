# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Available Skills

This repository contains executable automation skills organized in a hierarchical catalog.

**Skill Types:**
- `meta` — Orchestrate multiple atomic skills (e.g., `deploy_musa_base_env`)
- `atomic` — Single unit of work (e.g., `ensure_musa_driver`)

**Exposure Levels:**
- `user` — Direct user-facing entry points
- `internal` — Called by meta skills only, not directly accessible

**User-Facing Skills:**

| Skill | Description | Triggers |
|-------|-------------|----------|
| `deploy_musa_base_env` | Complete MUSA environment deployment | "部署 MUSA 环境", "install MUSA SDK", "full MUSA setup" |
| `update_musa_driver` | Driver-only update or reinstall | "更新驱动", "upgrade driver", "reinstall driver", "配置 GPU 驱动" |
| `prepare_model_artifacts` | Download/verify model files | "下载模型", "prepare model", "get model files" |
| `prepare_dataset_artifacts` | Download/verify dataset files | "下载数据集", "prepare dataset" |
| `prepare_musa_package` | Download MUSA packages (driver, toolkit) | "下载驱动包", "prepare package" |
| `prepare_dependency_repo` | Clone/update code repositories | "克隆仓库", "prepare repo" |

**Internal Skills (called by meta skills):**

| Skill | Purpose |
|-------|---------|
| `ensure_system_dependencies` | Install build-essential, dkms, etc. |
| `ensure_musa_driver` | Download & install MUSA GPU driver |
| `ensure_mt_container_toolkit` | Install & bind container toolkit |
| `manage_container_images` | Pull Docker runtime images |
| `validate_musa_container_environment` | Verify GPU access in container |

**Skill Index:** `skills/index.yml` provides machine-readable skill definitions with inputs, outputs, trigger patterns, and dependency chains.

**Reference Documents:** `references/` contains non-executable knowledge resources (MOSS download guide, driver install guide, validation runbook, execution policy).

## Overview

This is an OpenClaw plugin for MUSA SDK environment deployment. It provides:
- OpenClaw plugin with `musa_*` tools for local/remote deployment
- Executable skills for full MUSA environment setup and driver management

## Architecture

This is a **platform runtime layer** with three core capabilities:

```
┌─────────────────────────────────────────────────────────────────┐
│                    三大核心能力                                  │
├─────────────────────────────────────────────────────────────────┤
│  1. Static Rules    — inject/ 目录声明式注入 (AGENTS, IDENTITY) │
│  2. Dynamic Context — before_prompt_build hook 动态上下文注入    │
│  3. State Manager   — 部署状态持久化与恢复                       │
└─────────────────────────────────────────────────────────────────┘
```

## Document Injection System

The plugin uses a **declarative injection system** to merge static content into OpenClaw workspace.

**Source Directory:** `inject/`

| Source | Target | Markers | Purpose |
|--------|--------|---------|---------|
| `AGENTS.autodeploy.md` | `AGENTS.md` | `<!-- AUTODEPLOY:BEGIN/END -->` | Platform rules |
| `IDENTITY.autodeploy.md` | `IDENTITY.md` | `<!-- AUTODEPLOY:IDENTITY:BEGIN/END -->` | Agent identity |

**Injection Mechanism:** `src/utils/inject-manager.js`

- Declarative source list (`INJECT_SOURCES` array)
- Idempotent merge (safe to call multiple times)
- Atomic write with temp file + rename
- Concurrent-safe with file lock

**Adding New Sources:** Add entry to `INJECT_SOURCES` in `inject-manager.js`:

```javascript
{
  key: "soul",
  sourceFile: "SOUL.autodeploy.md",
  targetFile: "SOUL.md",
  markers: { begin: "<!-- AUTODEPLOY:SOUL:BEGIN -->", end: "<!-- AUTODEPLOY:SOUL:END -->" },
  required: false,
}
```

**Manual Refresh:** `node install.js install ~/.openclaw/workspace`

## State Manager

`src/core/state-manager.ts` provides persistence for deployment operations:

- **Hosts** — Mode, credentials, last_seen timestamps
- **Tool Executions** — Recent tool calls for debugging

State files stored in `autodeploy/` directory: `hosts.json`, `tool-executions.json`.

## Repository Structure

| Path | Purpose |
|------|---------|
| `index.js` | OpenClaw plugin entry point |
| `inject/` | Declarative injection sources (AGENTS, IDENTITY) |
| `src/core/` | Core executors and StateManager |
| `src/adapter/` | OpenClaw hooks and dynamic context builder |
| `src/shared/` | Trace framework and structured logging |
| `src/tools/` | OpenClaw tool definitions (musa_*) |
| `src/utils/` | Utility modules (inject-manager, agents-merge) |
| `skills/` | Executable automation skills (meta and atomic) |
| `references/` | Non-executable knowledge resources |
| `autodeploy/` | Runtime state files (JSON persistence) |

## Local Build Commands

### OpenClaw Plugin (root)
```bash
npm install
npm run build  # Compile TypeScript modules to dist/
```

## Test Commands

```bash
npm test
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

### Command Routing Rules

Route commands to the appropriate tool based on target:

| Target | Tool | Parameters |
|--------|------|------------|
| `docker exec <container> <cmd>` | `musa_docker` | `name=<container>`, `command=<cmd>` |
| `docker run ... <image> <cmd>` | `musa_docker` | `image=<image>`, `command=<cmd>` |
| `docker cp`, `docker logs`, other docker commands | `musa_exec` | `command=<full docker command>` |
| Host commands (`dpkg`, `systemctl`, driver checks) | `musa_exec` | `command=<cmd>` |
| File transfer local ↔ remote | `musa_sync` | `localPath`, `remotePath`, `direction` |
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

Credentials are set dynamically via `musa_set_mode` tool at runtime.

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

当用户提供部署文档时，将文档视为"执行计划"：

**当前支持（Stage 1A）：**
- 本地 Markdown 文件（`path` 参数）
- 粘贴的文档内容（`content` 参数）

**规划中（Stage 1B）：**
- 飞书/钉钉在线文档

### 执行流程

1. **获取文档内容** — 从本地文件或粘贴内容加载
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

## Documentation Update Rules

当修改代码时，查阅 `docs/doc-sync/DOC-MAP.yml` 确认文档影响。

### 快速参考

| 代码 | 文档 |
|------|------|
| `skills/index.yml` | [docs/doc-sync/skills.md](docs/doc-sync/skills.md) |
| `src/core/state-manager.ts` | [docs/doc-sync/state-manager.md](docs/doc-sync/state-manager.md) |
| `src/shared/trace.ts`, `src/shared/logger.ts` | [docs/doc-sync/tracing.md](docs/doc-sync/tracing.md) |

### 判定标准

详见 [docs/doc-sync/UPDATE-RULES.md](docs/doc-sync/UPDATE-RULES.md)。

## Troubleshooting

### Log Tracing

When debugging issues from Feishu/Dingding messages, use traceId to trace the entire call chain:

**Log Locations:**
| Log | Path | Content |
|-----|------|---------|
| State persistence | `autodeploy/` | hosts.json, tool-executions.json |
| Console output | stdout | Structured logs with traceId |

**TraceId Flow:**
```
Feishu message (messageId) → traceId → Tool calls → State persistence
```

**Debugging Steps:**
```bash
# 1. Get messageId from Feishu message (visible in message URL or API response)

# 2. Search logs by traceId
grep "\[TRACE:<messageId>\]" ~/.openclaw/logs/plugin.log

# 3. Check operation state
cat autodeploy/tool-executions.json | jq '.[-5:]'
```

**Log Format:**
```
[service] [TRACE:xxx] [OP:yyy] [LEVEL] message | key=value
```

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