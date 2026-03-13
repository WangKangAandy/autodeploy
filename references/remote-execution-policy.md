# Remote Execution Policy

This document defines how agents interact with the **Remote MT-GPU Machine** via SSH-based tools. It is the single source of truth for remote execution routing. All agents follow this policy.

---

## Architecture

auto-musify operates in a split-machine model:

- **Machine A (local)** — runs OpenCode, holds the codebase, performs code analysis and editing
- **Remote MT-GPU Machine** — runs Docker containers with the MUSA SDK for compilation, testing, profiling, and GPU workloads. Accessed from Machine A via SSH — no persistent services required on the GPU side

Code modifications happen on Machine A. Builds and tests execute on the Remote MT-GPU Machine inside Docker containers. Files are synced between machines via rsync.

---

## Remote Tools

Three tools bridge Machine A and the Remote MT-GPU Machine:

| Tool | Purpose |
|------|---------|
| `remote-exec` | Execute a shell command on the Remote MT-GPU Machine host via SSH |
| `remote-docker` | Execute a command inside a Docker container on the Remote MT-GPU Machine via SSH. Supports both `docker exec` (reuse named container) and `docker run` (one-shot) |
| `remote-sync` | Sync files between Machine A and the Remote MT-GPU Machine via rsync over SSH. Supports `push` (local to remote) and `pull` (remote to local) |

---

## Tool Routing

When a skill describes a command to run, route it to the correct tool based on the target:

| Skill describes...                                | You use...                                                                  |
|---------------------------------------------------|-----------------------------------------------------------------------------|
| `docker exec <container> <cmd>`                   | `remote-docker` with `name=<container>`, `command=<cmd>`                    |
| `docker run ... <image> <cmd>`                    | `remote-docker` with `image=<image>`, `command=<cmd>` (one-shot, no name)   |
| `docker cp`, `docker logs`, other docker commands | `remote-exec` wrapping the full docker command as the command string        |
| Bare-metal host commands (`dpkg`, `systemctl`, `nvidia-smi`, etc.) | `remote-exec` with `command=<cmd>`                      |
| File transfer between Machine A and Remote MT-GPU Machine | `remote-sync` with appropriate direction (`push` or `pull`)       |
| Local-only commands (`git`, file reads, code edits) | Standard local tools (Bash, Read, Edit, Write). NOT remote tools          |

---

## Workflow Pattern

The typical remote workflow cycle is:

1. **Edit code locally** on Machine A using standard file editing tools
2. **Push code** to the Remote MT-GPU Machine via `remote-sync` (direction: `push`)
3. **Execute remotely** — build, test, profile, or verify via `remote-docker` (in-container) or `remote-exec` (host-level)
4. **Pull results** back to Machine A via `remote-sync` (direction: `pull`) if build artifacts, logs, or profiling data are needed locally

Not every step is needed every time. For example, if you only need to check a driver version, step 1-2 can be skipped — just call `remote-exec` directly.

---

## Path Conventions

All repos — primary project and selected deps — follow the same three-tier path mapping:

| Location | Path Pattern | Example (gsplat) |
|----------|-------------|-------------------|
| **Machine A** (local) | `repositories/<project-name>/` | `repositories/gsplat/` |
| **Remote host** | `~/workspace/<project-name>/` | `/home/${GPU_USER}/workspace/gsplat/` |
| **Container** | `/workspace/<project-name>/` | `/workspace/gsplat/` |

The container mounts `~/workspace` → `/workspace` via `-v /home/${GPU_USER}/workspace:/workspace`. Every repo synced into `~/workspace/` on the remote host is automatically visible inside the container at `/workspace/`.

### remote-sync convention

| Direction | `local_path` | `remote_path` |
|-----------|-------------|---------------|
| **push** | `repositories/<project-name>/` | `workspace/<project-name>/` |
| **pull** | `repositories/<project-name>/` | `workspace/<project-name>/` |

### remote-docker convention

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

## Credential Flow and Availability

The remote tools read credentials from two sources (in order of priority):

1. **Environment variables** (`process.env`) — set before starting OpenCode, or injected by the `remote-ssh` plugin
2. **Config file** (`.opencode/remote-ssh.env`) — fallback when env vars are not set. Simple `KEY=VALUE` format, one per line. This file is gitignored (contains credentials).

| Variable | Required | Description |
|----------|----------|-------------|
| `GPU_HOST` | yes | Remote MT-GPU Machine hostname or IP |
| `GPU_USER` | yes | SSH username |
| `GPU_SSH_PASSWD` | yes | SSH password |
| `GPU_PORT` | no | SSH port (default: 22) |
| `GPU_WORK_DIR` | no | Default remote working directory (default: ~) |
| `TORCH_MUSA_DOCKER_IMAGE` | no | Default Docker image for `remote-docker` one-shot runs |

### When Credentials Become Available

Credentials are collected by the **director** **upfront** — before any pipeline work begins. The director writes them to `.opencode/remote-ssh.env` and the `remote-ssh` plugin injects these env vars into the shell environment for all subsequent tool calls.

**Stage 0** (sdk-version): remote tools are available but typically not needed (version resolution uses GitHub API, Harbor API, local git, and MOSS S3).

**Stage 1** (parallel preparation): remote tools are used by the **lookuper** (task: `prepare-docker`) to pull the Docker image and launch the container on the Remote MT-GPU Machine. The **reader** and the **lookuper** (task: `prepare-document-site`) stay local and do not use remote tools.

**Stage 2** (api-mapping): the **lookuper** uses `remote-docker` to verify mappings against SDK headers inside the running container (set up in Stage 1).

**Stage 3** (adaptation): remote tools are fully used by **musifier** and **optimizer** for all builds, tests, and profiling inside the container.

---

## Rules

1. **NEVER use the Bash tool for any command targeting the Remote MT-GPU Machine.** Always use `remote-exec`, `remote-docker`, or `remote-sync`.
2. **Use `remote-docker` for all in-container execution** — compilation, tests, profiling, GPU workloads.
3. **Use `remote-exec` for host-level commands** on the Remote MT-GPU Machine — driver checks, docker management, package installs, file operations on the host filesystem.
4. **Use `remote-sync` for file transfer** between Machine A and the Remote MT-GPU Machine.
5. **Use the Bash tool ONLY for local operations** on Machine A — git, local file reads, local scripts.
6. **Never hardcode credentials or connection details.** They are injected via environment variables by the `remote-ssh` plugin.
7. **Container name and Docker image are provided by the director** (from musa-install output and lookuper output respectively). Never hardcode them.
8. **Gracefully handle missing credentials.** If a remote tool fails because env vars are not set, do not retry — report the issue to the director. Credentials may not yet be collected.

---

## Plugin: remote-ssh

The `remote-ssh` plugin (`.opencode/plugins/remote-ssh.ts`) provides three hooks that support the remote execution workflow:

1. **`shell.env`** — injects GPU connection env vars (`GPU_HOST`, `GPU_USER`, `GPU_SSH_PASSWD`, etc.) into the shell environment for all tool calls
2. **`tool.execute.after`** — logs all remote tool executions to `.opencode/remote-exec.log` for audit trail
3. **`experimental.session.compacting`** — preserves remote connection state, Docker image info, MUSA install state, and recent remote commands when context is compacted, preventing context loss during long migrations

Agents do not interact with the plugin directly — it operates transparently.
