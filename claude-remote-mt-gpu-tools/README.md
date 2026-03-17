# Claude Remote MT-GPU Tools

Claude tools for Remote MT-GPU Machine execution via SSH. This plugin provides Claude agents with the ability to execute commands on remote MT-GPU machines, run Docker containers with GPU access, and synchronize files between local and remote systems.

## Features

- **Remote Command Execution** (`remote-exec`): Execute shell commands on remote MT-GPU machines via SSH
- **Docker Container Operations** (`remote-docker`): Run commands inside Docker containers with MT-GPU access using `--runtime=mthreads`
- **File Synchronization** (`remote-sync`): Sync files between local and remote machines using rsync over SSH
- **Environment Management**: Support for both config file and environment variable configuration
- **Sudo Support**: Execute privileged operations with password authentication
- **GPU Runtime**: Full support for MUSA GPU runtime configuration

## Installation

### Prerequisites

- Node.js >= 18.0.0
- SSH access to your Remote MT-GPU Machine
- Docker installed on the remote machine (for `remote-docker` tool)

### Install the Plugin

1. Clone or download this repository:

```bash
git clone <repository-url> ~/.claude/plugins/claude-remote-mt-gpu-tools
cd ~/.claude/plugins/claude-remote-mt-gpu-tools
```

2. Install dependencies:

```bash
npm install
```

3. Build the plugin:

```bash
npm run build
```

4. Configure the connection (see Configuration section below)

Claude will automatically detect and load the plugin.

## Configuration

### Option 1: Config File (Recommended)

Create a configuration file:

```bash
cp config/remote-ssh.env.example config/remote-ssh.env
# Edit config/remote-ssh.env with your credentials
```

Edit `config/remote-ssh.env`:

```bash
GPU_HOST=192.168.24.40
GPU_USER=mccxadmin
GPU_SSH_PASSWD=your_password
MY_SUDO_PASSWD=your_sudo_password  # Optional
GPU_PORT=22  # Optional
GPU_WORK_DIR=~  # Optional
TORCH_MUSA_DOCKER_IMAGE=registry.mthreads.com/...  # Optional
```

Set appropriate permissions:

```bash
chmod 600 config/remote-ssh.env
```

### Option 2: Environment Variables

Set environment variables instead of using a config file:

```bash
export GPU_HOST=192.168.24.40
export GPU_USER=mccxadmin
export GPU_SSH_PASSWD=your_password
export MY_SUDO_PASSWD=your_sudo_password
```

### Configuration Precedence

1. Environment variables (highest priority)
2. Config file values
3. Default values

See [config/README_CONFIG.md](config/README_CONFIG.md) for detailed configuration documentation.

## Usage

### Available Tools

#### 1. remote-exec

Execute shell commands on the remote MT-GPU machine.

**Parameters:**
- `command` (required): The shell command to execute
- `workdir` (optional): Remote working directory
- `sudo` (optional): Run through sudo using MY_SUDO_PASSWD
- `timeout` (optional): Timeout in seconds (default: 120)

**Examples:**

```bash
# Check GPU driver status
remote-exec "mthreads-gmi"

# Install a package
remote-exec "apt update && apt install -y curl" --sudo

# Run in specific directory
remote-exec "pwd" --workdir "/tmp"

# Check Docker status
remote-exec "docker ps"
```

#### 2. remote-docker

Run commands inside Docker containers on the remote machine with MT-GPU access.

**Parameters:**
- `command` (required): The command to run inside the container
- `image` (optional): Docker image for `docker run` mode
- `name` (optional): Container name for `docker exec` mode
- `workdir` (optional): Working directory inside container (default: /workspace)
- `visible_devices` (optional): MTHREADS_VISIBLE_DEVICES value (default: all)
- `shm_size` (optional): Shared memory size (default: 16G)
- `volumes` (optional): Volume mounts
- `env_vars` (optional): Extra environment variables
- `sudo` (optional): Run docker command through sudo
- `timeout` (optional): Timeout in seconds (default: 300)

**Examples:**

```bash
# Run in existing container
remote-docker "python --version" --name torch_musa_test

# Run in new container with GPU access
remote-docker "python -c 'print(\"hello\")'" --image "ubuntu:20.04"

# Check MUSA availability
remote-docker "musaInfo" --name torch_musa_test

# Test PyTorch MUSA
remote-docker "python -c 'import torch; print(torch.musa.is_available())'" --name torch_musa_test

# Run with custom workdir and volumes
remote-docker "python train.py" --name torch_musa_test --workdir "/workspace/project" --volumes '["/data:/data"]'
```

#### 3. remote-sync

Sync files between local and remote machines.

**Parameters:**
- `local_path` (required): Local file or directory path
- `remote_path` (required): Remote file or directory path
- `direction` (optional): Sync direction: 'push' or 'pull' (default: push)
- `delete` (optional): Delete files in destination that don't exist in source (default: false)
- `exclude` (optional): Patterns to exclude from sync
- `timeout` (optional): Timeout in seconds (default: 600)

**Examples:**

```bash
# Push local files to remote
remote-sync --local_path "./project" --remote_path "~/workspace/project" --direction push

# Pull remote files to local
remote-sync --local_path "./logs" --remote_path "~/workspace/logs" --direction pull

# Push with exclusions
remote-sync --local_path "./project" --remote_path "~/workspace/project" --exclude '["*.tmp", ".git"]' --direction push

# Pull with deletion
remote-sync --local_path "./download" --remote_path "~/workspace/results" --delete --direction pull
```

## MUSA Environment Deployment

These tools are designed to work with MUSA SDK deployment workflows. Example validation commands:

```bash
# Check driver installation
remote-exec "mthreads-gmi"

# Validate container toolkit
remote-exec "docker run --rm --env MTHREADS_VISIBLE_DEVICES=all registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi"

# Validate MUSA in container
remote-docker "musaInfo" --name torch_musa_test

# Validate PyTorch MUSA
remote-docker "python -c 'import torch; print(torch.musa.is_available()); print(torch.tensor(1, device=\"musa\") + 1)'" --name torch_musa_test
```

## Migration from OpenCode Tools

If you're migrating from OpenCode tools, the interface is 100% compatible:

1. Copy your existing configuration:
   ```bash
   cp /path/to/autodeploy/.opencode/remote-ssh.env config/remote-ssh.env
   ```

2. The tools have the same parameters and behavior as the OpenCode versions

3. Existing workflows from `skills/deploy_musa_base_env/SKILL.md` and `skills/update_musa_driver/SKILL.md` work without modification

## Architecture

### Components

- **MCP Server**: Main server implementation using `@modelcontextprotocol/sdk`
- **SSH Client**: `ssh2` package for SSH connections
- **Tools**: Three tools (remote-exec, remote-docker, remote-sync) with identical APIs to OpenCode versions
- **Configuration**: Dual-source configuration (file + environment variables)
- **Logging**: Execution audit trail in `.claude/remote-exec.log`

### Technology Stack

- **TypeScript**: Type-safe implementation
- **ssh2**: SSH client library (replaces `sshpass` for better connection management)
- **@modelcontextprotocol/sdk**: MCP protocol implementation
- **rsync**: File synchronization (executed locally)

### Key Features

- Connection pooling and reuse
- Timeout handling
- Output truncation (50KB limit)
- Error handling with clear messages
- Audit logging
- Graceful shutdown

## Troubleshooting

### Common Issues

**"Missing required env vars" error**
- Ensure `GPU_HOST`, `GPU_USER`, and `GPU_SSH_PASSWD` are set
- Check both environment variables and config file

**SSH connection failures**
- Verify network connectivity: `ping $GPU_HOST`
- Check SSH port: `nc -zv $GPU_HOST $GPU_PORT`
- Test SSH manually: `ssh -p $GPU_PORT $GPU_USER@$GPU_HOST`

**Permission denied errors**
- Verify SSH user has necessary permissions
- Check `MY_SUDO_PASSWD` is set correctly if using sudo
- Test sudo manually on remote: `sudo -v`

**Docker runtime not found**
- Ensure MT container toolkit is installed on the remote machine
- Check Docker status: `remote-exec "docker ps"`
- Verify runtime: `remote-exec "docker info | grep -i runtime"`

### Debug Mode

Check execution logs:

```bash
cat .claude/remote-exec.log
```

## Development

### Build

```bash
npm run build
```

### Clean

```bash
npm run clean
```

### Development Mode

```bash
npm run dev
```

## Security

- Configuration files contain sensitive information (passwords)
- Never commit `config/remote-ssh.env` to version control
- Use appropriate file permissions: `chmod 600 config/remote-ssh.env`
- Consider using SSH key-based authentication for production deployments
- Audit logs are stored in `.claude/remote-exec.log`

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues and questions:
- Check the [troubleshooting section](#troubleshooting)
- Review [configuration documentation](config/README_CONFIG.md)
- Check execution logs in `.claude/remote-exec.log`
- Ensure you have the latest version installed

## Acknowledgments

This plugin is designed to provide the same functionality as the OpenCode tools for remote MT-GPU machine execution, enabling Claude agents to work with MUSA SDK environments efficiently.