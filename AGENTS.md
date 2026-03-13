# AGENTS.md

## Purpose
This repository is an automation workspace for MUSA SDK environment setup, remote MT-GPU execution, and deployment documentation.
Agents working here should prefer repo-documented workflows over generic guesses.
When instructions conflict, prefer `skills/` workflow definitions over `docs/` reference material.

## Repository Map
- `docs/单机环境部署.md`: reference notes for manual single-machine deployment.
- `docs/参考：本地部署环境.md`: reference-only host-side installation notes; not the primary automation source.
- `references/remote-execution-policy.md`: source of truth for local vs remote command routing.
- `skills/deploy_musa_base_env/SKILL.md`: primary source for the automated local deployment workflow and validation checklist.
- `skills/update_musa_driver/SKILL.md`: targeted workflow for fast driver-only upgrade, downgrade, or reinstall.
- `skills/deploy_musa_base_env/config/container_toolkit.yml`: container toolkit version metadata.
- `skills/deploy_musa_base_env/config/sdk_compatibility.yml`: SDK/driver/environment/supported-image compatibility mapping.
- `.opencode/plugin/remote-ssh.ts`: plugin that injects remote env vars and logs remote tool usage.
- `.opencode/tools/remote-exec.ts`: remote host command runner.
- `.opencode/tools/remote-docker.ts`: remote container command runner.
- `.opencode/tools/remote-sync.ts`: checked in as an empty placeholder; do not assume local implementation details from this file.

## Build Commands
The repo is mostly docs plus a small TypeScript OpenCode plugin/tooling layer. There is no root app, repo-wide build script, or conventional automated test suite.
Use these commands when you need to prepare or validate the local tool layer.

For deployment behavior, treat `skills/deploy_musa_base_env/SKILL.md` as authoritative.
Do not expand the default local SDK 4.3.1 flow into muDNN, MCCL, Triton, or other full host-side packages unless the user explicitly asks for them.
For driver-only requests, prefer `skills/update_musa_driver/SKILL.md` instead of overloading the full deployment workflow.

```bash
cd .opencode && bun install
```

### Local TypeScript smoke check
There is no `tsconfig.json`, `build` script, or repo-wide compile command. If you edit a single OpenCode tool file, use Bun to load that file directly:

```bash
cd .opencode && bun --eval "await import('./tools/remote-exec.ts')"
cd .opencode && bun --eval "await import('./tools/remote-docker.ts')"
cd .opencode && bun --eval "await import('./plugin/remote-ssh.ts')"
```

## Lint Commands
- No linter is configured in this repository.
- No `lint`, `format`, or `check` script exists in `.opencode/package.json`.
- If you add a linter later, document the exact command here and in the relevant package manifest.

## Test Commands
This repo relies on targeted environment validation rather than a conventional unit test suite.

### Host validation
```bash
mthreads-gmi
```

### Container toolkit validation
```bash
docker run --rm --env MTHREADS_VISIBLE_DEVICES=all \
  registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi
```

### Start a test container
```bash
image_name=<image_name>
docker run -itd \
  --name=torch_musa_test \
  --env MTHREADS_VISIBLE_DEVICES=all \
  --shm-size=80g \
  --network=host \
  --privileged \
  --pid=host \
  -v /data:/data \
  "$image_name" bash
```

### In-container validation
```bash
docker exec torch_musa_test musaInfo
docker exec torch_musa_test python -c "import torch; print(torch.musa.is_available()); print(torch.tensor(1, device='musa') + 1)"
```

### Single-test guidance
There is no framework-level single-test command such as `pytest path::test_name` or `bun test file.test.ts` in this repo.
For a single targeted check, run only the narrow validation you need:

- Driver only: `mthreads-gmi`
- Container runtime only: `docker run --rm --env MTHREADS_VISIBLE_DEVICES=all registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi`
- MUSA tools only: `docker exec torch_musa_test musaInfo`
- PyTorch MUSA only: `docker exec torch_musa_test python -c "import torch; print(torch.musa.is_available())"`

## Remote Execution Rules
Follow `references/remote-execution-policy.md` when commands target the Remote MT-GPU Machine.

- Use `remote-exec` for host-level remote commands such as `dpkg`, `systemctl`, driver checks, and Docker management.
- Use `remote-docker` for commands that should run inside a remote container.
- Use local file tools and local shell only for workspace inspection, editing, and local dependency work.
- Do not replace remote steps with local Bash commands.

## Remote Path Conventions
- Local workspace: `repositories/<project-name>/`
- Remote host: `~/workspace/<project-name>/`
- Container path: `/workspace/<project-name>/`

The policy docs assume `~/workspace` is mounted into the container as `/workspace`.

## Credentials And State
- Remote credentials come from environment variables or `.opencode/remote-ssh.env`.
- Expected vars: `GPU_HOST`, `GPU_USER`, `GPU_SSH_PASSWD`, optional `GPU_PORT`, `GPU_WORK_DIR`, `TORCH_MUSA_DOCKER_IMAGE`.
- Host install flows may also use `MY_SUDO_PASSWD` for privileged package installation.
- Do not assume Docker registry auth is required for local SDK 4.3.1 installation unless the active skill or the user explicitly requires a private image pull.
- State files mentioned by docs include `./.musa_sdk_install_state.json` and `./.musa_deployment_state.json`.
- Never commit credentials, passwords, or generated state files unless the user explicitly asks.

## Operational Constraints
- For local installation requests in this repo, default to the `deploy_musa_base_env` scope: system dependencies, driver, container toolkit, image-based container startup, and validation.
- Do not add muDNN, MCCL, Triton, or other extra host-side components unless the user explicitly requests the broader stack.
- Never auto-run `sudo reboot`.
- After driver installation, prefer the documented manual driver reload path first, for example `modprobe -rv mtgpu && modprobe mtgpu` or `sudo modprobe mtgpu` when applicable.
- Ask for a manual reboot only if the documented reload path fails or the environment explicitly requires reboot to finish loading the driver.
- Do not use sudo credentials for `git` operations or `docker pull`.
- Verify `mc` means MinIO Client, not Midnight Commander, before following MOSS download steps.
- Prefer targeted verification after each install step instead of batching many opaque commands together.

## Code Style Guidelines
These rules are inferred from the checked-in TypeScript files and the existing Markdown docs.

### Imports
- Order imports as: package imports first, then Node built-ins, then local modules.
- Use `import type` for type-only imports, as in `.opencode/plugin/remote-ssh.ts`.
- Prefer namespace imports for Node built-ins when that matches existing code, for example `import * as fs from "fs"`.

### Formatting
- Use 2-space indentation in TypeScript and Markdown lists.
- Use double quotes in TypeScript.
- Omit semicolons; existing TS files are semicolon-free.
- Prefer readable wrapped arrays and object literals over dense one-line declarations.

### Types
- Add explicit types for non-trivial values and helper return types.
- Prefer `Record<string, string>` for string maps, matching current code.
- Type plugin entry points explicitly, for example `const RemoteSSHPlugin: Plugin = async (...) =>`.
- Avoid `any` except at external boundaries where the runtime truly returns unknown shaped errors.

### Naming
- Use `camelCase` for variables and functions.
- Use `PascalCase` for plugin objects and types.
- Use `UPPER_SNAKE_CASE` for constants like `SSH_FLAGS`.
- Keep names descriptive and operationally clear; favor `visibleDevices` over short abbreviations.

### Error Handling
- Fail early when required env vars are missing.
- Return actionable error messages that name the missing variables or failed prerequisite.
- Use narrow `try/catch` blocks around filesystem or process boundaries.
- Preserve stderr in returned command output so remote failures remain debuggable.

### Shell And Command Style
- Use `set -euo pipefail` in any new shell script.
- Quote variable expansions unless unquoted expansion is required.
- Separate host validation, container validation, and Python validation into distinct commands.

### Documentation Style
- Keep operational docs step-based and command-first.
- Include exact verification commands after each major install step.
- Preserve existing bilingual documentation where helpful; do not translate technical filenames or commands.

## Configuration Rules
No `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md` files exist in this repository today.

## When Updating This File
- Prefer facts verified from the repo over aspirational guidance.
- If you add a real script, linter, or test runner, update the exact command here.
- If `remote-sync` gains an implementation, document the real invocation and constraints.
