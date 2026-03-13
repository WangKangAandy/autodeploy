# autodeploy

Automation workspace for MUSA SDK environment setup, remote MT-GPU execution, and deployment runbooks.

This repository packages three things together:

- documented host deployment flows for MUSA-based environments
- OpenCode tooling for SSH-based remote host and remote container execution
- reusable skills and compatibility metadata for repeatable setup work

## What This Repo Is For

- Deploy a base MUSA environment on a local or remote Ubuntu host
- Update or reinstall only the MUSA driver without re-running the full stack
- Run build, validation, and GPU checks on a Remote MT-GPU Machine through OpenCode tools
- Keep deployment knowledge in versioned docs instead of scattered local notes

## Scope

The default automation scope in this repo is the base environment only:

- system dependencies
- MUSA driver
- MT container toolkit
- Docker image preparation
- container validation

Extra host-side components such as muDNN, MCCL, and Triton are intentionally out of scope unless explicitly requested.

## Repository Map

| Path | Purpose |
|------|---------|
| `skills/deploy_musa_base_env/SKILL.md` | Primary automated workflow for base environment deployment |
| `skills/update_musa_driver/SKILL.md` | Driver-only upgrade, downgrade, or reinstall workflow |
| `skills/deploy_musa_base_env/config/sdk_compatibility.yml` | SDK, driver, GPU, and image compatibility mapping |
| `skills/deploy_musa_base_env/config/container_toolkit.yml` | Container toolkit version metadata |
| `references/remote-execution-policy.md` | Source of truth for local vs remote command routing |
| `references/container-validation-runbook.md` | Troubleshooting runbook for container validation failures |
| `docs/单机环境部署.md` | Manual single-machine deployment reference |
| `docs/环境问题FAQ.md` | Known environment issues and recovery notes |
| `.opencode/plugin/remote-ssh.ts` | Plugin that injects remote env vars and logs remote tool usage |
| `.opencode/tools/remote-exec.ts` | Remote host command runner |
| `.opencode/tools/remote-docker.ts` | Remote container command runner |

## Recommended Reading Order

1. `references/remote-execution-policy.md`
2. `skills/deploy_musa_base_env/SKILL.md`
3. `skills/update_musa_driver/SKILL.md`
4. `references/container-validation-runbook.md`
5. `docs/环境问题FAQ.md`

## OpenCode Tooling

The `.opencode/` directory contains the local tooling layer used by this workspace.

- `plugin/remote-ssh.ts` injects remote connection variables into tool processes
- `tools/remote-exec.ts` runs host-level commands over SSH
- `tools/remote-docker.ts` runs container commands on the remote machine over SSH
- `tools/remote-sync.ts` is currently a placeholder and should not be treated as implemented behavior

Install the local dependency once before loading the tools:

```bash
cd .opencode
bun install
```

Smoke check individual tool files after edits:

```bash
cd .opencode && bun --eval "await import('./tools/remote-exec.ts')"
cd .opencode && bun --eval "await import('./tools/remote-docker.ts')"
cd .opencode && bun --eval "await import('./plugin/remote-ssh.ts')"
```

## Remote Configuration

Do not commit real credentials.

Use the checked-in template file and create your local runtime config from it:

```bash
cp .opencode/remote-ssh.env.example .opencode/remote-ssh.env
```

Expected variables:

```env
GPU_HOST=<remote-gpu-ip>
GPU_USER=<ssh-username>
GPU_SSH_PASSWD=<ssh-password>
GPU_PORT=22
GPU_WORK_DIR=~
TORCH_MUSA_DOCKER_IMAGE=<optional-default-image>
```

`references/remote-execution-policy.md` defines when to use local tools, `remote-exec`, and `remote-docker`.

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

- `musa_packages/` is intentionally excluded from version control because it contains large local install artifacts
- local state files such as `.musa_deployment_state.json` are ignored
- `.opencode/remote-ssh.env` remains ignored; only the template is published

## Language

The repository keeps operational docs in a mixed Chinese and English style to match the original deployment notes and command references.
