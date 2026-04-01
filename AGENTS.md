# AGENTS.md

## Purpose
This repository is an automation workspace for MUSA SDK environment setup, remote MT-GPU execution, and deployment documentation.
Agents working here should prefer repo-documented workflows over generic guesses.
When instructions conflict, prefer `skills/` workflow definitions over `docs/` reference material.

## Repository Map

| Path | Purpose |
|------|---------|
| `skills/deploy_musa_base_env/SKILL.md` | Primary source for automated deployment workflow |
| `skills/update_musa_driver/SKILL.md` | Targeted workflow for driver-only operations |
| `skills/deploy_musa_base_env/config/sdk_compatibility.yml` | SDK/driver/environment compatibility mapping |
| `references/remote-execution-policy.md` | Source of truth for local vs remote command routing |
| `docs/单机环境部署.md` | Reference notes for manual single-machine deployment |

## Build / Lint / Test Commands

```bash
# Build
npm run build

# Test
npm test

# Watch mode
npm run test:watch

# Single test file
npx vitest run tests/<test-name>.test.ts

# Single test by name
npx vitest run -t "<test-name>"
```

No lint script is configured.

## Remote Execution Rules

Follow `references/remote-execution-policy.md` when commands target the Remote MT-GPU Machine.

- Use `musa_exec` for host-level remote commands (dpkg, systemctl, driver checks, Docker management)
- Use `musa_docker` for commands inside a remote container
- Use local file tools only for workspace inspection, editing, and local dependency work

## Credentials And State
- Remote credentials set via `musa_set_mode` tool at runtime
- State files: `./.musa_sdk_install_state.json`, `./.musa_deployment_state.json`
- Never commit credentials, passwords, or generated state files unless explicitly asked

## Operational Constraints
- For local installation requests, default to `deploy_musa_base_env` scope
- Do not add muDNN, MCCL, Triton unless explicitly requested
- Never auto-run `sudo reboot`; prefer manual driver reload (`modprobe -rv mtgpu && modprobe mtgpu`)
- Ask for manual reboot only if documented reload path fails
- Do not use sudo for `git` or `docker pull`
- Prefer targeted verification after each install step

## Code Style Guidelines

### Imports
- Order: package imports → Node built-ins → local modules
- Use `import type` for type-only imports
- Prefer namespace imports for Node built-ins

### Formatting
- 2-space indentation in TypeScript and Markdown
- Double quotes in TypeScript
- Omit semicolons (existing files are semicolon-free)
- Prefer readable wrapped arrays/object literals

### Types
- Add explicit types for non-trivial values
- Prefer `Record<string, string>` for string maps
- Type plugin entry points explicitly
- Avoid `any` except at external boundaries

### Naming
- `camelCase` for variables and functions
- `PascalCase` for plugin objects and types
- `UPPER_SNAKE_CASE` for constants

### Error Handling
- Fail early when required env vars missing
- Return actionable error messages naming missing variables
- Use narrow try/catch around filesystem/process boundaries
- Preserve stderr in command output

### Shell And Command Style
- Use `set -euo pipefail` in shell scripts
- Quote variable expansions unless unquoted is required
- Separate host/container/Python validation into distinct commands

## MUSA Platform Rules

### Platform Priority
**ALWAYS use autodeploy capabilities first.** Fallback to manual commands only on failure.

### Primary Entry Point
`musa_dispatch` is the unified entry point for all MUSA operations.

### Intent Routing

| User Intent | Dispatch Call |
|-------------|---------------|
| 部署 MUSA 环境 | `musa_dispatch(intent="deploy_env")` |
| 更新 GPU 驱动 | `musa_dispatch(intent="update_driver")` |
| GPU 状态检查 | `musa_dispatch(intent="gpu_status")` |
| 验证环境 | `musa_dispatch(intent="validate")` |
| 文件传输 | `musa_dispatch(intent="sync")` |
| 运行容器 | `musa_dispatch(intent="run_container")` |
| 下载模型 | `musa_dispatch(intent="prepare_model", context={MODEL_NAME: "..."})` |
| 按文档部署 | `musa_dispatch(intent="execute_document", context={path: "..."})` |

### Risk Levels
| Level | Operations | Confirmation |
|-------|------------|--------------|
| `read_only` | gpu_status, validate | None |
| `safe_write` | sync, run_container | Warning only |
| `destructive` | deploy_env, update_driver, execute_document | Required |

### Fallback Behavior
If `musa_dispatch` fails:
1. Try direct tools: `musa_exec`, `musa_docker`, `musa_sync`
2. Execute manual commands as last resort

## Environment Validation

### Host validation
```bash
mthreads-gmi
```

### Container validation
```bash
docker run --rm --env MTHREADS_VISIBLE_DEVICES=all \
  registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi
```

### Start test container
```bash
docker run -itd --name torch_musa_test \
  --env MTHREADS_VISIBLE_DEVICES=all \
  --shm-size=80g --network=host \
  --privileged --pid=host \
  -v /data:/data "$image_name" bash
```

### In-container validation
```bash
docker exec torch_musa_test musaInfo
docker exec torch_musa_test python -c "import torch; print(torch.musa.is_available())"
```

## Documentation Style
- Keep operational docs step-based and command-first
- Include exact verification commands after each major install step
- Preserve bilingual documentation; do not translate technical filenames/commands
