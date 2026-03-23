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

This is an automation workspace for MUSA SDK environment setup, remote MT-GPU execution, and deployment documentation. The repository packages:
- Documented host deployment flows for MUSA-based environments
- Unified agent tools for SSH-based remote host and container execution
- Feishu bot integration for AI-powered operations
- Reusable skills and compatibility metadata for repeatable setup work

## Repository Structure

| Path | Purpose |
|------|---------|
| `agent-tools/src/core/` | Core executors: execRemote, execDocker, syncFiles |
| `agent-tools/src/tools/` | MCP tool definitions for Claude Code |
| `agent-tools/src/server.ts` | MCP Server entry point |
| `feishu-claude-bridge/` | Feishu bot with Claude API and tool integration |
| `skills/deploy_musa_base_env/SKILL.md` | Primary automated workflow for base environment deployment |
| `skills/update_musa_driver/SKILL.md` | Driver-only upgrade, downgrade, or reinstall workflow |
| `skills/deploy_musa_base_env/config/sdk_compatibility.yml` | SDK, driver, GPU, and image compatibility mapping |
| `references/remote-execution-policy.md` | Source of truth for local vs remote command routing |
| `references/container-validation-runbook.md` | Troubleshooting runbook for container validation failures |
| `references/moss-download-guide.md` | MOSS download and MinIO Client setup guide |
| `references/driver-install-guide.md` | Shared driver installation reference |

## Local Build Commands

### Agent Tools

```bash
cd agent-tools && npm install && npm run build
```

### Feishu Bridge

```bash
cd feishu-claude-bridge && npm install && npm run build
```

## Validation Commands

This repo relies on targeted environment validation rather than unit tests.

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

### Remote Tools

| Tool | Purpose |
|------|---------|
| `remote-exec` | Execute shell commands on Remote MT-GPU Machine host via SSH |
| `remote-docker` | Execute commands inside Docker containers on Remote MT-GPU Machine via SSH (supports both `docker exec` and `docker run`) |
| `remote-sync` | Sync files between Machine A and Remote MT-GPU Machine via rsync over SSH |

### Tool Routing Rules

Use the correct tool based on command target:

| Skill describes... | You use... |
|-------------------|------------|
| `docker exec <container> <cmd>` | `remote-docker` with `name=<container>`, `command=<cmd>` |
| `docker run ... <image> <cmd>` | `remote-docker` with `image=<image>`, `command=<cmd>` |
| `docker cp`, `docker logs`, other docker commands | `remote-exec` wrapping the full docker command |
| Bare-metal host commands (`dpkg`, `systemctl`, driver checks) | `remote-exec` with `command=<cmd>` |
| File transfer between Machine A and Remote MT-GPU Machine | `remote-sync` with appropriate direction |
| Local-only commands (`git`, file reads, code edits) | Standard local tools (Bash, Read, Edit, Write) |

**NEVER use Bash tool for Remote MT-GPU Machine commands.**

### Path Conventions

| Location | Path Pattern |
|----------|-------------|
| Machine A (local) | `repositories/<project-name>/` |
| Remote host | `~/workspace/<project-name>/` |
| Container | `/workspace/<project-name>/` |

The container mounts `~/workspace` → `/workspace` via `-v /home/${GPU_USER}/workspace:/workspace`.

### Credentials

Remote tools read credentials from:
1. Environment variables (`process.env`) — priority
2. `agent-tools/config/remote-ssh.env` — fallback (gitignored, contains credentials)

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
- `sdk_version`: `4.3.1`
- `driver_version`: `3.3.1-server`
- `gpu_type`: `S4000`
- `gpu_arch`: `QY2`
- `supported_images`: `registry.mthreads.com/public/musa-train:rc4.3.1-kuae2.1-20251014-juleng`

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

- Never auto-run `sudo reboot`
- After driver installation, prefer documented manual reload: `modprobe -rv mtgpu && modprobe mtgpu` or `sudo modprobe mtgpu`
- Ask for manual reboot only if documented reload path fails
- Do not use sudo credentials for `git` operations or `docker pull`
- Verify `mc` means MinIO Client, not Midnight Commander, before MOSS download steps
- Prefer targeted verification after each install step instead of batching commands

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