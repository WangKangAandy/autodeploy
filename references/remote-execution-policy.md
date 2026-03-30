# Remote Execution Policy

This document defines how agents interact with the **Remote MT-GPU Machine** via SSH-based tools. It is the single source of truth for remote execution routing. All agents follow this policy.

---

## Architecture

openclaw-musa operates in a split-machine model:

- **Machine A (local)** — runs OpenCode, holds the codebase, performs code analysis and editing
- **Remote MT-GPU Machine** — runs Docker containers with the MUSA SDK for compilation, testing, profiling, and GPU workloads. Accessed from Machine A via SSH — no persistent services required on the GPU side

Code modifications happen on Machine A. Builds and tests execute on the Remote MT-GPU Machine inside Docker containers. Files are synced between machines via rsync.

---

## Remote Tools

Three tools bridge Machine A and the Remote MT-GPU Machine:

| Tool | Purpose |
|------|---------|
| `musa_exec` | Execute a shell command on the Remote MT-GPU Machine host via SSH |
| `musa_docker` | Execute a command inside a Docker container on the Remote MT-GPU Machine via SSH. Supports both `docker exec` (reuse named container) and `docker run` (one-shot) |
| `musa_sync` | Sync files between Machine A and the Remote MT-GPU Machine via rsync over SSH. Supports `push` (local to remote) and `pull` (remote to local) |

---

## Tool Routing

When a skill describes a command to run, route it to the correct tool based on the target:

| Skill describes...                                | You use...                                                                  |
|---------------------------------------------------|-----------------------------------------------------------------------------|
| `docker exec <container> <cmd>`                   | `musa_docker` with `name=<container>`, `command=<cmd>`                    |
| `docker run ... <image> <cmd>`                    | `musa_docker` with `image=<image>`, `command=<cmd>` (one-shot, no name)   |
| `docker cp`, `docker logs`, other docker commands | `musa_exec` wrapping the full docker command as the command string        |
| Bare-metal host commands (`dpkg`, `systemctl`, `nvidia-smi`, etc.) | `musa_exec` with `command=<cmd>`                      |
| File transfer between Machine A and Remote MT-GPU Machine | `musa_sync` with appropriate direction (`push` or `pull`)       |
| Local-only commands (`git`, file reads, code edits) | Standard local tools (Bash, Read, Edit, Write). NOT remote tools          |

---

## Workflow Pattern

The typical remote workflow cycle is:

1. **Edit code locally** on Machine A using standard file editing tools
2. **Push code** to the Remote MT-GPU Machine via `musa_sync` (direction: `push`)
3. **Execute remotely** — build, test, profile, or verify via `musa_docker` (in-container) or `musa_exec` (host-level)
4. **Pull results** back to Machine A via `musa_sync` (direction: `pull`) if build artifacts, logs, or profiling data are needed locally

Not every step is needed every time. For example, if you only need to check a driver version, step 1-2 can be skipped — just call `musa_exec` directly.

---

## Path Conventions

All repos — primary project and selected deps — follow the same three-tier path mapping:

| Location | Path Pattern | Example (gsplat) |
|----------|-------------|-------------------|
| **Machine A** (local) | `repositories/<project-name>/` | `repositories/gsplat/` |
| **Remote host** | `~/workspace/<project-name>/` | `/home/${GPU_USER}/workspace/gsplat/` |
| **Container** | `/workspace/<project-name>/` | `/workspace/gsplat/` |

The container mounts `~/workspace` → `/workspace` via `-v /home/${GPU_USER}/workspace:/workspace`. Every repo synced into `~/workspace/` on the remote host is automatically visible inside the container at `/workspace/`.

### musa_sync convention

| Direction | `local_path` | `remote_path` |
|-----------|-------------|---------------|
| **push** | `repositories/<project-name>/` | `workspace/<project-name>/` |
| **pull** | `repositories/<project-name>/` | `workspace/<project-name>/` |

### musa_docker convention

- **Working directory** inside container: `/workspace/<project-name>/`
- **Build commands**: `cd /workspace/<project-name>/ && ...`

### Multi-dep example

In a multi-dep migration, every repo (primary + deps) lands under the same `~/workspace/` directory:

```
Machine A (local)              Remote Host                    Container
repositories/gsplat/       →   ~/workspace/gsplat/        →   /workspace/gsplat/
repositories/fused-ssim/   →   ~/workspace/fused-ssim/    →   /workspace/fused-ssim/
repositories/fused-bilagrid/ → ~/workspace/fused-bilagrid/ →  /workspace/fused-bilagrid/
```

Each musifier syncs its own repo independently. All repos share the same container via the single volume mount.

---

## Credentials

Credentials are set dynamically via `musa_set_mode` tool at runtime. Required parameters:

| Variable | Required | Description |
|----------|----------|-------------|
| `host` | yes | Remote MT-GPU Machine hostname or IP |
| `user` | yes | SSH username |
| `password` | yes | SSH password |
| `port` | no | SSH port (default: 22) |

---

## Rules

1. **NEVER use the Bash tool for any command targeting the Remote MT-GPU Machine.** Always use `musa_exec`, `musa_docker`, or `musa_sync`.
2. **Use `musa_docker` for all in-container execution** — compilation, tests, profiling, GPU workloads.
3. **Use `musa_exec` for host-level commands** on the Remote MT-GPU Machine — driver checks, docker management, package installs, file operations on the host filesystem.
4. **Use `musa_sync` for file transfer** between Machine A and the Remote MT-GPU Machine.
5. **Use the Bash tool ONLY for local operations** on Machine A — git, local file reads, local scripts.
6. **Never hardcode credentials or connection details.** They are set via `musa_set_mode` at runtime.
7. **Container name and Docker image are provided by the user or skill configuration.** Never hardcode them.
8. **Gracefully handle missing credentials.** If a remote tool fails because mode is not set, prompt the user to run `musa_set_mode`.


