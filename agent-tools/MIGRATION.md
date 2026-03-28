# Migration Guide: OpenCode Tools → Claude Tools

This guide helps you migrate from OpenCode tools to Claude tools for Remote MT-GPU execution.

## Overview

The Claude tools provide 100% API compatibility with the OpenCode tools. This means:
- Same tool names: `remote-exec`, `remote-docker`, `remote-sync`
- Same parameters and behavior
- Same configuration format
- Same error handling

## Quick Migration Steps

### 1. Install the Claude Plugin

```bash
# Clone or download the plugin
git clone <repository-url> ~/.claude/plugins/claude-remote-mt-gpu-tools
cd ~/.claude/plugins/claude-remote-mt-gpu-tools

# Install and build
npm install
npm run build
```

### 2. Copy Your Configuration

```bash
# From your autodeploy repository
cp /path/to/autodeploy/agent-tools/config/remote-ssh.env.example config/remote-ssh.env
```

The configuration file format is identical and fully compatible.

### 3. Verify Installation

Start Claude and check if the tools are available:
- The tools should appear in Claude's available tools list
- Tool descriptions should match the OpenCode versions

### 4. Test Basic Functionality

```bash
# Test remote connection
remote-exec "hostname"

# Test Docker operations
remote-docker "docker ps"

# Test file sync
remote-sync --local_path test.txt --remote_path ~/test.txt --direction push
```

## Configuration Compatibility

### OpenCode Configuration Format

```bash
# .opencode/remote-ssh.env
GPU_HOST=192.168.24.40
GPU_USER=mccxadmin
GPU_SSH_PASSWD=mt@24040!
MY_SUDO_PASSWD=mt@24040!
GPU_PORT=22
GPU_WORK_DIR=~
TORCH_MUSA_DOCKER_IMAGE=registry.mthreads.com/public/musa-train:rc4.3.1-kuae2.1-20251014-juleng
```

### Claude Tools Configuration Format

```bash
# config/remote-ssh.env
GPU_HOST=192.168.24.40
GPU_USER=mccxadmin
GPU_SSH_PASSWD=mt@24040!
MY_SUDO_PASSWD=mt@24040!
GPU_PORT=22
GPU_WORK_DIR=~
TORCH_MUSA_DOCKER_IMAGE=registry.mthreads.com/public/musa-train:rc4.3.1-kuae2.1-20251014-juleng
```

✅ **Identical format** - you can simply copy the file.

## Tool API Compatibility

### remote-exec

| Parameter | OpenCode | Claude | Notes |
|-----------|----------|--------|-------|
| `command` | ✅ | ✅ | Required |
| `workdir` | ✅ | ✅ | Optional, defaults to GPU_WORK_DIR |
| `sudo` | ✅ | ✅ | Optional, defaults to false |
| `timeout` | ✅ | ✅ | Optional, defaults to 120 |

**Example:**

```bash
# OpenCode
remote-exec "mthreads-gmi" --sudo --timeout 60

# Claude (identical)
remote-exec "mthreads-gmi" --sudo --timeout 60
```

### remote-docker

| Parameter | OpenCode | Claude | Notes |
|-----------|----------|--------|-------|
| `command` | ✅ | ✅ | Required |
| `image` | ✅ | ✅ | Optional for docker run |
| `name` | ✅ | ✅ | Optional for docker exec |
| `workdir` | ✅ | ✅ | Optional, defaults to /workspace |
| `visible_devices` | ✅ | ✅ | Optional, defaults to "all" |
| `shm_size` | ✅ | ✅ | Optional, defaults to "16G" |
| `volumes` | ✅ | ✅ | Optional |
| `env_vars` | ✅ | ✅ | Optional |
| `sudo` | ✅ | ✅ | Optional, defaults to false |
| `timeout` | ✅ | ✅ | Optional, defaults to 300 |

**Example:**

```bash
# OpenCode
remote-docker "python --version" --name torch_musa_test --workdir "/workspace"

# Claude (identical)
remote-docker "python --version" --name torch_musa_test --workdir "/workspace"
```

### remote-sync

| Parameter | OpenCode | Claude | Notes |
|-----------|----------|--------|-------|
| `local_path` | ✅ | ✅ | Required |
| `remote_path` | ✅ | ✅ | Required |
| `direction` | ✅ | ✅ | Optional, defaults to "push" |
| `delete` | ✅ | ✅ | Optional, defaults to false |
| `exclude` | ✅ | ✅ | Optional |
| `timeout` | ✅ | ✅ | Optional, defaults to 600 |

**Example:**

```bash
# OpenCode
remote-sync --local_path ./project --remote_path ~/workspace/project --direction push --exclude '["*.tmp"]'

# Claude (identical)
remote-sync --local_path ./project --remote_path ~/workspace/project --direction push --exclude '["*.tmp"]'
```

## Workflow Compatibility

### MUSA Deployment Workflow

The existing workflows in `skills/deploy_musa_base_env/SKILL.md` and `skills/update_musa_driver/SKILL.md` work without modification:

```bash
# System dependencies (unchanged)
remote-exec "apt update"
remote-exec "apt install -y lightdm dkms libgbm1" --sudo

# Driver installation (unchanged)
remote-exec "dpkg -i ./musa_packages/musa_3.3.1-server_amd64.deb" --sudo
remote-exec "modprobe mtgpu" --sudo

# Container toolkit (unchanged)
remote-exec "(cd /usr/bin/musa && ./docker setup \$PWD)" --sudo

# Docker operations (unchanged)
remote-docker "docker pull registry.mthreads.com/public/musa-train:..."
remote-docker "musaInfo" --name torch_musa_test

# Validation (unchanged)
remote-exec "mthreads-gmi"
```

## Technical Differences

While the API is identical, there are some internal differences:

| Aspect | OpenCode | Claude |
|--------|----------|--------|
| SSH Implementation | `sshpass` + Bun.spawn | `ssh2` npm package |
| Connection Management | Process-based | Connection pooling |
| Error Handling | Try-catch with process exit | Promise-based with proper error propagation |
| Configuration Loading | Plugin hooks | Direct tool implementation |
| Logging | Plugin hooks | Dedicated logger class |
| Transport | OpenCode protocol | MCP (Model Context Protocol) |

These internal differences don't affect the external API or behavior.

## Environment Differences

### OpenCode Environment

- Requires OpenCode platform
- Uses `.opencode/` directory for configuration
- Plugin system for environment injection

### Claude Environment

- Runs in Claude agent environment
- Uses `config/` directory for configuration
- Direct environment variable access
- Standalone MCP server

## Migration Checklist

- [ ] Install Claude plugin
- [ ] Copy configuration file
- [ ] Test basic connectivity
- [ ] Test remote-exec tool
- [ ] Test remote-docker tool
- [ ] Test remote-sync tool
- [ ] Verify MUSA deployment workflow
- [ ] Update documentation if needed
- [ ] Train team on Claude tool usage

## Rollback Plan

If you need to roll back to OpenCode tools:

1. The OpenCode tools remain functional
2. Configuration is shared between both systems
3. Workflows work identically in both systems
4. Simply use OpenCode instead of Claude

## Support

For migration issues:

1. Check configuration in `config/remote-ssh.env`
2. Verify plugin installation with `npm run build`
3. Check execution logs in `.claude/remote-exec.log`
4. Test basic connectivity
5. Consult main documentation in [INSTALLATION.md](INSTALLATION.md)

## Summary

The migration from OpenCode tools to Claude tools is straightforward:

✅ Same API
✅ Same configuration
✅ Same behavior
✅ Same workflows
✅ Zero code changes required

The only steps are:
1. Install the Claude plugin
2. Copy your configuration
3. Start using Claude instead of OpenCode

Everything else works exactly the same!