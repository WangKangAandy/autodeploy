# .opencode

This directory contains the OpenCode plugin for remote SSH configuration injection.

## Files

- `plugin/remote-ssh.ts`: injects remote SSH-related environment variables into tool execution
- `remote-ssh.env.example`: template for local remote connection configuration

## Note

The OpenCode tools (`remote-exec`, `remote-docker`, `remote-sync`) have been migrated to the unified `agent-tools/` package.

For tool usage, see:
- `agent-tools/README.md` - Complete tool documentation
- `agent-tools/src/core/` - Core executor functions for direct import

## Local Setup

If using the OpenCode plugin:

```bash
cd .opencode
bun install
cp remote-ssh.env.example remote-ssh.env
```

Keep `remote-ssh.env` local only. It stays gitignored even though the template is published.
Set `MY_SUDO_PASSWD` only when sudo differs from `GPU_SSH_PASSWD`; otherwise the tools fall back to the SSH password.