# Remote MT-GPU Machine Connection Configuration

## Configuration File

Create a file named `remote-ssh.env` in the `config/` directory with the following variables:

```bash
# Remote MT-GPU Machine Connection
GPU_HOST=<remote-gpu-ip>
GPU_USER=<ssh-username>
GPU_SSH_PASSWD=<ssh-password>

# Optional: Sudo password (defaults to GPU_SSH_PASSWD if not set)
MY_SUDO_PASSWD=<optional-sudo-password>

# Optional: SSH port (default: 22)
GPU_PORT=22

# Optional: Remote working directory (default: ~)
GPU_WORK_DIR=~

# Optional: Default Docker image for remote-docker tool
TORCH_MUSA_DOCKER_IMAGE=<optional-default-image>
```

## Environment Variables (Alternative to Config File)

You can also set these variables as environment variables instead of using the config file:

```bash
export GPU_HOST=192.168.1.100
export GPU_USER=username
export GPU_SSH_PASSWD=password
export MY_SUDO_PASSWD=sudo_password  # Optional
export GPU_PORT=22  # Optional
export GPU_WORK_DIR=~  # Optional
export TORCH_MUSA_DOCKER_IMAGE=registry.mthreads.com/...  # Optional
```

## Variable Precedence

The tools will use configuration in this order of precedence:

1. Environment variables (highest priority)
2. Config file values (`config/remote-ssh.env`)
3. Default values (e.g., port 22, workdir ~)

## Required Variables

- `GPU_HOST` - Remote MT-GPU Machine hostname or IP address
- `GPU_USER` - SSH username for authentication
- `GPU_SSH_PASSWD` - SSH password for authentication

## Optional Variables

- `MY_SUDO_PASSWD` - Password for sudo operations (defaults to `GPU_SSH_PASSWD` if not set)
- `GPU_PORT` - SSH port number (default: 22)
- `GPU_WORK_DIR` - Default remote working directory (default: `~`)
- `TORCH_MUSA_DOCKER_IMAGE` - Default Docker image for `remote-docker` tool

## Security Notes

- The configuration file contains sensitive information (passwords)
- Never commit `remote-ssh.env` to version control
- The template file `remote-ssh.env.example` is safe to commit
- Use proper file permissions: `chmod 600 config/remote-ssh.env`

## Example Configuration

For a typical MUSA deployment:

```bash
# Remote MT-GPU Machine Connection
GPU_HOST=192.168.24.40
GPU_USER=mccxadmin
GPU_SSH_PASSWD=mt@24040!

# Sudo password (same as SSH password in this case)
MY_SUDO_PASSWD=mt@24040!

# SSH port (default 22 is fine)
GPU_PORT=22

# Remote working directory (home directory is fine)
GPU_WORK_DIR=~

# Default Docker image for MUSA testing
TORCH_MUSA_DOCKER_IMAGE=registry.mthreads.com/public/musa-train:rc4.3.1-kuae2.1-20251014-juleng
```

## Migration from OpenCode Tools

If you're migrating from OpenCode tools, you can copy your existing configuration:

```bash
# From your autodeploy repository
cp /path/to/autodeploy/.opencode/remote-ssh.env config/remote-ssh.env
```

The file format is compatible between OpenCode tools and Claude tools.

## Troubleshooting

### "Missing required env vars" Error

Make sure you have at least these variables set:
- `GPU_HOST`
- `GPU_USER`
- `GPU_SSH_PASSWD`

Check both:
1. Environment variables (`env | grep GPU`)
2. Config file (`cat config/remote-ssh.env`)

### SSH Connection Failures

1. Verify network connectivity: `ping $GPU_HOST`
2. Check SSH port: `nc -zv $GPU_HOST $GPU_PORT`
3. Test SSH manually: `ssh -p $GPU_PORT $GPU_USER@$GPU_HOST`
4. Verify password is correct

### Permission Denied Errors

1. Check SSH user has necessary permissions
2. Verify `MY_SUDO_PASSWD` is set correctly if using sudo
3. Test sudo manually on remote: `sudo -v`