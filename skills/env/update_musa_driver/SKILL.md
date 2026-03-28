---
version: 1
name: update_musa_driver
description: |
  Targeted MUSA driver update or reinstall workflow.
  Switches drivers quickly on an existing host without rerunning the full base environment deployment.

category: env
kind: meta
exposure: user
risk_level: idempotent
execution_mode: mixed
depends_on:
  - ensure_musa_driver

owners:
  - env-team

triggers:
  - update driver
  - upgrade driver
  - downgrade driver
  - reinstall driver
  - switch driver version
  - 更新驱动
  - 升级驱动
  - 降级驱动
  - 重装驱动
  - 切换驱动版本

scope:
  includes:
    - Driver version resolution
    - Driver installation/update
    - Optional container validation
  excludes:
    - Full base environment deployment
    - Container toolkit installation
    - System dependencies installation

orchestration_mode: sequential
failure_policy: fail_fast
---

# Update MUSA Driver (Meta Skill)

This is a **meta skill** that orchestrates atomic skills for driver-only operations. Use it when the user asks to upgrade, downgrade, reinstall, or quickly switch the MUSA driver without rerunning the full base environment flow.

## Orchestration

Step sequence and purpose only. Detailed execution logic is in Workflow section.

```
1. ensure_musa_driver → Update/install MUSA driver to target version
2. validate_musa_container_environment (optional) → Validate container environment if requested
```

## Invocation

- **Exposure**: user
- **Top-level intent**: `update_musa_driver`
- **Callable from orchestration**: No

### Invocation Example

```
musa_dispatch(intent="update_musa_driver", context={
  "MT_GPU_DRIVER_VERSION": "3.3.5-server"
})
```

## When To Use This Skill

- Update only the host driver package
- Reinstall the current driver to recover from a broken state
- Switch to another driver version that matches a known SDK mapping
- Validate host driver loading after a driver-only change

## When Not To Use This Skill

- Do not use it for a fresh machine that still needs full base environment setup (use `deploy_musa_base_env`)
- Do not use it when the user asks for container toolkit installation or full base environment setup as the main goal
- Do not add muDNN, MCCL, Triton, or other host-side packages here

## Deployment Mode Selection

**IMPORTANT: Before starting, ask the user:**

1. **Local operation**: Update driver on the current machine
2. **Remote operation**: Update driver on a remote MT-GPU machine via SSH

If remote operation is selected, collect:
- Host IP address
- SSH username
- SSH password
- SSH port (default: 22)

Then use the `musa_set_mode` tool to configure the deployment mode:

```
# For local operation:
musa_set_mode(mode="local")

# For remote operation:
musa_set_mode(mode="remote", host="192.168.1.100", user="gpuuser", password="xxx", port=22)
```

## Source Of Truth

- Full environment workflow: `deploy_musa_base_env/SKILL.md`
- SDK/driver compatibility mapping: `skills/config/env/sdk_compatibility.yml`
- MOSS download and MinIO Client setup: `references/moss-download-guide.md`
- Driver installation reference: `references/driver-install-guide.md`
- Shared container validation troubleshooting: `references/container-validation-runbook.md`
- Remote command routing: `references/remote-execution-policy.md`

## Path Resolution

Skills reference files using paths relative to the project root. Set `PROJECT_ROOT` environment variable if executing from a different directory:

```bash
export PROJECT_ROOT="/path/to/autodeploy"
```

Default behavior uses the skill file's location to resolve relative paths.

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `MT_GPU_DRIVER_VERSION` | Target driver version (e.g., `3.3.5-server`) | Preferred | - |
| `MUSA_SDK_VERSION` | SDK version used to resolve compatible driver | Optional | - |
| `MT_GPU_TYPE` | GPU type used for compatibility lookup | Optional | - |
| `MT_GPU_ARCH` | GPU architecture suffix | Optional | - |
| `DRIVER_PACKAGE_PATH` | Pre-downloaded local driver package path | Optional | - |
| `DOCKER_IMAGE` | Validation image when optional container check is requested | Optional | - |

## Driver Resolution Rules

- If `MT_GPU_DRIVER_VERSION` is provided, use it directly.
- If only `MUSA_SDK_VERSION` is provided, resolve `driver_version` from `sdk_compatibility.yml`.
- If both are provided, verify they do not conflict with a known compatibility mapping.
- If no mapping matches, ask the user for the exact driver version instead of guessing.

## Input / Output Mapping

| From | To | Description |
|------|----|-------------|
| `context.MT_GPU_DRIVER_VERSION` | `ensure_musa_driver.input.MT_GPU_DRIVER_VERSION` | Target driver version |
| `context.MUSA_SDK_VERSION` | `ensure_musa_driver.input.MUSA_SDK_VERSION` | SDK version for compatibility |
| `context.DRIVER_PACKAGE_PATH` | `ensure_musa_driver.input.DRIVER_PACKAGE_PATH` | Pre-downloaded package path |
| `context.DOCKER_IMAGE` | `validate_musa_container_environment.input.DOCKER_IMAGE` | Validation image |

### Example

```
context.MT_GPU_DRIVER_VERSION → ensure_musa_driver.input.MT_GPU_DRIVER_VERSION
context.MUSA_SDK_VERSION → ensure_musa_driver.input.MUSA_SDK_VERSION
context.DOCKER_IMAGE → validate_musa_container_environment.input.DOCKER_IMAGE
```

## Execution Mode

Mixed: local for input collection, remote for execution on MT-GPU machine.

| Mode | Behavior |
|------|----------|
| `local` | Execute all atomic skills directly on host |
| `remote` | Execute all atomic skills via SSH on remote host |
| `mixed` | Different atomic skills may use different modes |

## State Persistence

State file: `./.musa_driver_update_state.json`

### State Values

- `initialized` - Skill started
- `driver_updated` - ensure_musa_driver completed
- `validated` - Optional container validation completed
- `completed` - All steps done
- `failed_at_driver` - ensure_musa_driver failed
- `failed_at_validation` - validate_musa_container_environment failed

## Resume Behavior

- **Resume supported**: Yes
- **Resume from states**:
  - `driver_updated` → continue from validation step (if requested)

## Workflow

### Step 1: Collect Inputs

**Action**:
```bash
# Determine target driver version
CONFIG_PATH="${PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || echo '.')}/skills/config/env/sdk_compatibility.yml"

if [ -n "$MT_GPU_DRIVER_VERSION" ]; then
    TARGET_VERSION="$MT_GPU_DRIVER_VERSION"
elif [ -n "$MUSA_SDK_VERSION" ]; then
    TARGET_VERSION=$(yq '.compatibility[] | select(.sdk_version == "'$MUSA_SDK_VERSION'") | .driver_version' "$CONFIG_PATH")
else
    # Ask user for target version
    echo "Please specify target driver version"
fi
```

**Save state**: `initialized`

**Verification**:
- Target driver version resolved

---

### Step 2: Execute ensure_musa_driver

**Action**:
```
Call ensure_musa_driver
  → Input: MT_GPU_DRIVER_VERSION=$TARGET_VERSION, MUSA_SDK_VERSION, DRIVER_PACKAGE_PATH
  → Output: driver updated and loaded
```

**Save state**: `driver_updated`

**Verification**:
- ensure_musa_driver returned status `completed`
- mthreads-gmi shows new version

---

### Step 3: Optional Container Validation

If the matching entry in `sdk_compatibility.yml` includes `supported_images`, ask the user whether they want to launch one of those images for post-update validation.

The user may choose to skip container validation.

Only do container validation if all of the following are true:
- `mt-container-toolkit` is already installed
- Docker is running
- the compatibility mapping has a supported image for the target environment
- the user explicitly chooses to run the validation container

If validation is requested:
```
Call validate_musa_container_environment
  → Input: DOCKER_IMAGE
  → Output: validation passed
```

**Save state**: `validated`

**Verification**:
- validate_musa_container_environment returned status `completed`

---

### Step 4: Final Summary

**Action**:
```bash
echo "=========================================
MUSA Driver Update Complete
=========================================
Previous Version: $PREVIOUS_VERSION
Installed Version: $INSTALLED_VERSION
Container Validated: $VALIDATION_REQUESTED
========================================="
```

**Save state**: `completed`

**Verification**:
- All requested steps completed

## Error Handling

System behavior when atomic skill fails (per `failure_policy: fail_fast`):

1. Save checkpoint to state file with `failed_at_<step>`
2. Report which skill failed and error details
3. Abort execution - do not continue to next step

```
Error in step 2 (ensure_musa_driver):
  Driver installation failed: package not found

To retry:
  1. Fix the issue (check MOSS connectivity)
  2. Re-run - will resume from step 2
```

## Success Criteria

- Driver updated to target version
- mthreads-gmi shows correct version
- Container validation passed (if requested)

### Example Checks

- mthreads-gmi shows target version
- Driver module loaded (lsmod | grep mtgpu)
- Container can access GPU (if validated)

## Final Output Mapping

| From | To | Description |
|------|----|-------------|
| `ensure_musa_driver.output.previousVersion` | `meta.output.previousVersion` | Version before update |
| `ensure_musa_driver.output.installedVersion` | `meta.output.installedVersion` | Installed driver version |
| `validate_musa_container_environment.output.validationPassed` | `meta.output.validationPassed` | Container validation status |

### Example

```
ensure_musa_driver.output.installedVersion → meta.output.installedVersion
validate_musa_container_environment.output.validationPassed → meta.output.validationPassed
```

## Outputs

### Output Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | Execution status: `completed` / `failed` |
| `steps_completed` | string[] | Yes | List of completed atomic skill IDs |
| `previousVersion` | string | No | Driver version before update |
| `installedVersion` | string | No | Installed driver version |
| `validationPassed` | boolean | No | Container validation status |

### Output Example

```json
{
  "status": "completed",
  "steps_completed": ["ensure_musa_driver", "validate_musa_container_environment"],
  "previousVersion": "3.3.4-server",
  "installedVersion": "3.3.5-server",
  "validationPassed": true
}
```

## Atomic Skills Reference

<!-- Recommended but not mandatory - omit if redundant with Orchestration section -->

| Skill | Purpose | File | Required |
|-------|---------|------|----------|
| `ensure_musa_driver` | Install/verify driver | `skills/env/ensure_musa_driver/SKILL.md` | Yes |
| `validate_musa_container_environment` | Validate container | `skills/env/validate_musa_container_environment/SKILL.md` | No |

## Important Rules

1. **User intent entry point**: This skill is the user-facing entry for "update driver" requests
2. **Reuses ensure_musa_driver**: The actual driver work is done by the atomic skill
3. **Optional validation**: Container validation is optional and only if user requests it
4. **No container management**: Do not stop or manage existing containers during driver update

## Troubleshooting

Manual debugging guidance for common failures.

### Common Issues

1. **Driver installation fails** - Check MOSS access, package availability
2. **Driver module fails to load** - Check kernel headers, may need reboot
3. **Container validation fails** - See `references/container-validation-runbook.md`