# .opencode

This directory contains the OpenCode plugin and custom tools used by this repository.

## Files

- `plugin/remote-ssh.ts`: injects remote SSH-related environment variables into tool execution
- `tools/remote-exec.ts`: runs commands on the remote host via SSH
- `tools/remote-docker.ts`: runs commands inside a Docker container on the remote host
- `tools/remote-sync.ts`: checked-in placeholder; not yet implemented locally
- `remote-ssh.env.example`: template for local remote connection configuration

## Local Setup

```bash
cd .opencode
bun install
cp remote-ssh.env.example remote-ssh.env
```

Keep `remote-ssh.env` local only. It stays gitignored even though the template is published.
Set `MY_SUDO_PASSWD` only when sudo differs from `GPU_SSH_PASSWD`; otherwise the tools fall back to the SSH password.
