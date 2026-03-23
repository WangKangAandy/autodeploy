# AGENTS.md

## Purpose
This repository is an automation workspace for MUSA SDK environment setup, remote MT-GPU execution, and deployment documentation.
Agents working here should prefer repo-documented workflows over generic guesses.
When instructions conflict, prefer `skills/` workflow definitions over `docs/` reference material.

## Repository Map

| Path | Purpose |
|------|---------|
| `agent-tools/src/core/` | Core executors: execRemote, execDocker, syncFiles |
| `agent-tools/src/tools/` | MCP tool definitions for remote execution |
| `agent-tools/src/server.ts` | MCP Server entry point |
| `feishu-claude-bridge/` | Feishu bot with Claude API integration |
| `skills/deploy_musa_base_env/SKILL.md` | Primary source for automated deployment workflow |
| `skills/update_musa_driver/SKILL.md` | Targeted workflow for driver-only operations |
| `skills/deploy_musa_base_env/config/sdk_compatibility.yml` | SDK/driver/environment/supported-image compatibility mapping |
| `references/remote-execution-policy.md` | Source of truth for local vs remote command routing |
| `references/container-validation-runbook.md` | Troubleshooting runbook for container validation failures |
| `docs/单机环境部署.md` | Reference notes for manual single-machine deployment |
| `docs/环境问题FAQ.md` | Known environment issues and recovery notes |

## Build Commands

### Agent Tools

```bash
cd agent-tools && npm install && npm run build
```

### Feishu Bridge

```bash
cd feishu-claude-bridge && npm install && npm run build
```

## Test Commands

This repo relies on targeted environment validation rather than a conventional unit test suite.

### Host validation
```bash
mthreads-gmi
```

### Container toolkit validation
```bash
docker run --rm --env MTHREADS_VISIBLE_DEVICES=all \
  registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi
```

### Start a test container
```bash
image_name=<image_name>
docker run -itd \
  --name=torch_musa_test \
  --env MTHREADS_VISIBLE_DEVICES=all \
  --shm-size=80g \
  --network=host \
  --privileged \
  --pid=host \
  -v /data:/data \
  "$image_name" bash
```

### In-container validation
```bash
docker exec torch_musa_test musaInfo
docker exec torch_musa_test python -c "import torch; print(torch.musa.is_available()); print(torch.tensor(1, device='musa') + 1)"
```

## Remote Execution Rules

Follow `references/remote-execution-policy.md` when commands target the Remote MT-GPU Machine.

- Use `remote-exec` for host-level remote commands such as `dpkg`, `systemctl`, driver checks, and Docker management.
- Use `remote-docker` for commands that should run inside a remote container.
- Use local file tools and local shell only for workspace inspection, editing, and local dependency work.
- Do not replace remote steps with local Bash commands.

## Remote Path Conventions
- Local workspace: `repositories/<project-name>/`
- Remote host: `~/workspace/<project-name>/`
- Container path: `/workspace/<project-name>/`

The policy docs assume `~/workspace` is mounted into the container as `/workspace`.

## Credentials And State
- Remote credentials come from environment variables or `agent-tools/config/remote-ssh.env`.
- Expected vars: `GPU_HOST`, `GPU_USER`, `GPU_SSH_PASSWD`, optional `GPU_PORT`, `GPU_WORK_DIR`, `TORCH_MUSA_DOCKER_IMAGE`.
- Host install flows may also use `MY_SUDO_PASSWD` for privileged package installation.
- Do not assume Docker registry auth is required for local SDK 4.3.1 installation unless the active skill or the user explicitly requires a private image pull.
- State files mentioned by docs include `./.musa_sdk_install_state.json` and `./.musa_deployment_state.json`.
- Never commit credentials, passwords, or generated state files unless the user explicitly asks.

## Operational Constraints
- For local installation requests in this repo, default to the `deploy_musa_base_env` scope: system dependencies, driver, container toolkit, image-based container startup, and validation.
- Do not add muDNN, MCCL, Triton, or other extra host-side components unless the user explicitly requests the broader stack.
- Never auto-run `sudo reboot`.
- After driver installation, prefer the documented manual driver reload path first, for example `modprobe -rv mtgpu && modprobe mtgpu` or `sudo modprobe mtgpu` when applicable.
- Ask for a manual reboot only if the documented reload path fails or the environment explicitly requires reboot to finish loading the driver.
- Do not use sudo credentials for `git` operations or `docker pull`.
- Verify `mc` means MinIO Client, not Midnight Commander, before following MOSS download steps.
- Prefer targeted verification after each install step instead of batching many opaque commands together.

## Code Style Guidelines

### Imports
- Order imports as: package imports first, then Node built-ins, then local modules.
- Use `import type` for type-only imports.
- Prefer namespace imports for Node built-ins when that matches existing code.

### Formatting
- Use 2-space indentation in TypeScript and Markdown lists.
- Use double quotes in TypeScript.
- Omit semicolons; existing TS files are semicolon-free.
- Prefer readable wrapped arrays and object literals over dense one-line declarations.

### Types
- Add explicit types for non-trivial values and helper return types.
- Prefer `Record<string, string>` for string maps, matching current code.
- Type plugin entry points explicitly.
- Avoid `any` except at external boundaries where the runtime truly returns unknown shaped errors.

### Naming
- Use `camelCase` for variables and functions.
- Use `PascalCase` for plugin objects and types.
- Use `UPPER_SNAKE_CASE` for constants like `SSH_FLAGS`.
- Keep names descriptive and operationally clear.

### Error Handling
- Fail early when required env vars are missing.
- Return actionable error messages that name the missing variables or failed prerequisite.
- Use narrow `try/catch` blocks around filesystem or process boundaries.
- Preserve stderr in returned command output so remote failures remain debuggable.

### Shell And Command Style
- Use `set -euo pipefail` in any new shell script.
- Quote variable expansions unless unquoted expansion is required.
- Separate host validation, container validation, and Python validation into distinct commands.

### Documentation Style
- Keep operational docs step-based and command-first.
- Include exact verification commands after each major install step.
- Preserve existing bilingual documentation where helpful; do not translate technical filenames or commands.