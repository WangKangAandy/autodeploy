# autodeploy

Platform runtime layer for MUSA SDK environment deployment and GPU management.

This repository provides:

- **Unified Dispatcher** (`musa_dispatch`) — single entry point for all MUSA operations
- **Document-Driven Execution** — deploy from markdown documents with safety validation
- **Static Platform Constitution** — AGENTS.autodeploy.md auto-merged to workspace
- **Agent Tools** — SSH-based remote host and container execution
- **Feishu Bot Integration** — AI-powered operations via chat

## What This Repo Is For

- Deploy a base MUSA environment on a local or remote Ubuntu host
- Update or reinstall only the MUSA driver without re-running the full stack
- Execute deployment from provided documentation (document-driven mode)
- Run build, validation, and GPU checks on a Remote MT-GPU Machine
- Interact with MUSA environment via Feishu bot
- Keep deployment knowledge in versioned docs instead of scattered local notes

## Repository Map

| Path | Purpose |
|------|---------|
| `index.js` | OpenClaw plugin entry point with auto-bootstrap |
| `src/dispatcher/` | Unified dispatcher (`musa_dispatch`) for intent routing |
| `src/adapter/` | OpenClaw adapter hooks (before_prompt_build, session_end) |
| `src/core/state-manager.ts` | State persistence for deployment operations |
| `src/utils/agents-merge.js` | AGENTS.autodeploy.md auto-merge utility |
| `AGENTS.autodeploy.md` | Static platform constitution (auto-merged to workspace) |
| `agent-tools/` | Unified tool layer for Claude Code, OpenCode, and Feishu bot |
| `agent-tools/src/core/` | Core executors (execRemote, execDocker, syncFiles) |
| `agent-tools/src/tools/` | MCP tool definitions |
| `feishu-claude-bridge/` | Feishu bot with Claude API integration |
| `skills/deploy_musa_base_env/SKILL.md` | Primary automated workflow for base environment deployment |
| `skills/update_musa_driver/SKILL.md` | Driver-only upgrade, downgrade, or reinstall workflow |
| `skills/deploy_musa_base_env/config/sdk_compatibility.yml` | SDK, driver, GPU, and image compatibility mapping |
| `references/remote-execution-policy.md` | Source of truth for local vs remote command routing |
| `references/document-driven-execution.md` | Document-driven execution workflow specification |
| `references/container-validation-runbook.md` | Troubleshooting runbook for container validation failures |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Platform Runtime Layer                    │
├─────────────────────────────────────────────────────────────┤
│  AGENTS.autodeploy.md (Static Constitution)                 │
│  - Auto-merged to OpenClaw workspace                        │
│  - Platform rules, intent routing, risk levels              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Unified Dispatcher                        │
├─────────────────────────────────────────────────────────────┤
│  musa_dispatch(intent, context?)                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Intent Routing:                                       │  │
│  │ - deploy_env      → Full environment deployment       │  │
│  │ - update_driver   → Driver-only operations            │  │
│  │ - gpu_status      → Read-only GPU check                │  │
│  │ - validate        → Environment validation             │  │
│  │ - execute_document → Document-driven deployment        │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Entry Points                           │
├─────────────────┬─────────────────┬─────────────────────────┤
│ Claude Code CLI │   OpenCode CLI  │     Feishu Bot          │
│   (MCP Proto)   │   (import)      │     (import)            │
└────────┬────────┴────────┬────────┴──────────┬──────────────┘
         │                 │                    │
         ▼                 ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                    agent-tools/                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ core/executors.ts                                    │  │
│  │ - execRemote(config, command, options)               │  │
│  │ - execDocker(config, args)                           │  │
│  │ - syncFiles(config, args)                            │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ tools/                                               │  │
│  │ - remote-exec.ts (MCP tool)                          │  │
│  │ - remote-docker.ts (MCP tool)                        │  │
│  │ - remote-sync.ts (MCP tool)                          │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                 Remote MT-GPU Machine                       │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │ Host (via SSH)  │  │ Docker Containers (MUSA SDK)    │  │
│  │ - mthreads-gmi  │  │ - PyTorch MUSA                  │  │
│  │ - driver ops    │  │ - GPU workloads                 │  │
│  └─────────────────┘  └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Plugin Build (Required)

```bash
npm install
npm run build  # Compile TypeScript modules
```

### 2. Agent Tools Setup (Optional, for MCP usage)

```bash
cd agent-tools
npm install
npm run build
```

### 3. Configure Remote Access

```bash
cp agent-tools/config/remote-ssh.env.example agent-tools/config/remote-ssh.env
# Edit with your credentials
```

Required variables:

```env
GPU_HOST=<remote-gpu-ip>
GPU_USER=<ssh-username>
GPU_SSH_PASSWD=<ssh-password>
MY_SUDO_PASSWD=<optional-sudo-password>
GPU_PORT=22
TORCH_MUSA_DOCKER_IMAGE=<default-docker-image>
```

### 3. Feishu Bot Setup (Optional)

```bash
cd feishu-claude-bridge
npm install
cp config/.env.example config/.env
# Edit with your Feishu and Claude API credentials
npm run dev
```

## Run Tests

```bash
# Root tests (dispatcher, state manager)
npm test

# Agent Tools tests
cd agent-tools && npm test

# Feishu Bridge tests
cd feishu-claude-bridge && npm test
```

## Unified Dispatcher Usage

The `musa_dispatch` tool is the primary entry point for MUSA operations:

| Intent | Description | Risk Level |
|--------|-------------|------------|
| `deploy_env` | Full MUSA environment deployment | destructive |
| `update_driver` | Driver-only operations | destructive |
| `gpu_status` | GPU status check | read_only |
| `validate` | Environment validation | read_only |
| `execute_document` | Document-driven deployment | destructive |

### Document-Driven Execution

Deploy from a markdown document:

```javascript
// From local file
musa_dispatch(intent="execute_document", context={path: "/path/to/deploy.md"})

// From pasted content
musa_dispatch(intent="execute_document", context={content: "# Guide\n..."})
```

See `references/document-driven-execution.md` for details.

## Scope

The default automation scope in this repo is the base environment only:

- system dependencies
- MUSA driver
- MT container toolkit
- Docker image preparation
- container validation

Extra host-side components such as muDNN, MCCL, and Triton are intentionally out of scope unless explicitly requested.

## Recommended Reading Order

1. `references/remote-execution-policy.md`
2. `skills/deploy_musa_base_env/SKILL.md`
3. `skills/update_musa_driver/SKILL.md`
4. `references/container-validation-runbook.md`
5. `docs/环境问题FAQ.md`

## Validation Commands

Host validation:

```bash
mthreads-gmi
```

Container toolkit validation:

```bash
docker run --rm --env MTHREADS_VISIBLE_DEVICES=all \
  registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi
```

In-container validation:

```bash
docker exec torch_musa_test musaInfo
docker exec torch_musa_test python -c "import torch; print(torch.musa.is_available()); print(torch.tensor(1, device='musa') + 1)"
```

## Notes For Public GitHub Use

- `musa_packages/` is intentionally excluded from version control
- local state files such as `.musa_deployment_state.json` are ignored
- `agent-tools/config/remote-ssh.env` remains ignored; only the template is published
- `feishu-claude-bridge/config/.env` remains ignored

## Language

The repository keeps operational docs in a mixed Chinese and English style to match the original deployment notes and command references.