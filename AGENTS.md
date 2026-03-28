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

## Test Commands

### Unit Tests

Run all tests:
```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

Run a single test file:
```bash
npx vitest run tests/<test-name>.test.ts
```

Run a specific test by name pattern:
```bash
npx vitest run -t "<test-name>"
```

### Environment Validation

This repo also uses targeted environment validation for MUSA GPU testing.

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

<!-- AUTODEPLOY:BEGIN -->
## MUSA Platform Rules

### Platform Priority

For tasks involving GPU, MUSA, driver, MCCL, model deployment, or remote cluster operations:

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
| **下载模型** | `musa_dispatch(intent="prepare_model", context={MODEL_NAME: "Qwen/Qwen2-7B"})` |
| **准备数据集** | `musa_dispatch(intent="prepare_dataset", context={DATASET_NAME: "alpaca"})` |
| **准备安装包** | `musa_dispatch(intent="prepare_package", context={PACKAGE_TYPE: "driver", VERSION: "3.3.5"})` |
| **克隆仓库** | `musa_dispatch(intent="prepare_repo", context={REPO_URL: "https://..."})` |
| **按文档部署** | `musa_dispatch(intent="execute_document", context={...})` |

### Risk Levels

| Level | Operations | Confirmation |
|-------|------------|--------------|
| `read_only` | gpu_status, validate | None |
| `safe_write` | sync, run_container | Warning only |
| `destructive` | deploy_env, update_driver, **execute_document** | Required |

### Quick Actions

- Check GPU: `musa_dispatch(intent="gpu_status")`
- Resume Deployment: `musa_dispatch(intent="deploy_env", action="resume")`
- Validate Environment: `musa_dispatch(intent="validate")`

### Document-Driven Execution

When users provide deployment documents, use `execute_document` intent:

```javascript
// From local file
musa_dispatch(intent="execute_document", context={path: "/path/to/deploy.md"})

// From pasted content
musa_dispatch(intent="execute_document", context={content: "# Guide\n..."})

// Resume execution
musa_dispatch(intent="execute_document", action="resume", context={operationId: "op_xxx"})
```

**Parameter Rules:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `path` | One of path/content | Local document file path |
| `content` | One of path/content | Pasted document content |
| `operationId` | Required for resume | Operation ID to resume |

- `path` and `content` are **mutually exclusive** - provide exactly one
- If both provided, `path` takes priority
- If neither provided, returns error

**Risk Handling:**
- Entry level: treated as `destructive`, requires user confirmation
- Step level: each step's risk level shown separately in Plan Review (read_only / safe_write / destructive)

**Supported Sources (Stage 1A):**
- Local files (`path` parameter)
- Pasted content (`content` parameter)

**Trigger Patterns (Conservative):**
- "按文档部署" / "execute from document"
- "执行文档" / "execute document"
- "根据文档部署" / "deploy from document"

**Execution Flow:**
1. **Load** → Load document
2. **Parse** → Extract phases and steps
3. **Plan** → Generate execution plan
4. **Safety** → Validate against safety rules
5. **Review** → User confirmation (awaiting_input)
6. **Execute** → Execute steps

**Internal Dispatch Mode:**

When a step requires calling existing skills (e.g., `deploy_env`), internal dispatch is used:
- Does NOT re-trigger top-level permission gate / plan review / operation creation
- Still performs necessary prechecks and validation
- Reuses parent operation context

**Note:** Feishu/Dingding document sources are Stage 1B (not currently supported).

**Details:** See `references/document-driven-execution.md`

### Fallback Behavior

If `musa_dispatch` fails:
1. Try direct tool calls: `musa_exec`, `musa_docker`, `musa_sync`
2. Execute manual commands as last resort

### Log Tracing (Debugging Feishu Issues)

When debugging issues reported from Feishu, use traceId to trace the call chain:

**TraceId Source:** Feishu message `messageId` becomes `traceId` throughout the execution.

**Log Locations:**
```bash
# Tool execution logs
.claude/remote-exec.log

# State persistence
autodeploy/operations.json
autodeploy/jobs.json
```

**Debugging Steps:**
```bash
# 1. Get messageId from Feishu (visible in message URL)

# 2. Search logs
grep "traceId.*<messageId>" .claude/remote-exec.log

# 3. Check operation state
cat autodeploy/operations.json | jq '.[] | select(.traceId == "<messageId>")'
```

**Log Format:**
```
[service] [TRACE:xxx] [OP:yyy] [LEVEL] message
```

<!-- AUTODEPLOY:END -->
