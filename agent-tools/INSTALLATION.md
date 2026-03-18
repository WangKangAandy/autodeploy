# Installation Guide - Claude Remote MT-GPU Tools

This guide provides step-by-step instructions for installing and configuring the Claude Remote MT-GPU Tools plugin.

## Prerequisites

Before installing the plugin, ensure you have:

- **Node.js** >= 18.0.0 installed
- **SSH access** to your Remote MT-GPU Machine
- **Docker** installed on the remote machine (for `remote-docker` tool)
- **Claude** desktop application or CLI

Check Node.js version:
```bash
node --version  # Should be v18.0.0 or higher
```

## Installation Steps

### Step 1: Download or Clone the Plugin

Choose one of the following methods:

#### Option A: Clone from Git Repository

```bash
git clone <repository-url> ~/.claude/plugins/claude-remote-mt-gpu-tools
cd ~/.claude/plugins/claude-remote-mt-gpu-tools
```

#### Option B: Download and Extract

```bash
# Download the plugin archive
# Extract to ~/.claude/plugins/claude-remote-mt-gpu-tools
cd ~/.claude/plugins/claude-remote-mt-gpu-tools
```

### Step 2: Install Dependencies

```bash
npm install
```

This will install:
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `ssh2` - SSH client library
- Development dependencies (TypeScript, type definitions)

### Step 3: Build the Plugin

```bash
npm run build
```

This compiles the TypeScript source code to JavaScript in the `dist/` directory.

### Step 4: Configure the Plugin

Create a configuration file:

```bash
cp config/remote-ssh.env.example config/remote-ssh.env
```

Edit `config/remote-ssh.env` with your credentials:

```bash
# Remote MT-GPU Machine Connection
GPU_HOST=192.168.24.40
GPU_USER=mccxadmin
GPU_SSH_PASSWD=your_password

# Optional: Sudo password (defaults to GPU_SSH_PASSWD if not set)
MY_SUDO_PASSWD=your_sudo_password

# Optional: SSH port (default: 22)
GPU_PORT=22

# Optional: Remote working directory (default: ~)
GPU_WORK_DIR=~

# Optional: Default Docker image
TORCH_MUSA_DOCKER_IMAGE=registry.mthreads.com/public/musa-train:rc4.3.1-kuae2.1-20251014-juleng
```

Set appropriate permissions:

```bash
chmod 600 config/remote-ssh.env
```

### Step 5: Verify Installation

Start Claude and the plugin should be automatically detected and loaded.

## Configuration Options

### Using Environment Variables (Alternative)

You can set environment variables instead of using the config file:

```bash
export GPU_HOST=192.168.24.40
export GPU_USER=mccxadmin
export GPU_SSH_PASSWD=your_password
export MY_SUDO_PASSWD=your_sudo_password
```

Environment variables take precedence over config file values.

### Configuration Precedence

1. Environment variables (highest priority)
2. Config file (`config/remote-ssh.env`)
3. Default values

## Testing the Installation

### Test Basic Connectivity

```bash
# In Claude, try:
remote-exec "hostname"
```

Expected output: Your remote machine's hostname

### Test Docker Access

```bash
# Check Docker status
remote-exec "docker ps"

# Test Docker container operation (if you have a running container)
remote-docker "python --version" --name <your_container_name>
```

### Test File Synchronization

```bash
# Create a test file
echo "test content" > test.txt

# Push to remote
remote-sync --local_path test.txt --remote_path ~/test.txt --direction push

# Verify on remote
remote-exec "cat ~/test.txt"
```

## Troubleshooting Installation

### Plugin Not Detected

1. Verify the plugin directory structure:
   ```
   ~/.claude/plugins/claude-remote-mt-gpu-tools/
   ├── dist/
   │   └── server.js
   ├── src/
   ├── config/
   │   └── remote-ssh.env
   ├── package.json
   └── .mcp.json
   ```

2. Check that the build completed successfully:
   ```bash
   ls -la dist/server.js
   ```

3. Restart Claude to force plugin reload

### Build Errors

If you encounter build errors:

```bash
# Clean build artifacts
npm run clean

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Rebuild
npm run build
```

### SSH Connection Issues

1. Verify credentials in `config/remote-ssh.env`
2. Test SSH manually:
   ```bash
   ssh -p 22 $GPU_USER@$GPU_HOST
   ```
3. Check network connectivity:
   ```bash
   ping $GPU_HOST
   ```

### Missing Dependencies

If you see "Missing required env vars" error:

1. Check your config file exists and is readable:
   ```bash
   cat config/remote-ssh.env
   ```
2. Verify environment variables:
   ```bash
   env | grep GPU
   ```
3. Ensure at minimum these variables are set:
   - `GPU_HOST`
   - `GPU_USER`
   - `GPU_SSH_PASSWD`

## Uninstallation

To remove the plugin:

```bash
# Remove the plugin directory
rm -rf ~/.claude/plugins/claude-remote-mt-gpu-tools

# Remove any cached configuration
rm -f ~/.claude/remote-exec.log
```

## Updating the Plugin

To update to a new version:

```bash
cd ~/.claude/plugins/claude-remote-mt-gpu-tools

# Pull latest changes (if using git)
git pull origin main

# Reinstall dependencies
npm install

# Rebuild
npm run build

# Restart Claude
```

## Advanced Configuration

### Using Multiple Remote Machines

You can configure multiple remote machines by:

1. Creating multiple config files:
   ```
   config/remote-ssh.env         # Default
   config/remote-ssh-gpu2.env    # Second GPU
   config/remote-ssh-gpu3.env    # Third GPU
   ```

2. Setting environment variables to switch between machines:
   ```bash
   export GPU_HOST=192.168.24.41  # Switch to second GPU
   ```

### SSH Key Authentication

For better security, you can use SSH keys instead of passwords:

1. Generate SSH keys on your local machine:
   ```bash
   ssh-keygen -t rsa -b 4096
   ```

2. Copy public key to remote machine:
   ```bash
   ssh-copy-id $GPU_USER@$GPU_HOST
   ```

3. Update the plugin to use key-based authentication
   (requires modifying the SSH client implementation)

## System Requirements

### Local Machine
- **OS**: Linux, macOS, or Windows
- **Node.js**: >= 18.0.0
- **Memory**: 512MB minimum
- **Disk**: 100MB for plugin files

### Remote Machine
- **OS**: Ubuntu 20.04 or compatible Linux distribution
- **SSH Server**: OpenSSH or compatible
- **Docker**: For `remote-docker` tool
- **MUSA Driver**: For MUSA GPU operations
- **Memory**: Sufficient for your workloads
- **Network**: Reliable connection to local machine

## Next Steps

After successful installation:

1. Read the [Main Documentation](README.md) for tool usage
2. Check [Examples](EXAMPLES.md) for common workflows
3. Review [Configuration Guide](config/README_CONFIG.md) for advanced options
4. See [Migration Guide](MIGRATION.md) if coming from OpenCode tools

## Support

For installation issues:

1. Check this guide's troubleshooting section
2. Review the main README.md documentation
3. Check execution logs: `~/.claude/remote-exec.log`
4. Ensure all prerequisites are met

## Security Notes

- Configuration files contain sensitive information (passwords)
- Never commit `config/remote-ssh.env` to version control
- Use appropriate file permissions: `chmod 600 config/remote-ssh.env`
- Consider using SSH key-based authentication for production
- Regularly review and update your credentials

## Performance Considerations

- The plugin maintains SSH connections for efficiency
- File operations use rsync for optimal performance
- Timeout settings can be adjusted per operation
- Large file transfers may take considerable time

## Verification Checklist

After installation, verify:

- [ ] Plugin directory structure is correct
- [ ] Dependencies installed successfully
- [ ] Build completed without errors
- [ ] Configuration file exists and is properly formatted
- [ ] File permissions are set correctly (600)
- [ ] Basic connectivity test works
- [ ] Docker operations work (if applicable)
- [ ] File synchronization works

Once all items are verified, your installation is complete and ready for use!