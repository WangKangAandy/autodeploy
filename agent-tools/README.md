# Agent Tools

Unified tool layer for AI agents to execute commands on Remote MT-GPU Machines via SSH.

This package provides:
- **MCP Server** for Claude Code CLI integration
- **Core executors** for direct import by OpenCode and Feishu bot
- **Three remote tools**: remote-exec, remote-docker, remote-sync

## Features

- **Remote Command Execution** (`remote-exec`): Execute shell commands on remote MT-GPU machines via SSH
- **Docker Container Operations** (`remote-docker`): Run commands inside Docker containers with MT-GPU access using `--runtime=mthreads`
- **File Synchronization** (`remote-sync`): Sync files between local and remote machines using rsync over SSH
- **Sudo Support**: Execute privileged operations with password authentication
- **GPU Runtime**: Full support for MUSA GPU runtime configuration

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Entry Points                        │
├───────────────┬───────────────┬─────────────────────────┤
│ Claude Code   │   OpenCode    │     Feishu Bot          │
│  (MCP Proto)  │   (import)    │     (import)            │
└───────┬───────┴───────┬───────┴───────────┬─────────────┘
        │               │                   │
        ▼               ▼                   ▼
┌─────────────────────────────────────────────────────────┐
│ src/server.ts              │ src/core/executors.ts      │
│ (MCP Server)               │ (Direct API)               │
└─────────────────────────────┴───────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ src/tools/                                              │
│ - remote-exec.ts    - remote-docker.ts    - remote-sync.ts │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ Remote MT-GPU Machine                                   │
│ - Host commands (via SSH)                               │
│ - Docker containers (MUSA SDK)                          │
└─────────────────────────────────────────────────────────┘
```

## Installation

### Prerequisites

- Node.js >= 18.0.0
- SSH access to your Remote MT-GPU Machine
- Docker installed on the remote machine (for `remote-docker` tool)

### Install and Build

```bash
cd agent-tools
npm install
npm run build
```

## Usage

### 1. Claude Code CLI (MCP)

Configure Claude Code to use the MCP server:

```json
// .claude/settings.json or .mcp.json
{
  "mcpServers": {
    "agent-tools": {
      "command": "node",
      "args": ["/path/to/agent-tools/dist/server.js"]
    }
  }
}
```

### 2. OpenCode / Feishu Bot (Direct Import)

```typescript
import {
  execRemote,
  execDocker,
  syncFiles,
  type SSHConfig,
  type ExecResult,
} from "agent-tools/dist/core/index.js"

const config: SSHConfig = {
  host: "192.168.24.40",
  user: "mccxadmin",
  password: "your_password",
  port: "22",
  sudoPasswd: "your_sudo_password", // optional
}

// Execute remote command
const result: ExecResult = await execRemote(config, "mthreads-gmi")
console.log(result.stdout)

// Run Docker command
const dockerResult = await execDocker(config, {
  command: "python -c 'import torch; print(torch.musa.is_available())'",
  name: "torch_musa_test", // or use image for one-shot
})

// Sync files
await syncFiles(config, {
  localPath: "./project",
  remotePath: "~/workspace/project",
  direction: "push",
})
```

### 3. Feishu Bot Integration

See `feishu-claude-bridge/src/tool-client.ts` for a complete wrapper implementation.

## Configuration

### Option 1: Config File

```bash
cp config/remote-ssh.env.example config/remote-ssh.env
# Edit config/remote-ssh.env with your credentials
chmod 600 config/remote-ssh.env
```

### Option 2: Environment Variables

```bash
export GPU_HOST=192.168.24.40
export GPU_USER=mccxadmin
export GPU_SSH_PASSWD=your_password
export MY_SUDO_PASSWD=your_sudo_password  # Optional
export TORCH_MUSA_DOCKER_IMAGE=registry.mthreads.com/...  # Optional
```

### Configuration Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GPU_HOST` | Yes | - | Remote host IP or hostname |
| `GPU_USER` | Yes | - | SSH username |
| `GPU_SSH_PASSWD` | Yes | - | SSH password |
| `GPU_PORT` | No | 22 | SSH port |
| `GPU_WORK_DIR` | No | ~ | Default remote working directory |
| `MY_SUDO_PASSWD` | No | `GPU_SSH_PASSWD` | Sudo password |
| `TORCH_MUSA_DOCKER_IMAGE` | No | - | Default Docker image |

## Core API Reference

### execRemote(config, command, options?)

Execute a shell command on the remote host.

```typescript
const result = await execRemote(config, "apt update", {
  workdir: "~",
  sudo: true,
  timeout: 120,
})
// result: { stdout: string, stderr: string, exitCode: number }
```

### execDocker(config, args)

Run a command inside a Docker container on the remote host.

```typescript
const result = await execDocker(config, {
  command: "python train.py",
  image: "registry.mthreads.com/public/musa-train:rc4.3.1", // for docker run
  // OR
  name: "torch_musa_test", // for docker exec
  workdir: "/workspace",
  volumes: ["/data:/data"],
  envVars: ["FORCE_MUSA=1"],
  timeout: 300,
})
```

### syncFiles(config, args)

Sync files between local and remote machine.

```typescript
const result = await syncFiles(config, {
  localPath: "./project",
  remotePath: "~/workspace/project",
  direction: "push", // or "pull"
  delete: false,
  exclude: ["*.tmp", ".git"],
  timeout: 600,
})
```

## MCP Tools

### remote-exec

Execute shell commands on the remote host.

**Parameters:**
- `command` (required): Shell command to execute
- `workdir` (optional): Remote working directory
- `sudo` (optional): Run with sudo (default: false)
- `timeout` (optional): Timeout in seconds (default: 120)

### remote-docker

Run commands in Docker containers with GPU access.

**Parameters:**
- `command` (required): Command to run
- `image` (optional): Docker image (for docker run)
- `name` (optional): Container name (for docker exec)
- `workdir` (optional): Working directory (default: /workspace)
- `visible_devices` (optional): GPU devices (default: all)
- `shm_size` (optional): Shared memory size (default: 16G)
- `volumes` (optional): Volume mounts
- `env_vars` (optional): Environment variables
- `sudo` (optional): Run with sudo
- `timeout` (optional): Timeout in seconds (default: 300)

### remote-sync

Sync files between local and remote.

**Parameters:**
- `local_path` (required): Local path
- `remote_path` (required): Remote path
- `direction` (optional): "push" or "pull" (default: push)
- `delete` (optional): Delete extraneous files (default: false)
- `exclude` (optional): Exclude patterns
- `timeout` (optional): Timeout in seconds (default: 600)

## Troubleshooting

### "Missing required env vars" error
- Ensure `GPU_HOST`, `GPU_USER`, and `GPU_SSH_PASSWD` are set
- Check both environment variables and config file

### SSH connection failures
- Verify network connectivity: `ping $GPU_HOST`
- Test SSH manually: `ssh -p $GPU_PORT $GPU_USER@$GPU_HOST`

### Docker runtime not found
- Ensure MT container toolkit is installed
- Check Docker status: `docker ps`
- Verify runtime: `docker info | grep -i runtime`

### Debug Mode

Check execution logs:

```bash
cat .claude/remote-exec.log
```

## Development

```bash
npm run build    # Build the project
npm run clean    # Clean dist directory
npm run dev      # Build and run server
```

## Security

- Configuration files contain sensitive information (passwords)
- Never commit `config/remote-ssh.env` to version control
- Use appropriate file permissions: `chmod 600 config/remote-ssh.env`
- Consider using SSH key-based authentication for production

## License

MIT