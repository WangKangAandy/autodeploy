# autodeploy

Automation workspace for MUSA SDK environment setup, remote MT-GPU execution, and deployment runbooks.

This repository packages:

- documented host deployment flows for MUSA-based environments
- unified agent tools for SSH-based remote host and container execution
- Feishu bot integration for AI-powered operations
- reusable skills and compatibility metadata for repeatable setup work

## What This Repo Is For

- Deploy a base MUSA environment on a local or remote Ubuntu host
- Update or reinstall only the MUSA driver without re-running the full stack
- Run build, validation, and GPU checks on a Remote MT-GPU Machine
- Interact with MUSA environment via Feishu bot
- Keep deployment knowledge in versioned docs instead of scattered local notes

## Repository Map

| Path | Purpose |
|------|---------|
| `agent-tools/` | Unified tool layer for Claude Code, OpenCode, and Feishu bot |
| `agent-tools/src/core/` | Core executors (execRemote, execDocker, syncFiles) |
| `agent-tools/src/tools/` | MCP tool definitions |
| `feishu-claude-bridge/` | Feishu bot with Claude API integration |
| `skills/deploy_musa_base_env/SKILL.md` | Primary automated workflow for base environment deployment |
| `skills/update_musa_driver/SKILL.md` | Driver-only upgrade, downgrade, or reinstall workflow |
| `skills/deploy_musa_base_env/config/sdk_compatibility.yml` | SDK, driver, GPU, and image compatibility mapping |
| `references/remote-execution-policy.md` | Source of truth for local vs remote command routing |
| `references/container-validation-runbook.md` | Troubleshooting runbook for container validation failures |
| `docs/单机环境部署.md` | Manual single-machine deployment reference |
| `docs/环境问题FAQ.md` | Known environment issues and recovery notes |

## Architecture

```
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
│  ┌──────────────────────────────────────────────────────┐  │
│  │ server.ts (MCP Server entry point)                   │  │
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

### 1. Agent Tools Setup

```bash
cd agent-tools
npm install
npm run build
```

### 2. Configure Remote Access

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