---
version: 1
name: deploy_musa_base_env
description: |
  Deploy MUSA GPU container runtime environment on bare-metal hosts.

  **Scope**: System dependencies → GPU driver → Container toolkit → Docker image → Container validation

  **NOT in scope**:
  - MUSA toolkits (mcc, mublas, mufft, etc.) - these are bundled in Docker images
  - Application-level libraries (PyTorch, TensorFlow) - use pre-built images

category: env
kind: meta
exposure: user
risk_level: idempotent
execution_mode: mixed
depends_on: []

owners:
  - env-team

triggers:
  - deploy MUSA container runtime
  - setup MUSA Docker environment
  - 配置 MUSA 容器运行时
  - 安装 MUSA GPU 驱动
  - MUSA Docker 环境部署
  - 部署 MUSA 环境

scope:
  includes:
    - System dependencies (build-essential, dkms, etc.)
    - GPU driver installation
    - Container toolkit installation and Docker binding
    - Docker image pull
    - Container GPU access validation
  excludes:
    - MUSA toolkits (mcc, mublas, mufft, muPP, etc.)
    - Deep learning frameworks (PyTorch, TensorFlow)
    - Application deployment

orchestration_mode: sequential
failure_policy: fail_fast
---

# MUSA Full Environment Deployment (Meta Skill)

This is a **meta skill** that orchestrates atomic skills for complete MUSA environment deployment. It does not execute commands directly, but coordinates atomic skills in sequence.

## Orchestration

Step sequence and purpose only. Detailed execution logic is in Workflow section.

```
1. ensure_system_dependencies → Install system packages
2. ensure_musa_driver → Install/verify MUSA GPU driver
3. ensure_mt_container_toolkit → Install/verify container toolkit
4. manage_container_images → Pull Docker runtime image
5. validate_musa_container_environment → Validate MUSA in container
```

## Invocation

- **Exposure**: user
- **Top-level intent**: `deploy_musa_base_env`
- **Callable from orchestration**: No

### Invocation Example

```
musa_dispatch(intent="deploy_musa_base_env", context={
  "MUSA_SDK_VERSION": "4.3.5",
  "MT_GPU_DRIVER_VERSION": "3.3.5-server"
})
```

## When To Use This Skill

- Fresh machine setup for MUSA GPU development
- Full environment deployment after OS reinstall
- When all layers need to be set up (driver + toolkit + container)

## When Not To Use This Skill

- Driver-only update (use `update_musa_driver`)
- Container validation only (use `validate_musa_container_environment`)
- Application deployment (use workload skills)

## Deployment Mode Selection

**IMPORTANT: Before starting deployment, ask the user:**

1. **Local deployment**: Deploy on the current machine
2. **Remote deployment**: Deploy on a remote MT-GPU machine via SSH

If remote deployment is selected, collect:
- Host IP address
- SSH username
- SSH password
- SSH port (default: 22)

Then use the `musa_set_mode` tool to configure the deployment mode:

```
# For local deployment:
musa_set_mode(mode="local")

# For remote deployment:
musa_set_mode(mode="remote", host="192.168.1.100", user="gpuuser", password="xxx", port=22)
```

## Source Of Truth

- SDK/driver compatibility mapping: `skills/config/env/sdk_compatibility.yml`
- Container toolkit versions: `skills/config/env/container_toolkit.yml`
- MOSS download and MinIO Client setup: `references/moss-download-guide.md`
- Driver installation reference: `references/driver-install-guide.md`
- Container validation troubleshooting: `references/container-validation-runbook.md`
- Remote command routing: `references/remote-execution-policy.md`

## Prerequisites

### System Requirements
- Ubuntu 20.04 or compatible Linux distribution
- Docker installed and running
- Internet connectivity for package downloads
- Sudo privileges for system package installation
- `yq` installed (for config parsing, installed by `ensure_system_dependencies`)

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `MUSA_SDK_VERSION` | MUSA SDK version | Yes | Read from config |
| `MT_GPU_DRIVER_VERSION` | GPU driver version | Yes | Read from config |
| `MT_GPU_TYPE` | GPU type (S5000/S4000) | No | S5000 |
| `MT_GPU_ARCH` | Architecture (PH1/QY2) | No | PH1 |
| `DOCKER_IMAGE` | Docker image for validation | Yes | Read from config |

**Default values are read from `skills/config/env/sdk_compatibility.yml`.**

## Input / Output Mapping

| From | To | Description |
|------|----|-------------|
| `context.MUSA_SDK_VERSION` | `ensure_musa_driver.input.MUSA_SDK_VERSION` | SDK version for driver compatibility |
| `context.MT_GPU_DRIVER_VERSION` | `ensure_musa_driver.input.MT_GPU_DRIVER_VERSION` | Target driver version |
| `context.DOCKER_IMAGE` | `manage_container_images.input.DOCKER_IMAGE` | Image to pull |
| `manage_container_images.output.imageId` | `validate_musa_container_environment.input.imageId` | Image ID for validation |
| `context.DOCKER_IMAGE` | `validate_musa_container_environment.input.DOCKER_IMAGE` | Image name for validation |

### Example

```
context.MUSA_SDK_VERSION → ensure_musa_driver.input.MUSA_SDK_VERSION
context.MT_GPU_DRIVER_VERSION → ensure_musa_driver.input.MT_GPU_DRIVER_VERSION
context.DOCKER_IMAGE → manage_container_images.input.DOCKER_IMAGE
manage_container_images.output.imageId → validate_musa_container_environment.input.imageId
```

## Execution Mode

Mixed: local for input collection, remote for execution on MT-GPU machine.

## State Persistence

State file: `./.musa_deployment_state.json`

### State Values

- `initialized` - Skill started, variables collected
- `dependencies_installed` - ensure_system_dependencies completed
- `driver_installed` - ensure_musa_driver completed
- `toolkit_installed` - ensure_mt_container_toolkit completed
- `image_pulled` - manage_container_images completed
- `container_validated` - validate_musa_container_environment completed
- `completed` - All steps completed successfully
- `failed_at_dependencies` - ensure_system_dependencies failed
- `failed_at_driver` - ensure_musa_driver failed
- `failed_at_toolkit` - ensure_mt_container_toolkit failed
- `failed_at_image` - manage_container_images failed
- `failed_at_validation` - validate_musa_container_environment failed

## Resume Behavior

- **Resume supported**: Yes
- **Resume from states**:
  - `dependencies_installed` → continue from step 2
  - `driver_installed` → continue from step 3
  - `toolkit_installed` → continue from step 4
  - `image_pulled` → continue from step 5

## Workflow

### Step 1: Collect Inputs

**Action**:
```bash
# Resolve config path
CONFIG_FILE="${PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || echo '.')}/skills/config/env/sdk_compatibility.yml"

# Read from config
SDK_VERSION=$(yq '.compatibility[0].sdk_version' "$CONFIG_FILE")
DRIVER_VERSION=$(yq '.compatibility[0].driver_version' "$CONFIG_FILE")
GPU_TYPE=$(yq '.compatibility[0].gpu_type' "$CONFIG_FILE")
DOCKER_IMAGE=$(yq '.compatibility[0].supported_images[0]' "$CONFIG_FILE")
```

**Save state**: `initialized`

**Verification**:
- All required inputs collected

---

### Step 2: Execute ensure_system_dependencies

**Action**:
```
Call ensure_system_dependencies
  → Input: mode=full
  → Output: packages installed
```

**Save state**: `dependencies_installed`

**Verification**:
- ensure_system_dependencies returned status `completed`

---

### Step 3: Execute ensure_musa_driver

**Action**:
```
Call ensure_musa_driver
  → Input: MT_GPU_DRIVER_VERSION, MUSA_SDK_VERSION
  → Output: driver installed and loaded
```

**Save state**: `driver_installed`

**Verification**:
- ensure_musa_driver returned status `completed`
- mthreads-gmi works

---

### Step 4: Execute ensure_mt_container_toolkit

**Action**:
```
Call ensure_mt_container_toolkit
  → Input: (none)
  → Output: toolkit installed and bound
```

**Save state**: `toolkit_installed`

**Verification**:
- ensure_mt_container_toolkit returned status `completed`
- Docker has mthreads runtime

---

### Step 5: Execute manage_container_images

**Action**:
```
Call manage_container_images
  → Input: DOCKER_IMAGE
  → Output: image pulled
```

**Save state**: `image_pulled`

**Verification**:
- manage_container_images returned status `completed`
- Image exists locally

---

### Step 6: Execute validate_musa_container_environment

**Action**:
```
Call validate_musa_container_environment
  → Input: DOCKER_IMAGE
  → Output: validation passed
```

**Save state**: `container_validated`

**Verification**:
- validate_musa_container_environment returned status `completed`
- torch.musa.is_available() = True

---

### Step 7: Final Summary

**Action**:
```bash
echo "=========================================
MUSA SDK Deployment Complete
=========================================
SDK Version: $MUSA_SDK_VERSION
Driver Version: $MT_GPU_DRIVER_VERSION
GPU Type: $MT_GPU_TYPE ($MT_GPU_ARCH)
Docker Image: $DOCKER_IMAGE

Verification Commands:
  Host driver: mthreads-gmi
  Container GPU: docker run --rm --env MTHREADS_VISIBLE_DEVICES=all registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi
  MUSA tools: musaInfo, musa_version_query
  PyTorch MUSA: python -c \"import torch; print(torch.musa.is_available()); print(torch.tensor(1, device='musa') + 1)\"
========================================="
```

**Save state**: `completed`

**Verification**:
- All steps completed successfully

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
  2. Re-run deployment - will resume from step 2
```

## Success Criteria

- All atomic skills completed successfully
- State file shows `completed`
- Final validation passed

### Example Checks

- All atomic skills return `status: completed`
- mthreads-gmi shows GPU info
- Container can access GPU
- torch.musa.is_available() = True

## Final Output Mapping

| From | To | Description |
|------|----|-------------|
| `ensure_musa_driver.output.installedVersion` | `meta.output.driverVersion` | Installed driver version |
| `ensure_mt_container_toolkit.output.toolkitVersion` | `meta.output.toolkitVersion` | Toolkit version |
| `validate_musa_container_environment.output.torchMusaAvailable` | `meta.output.validationPassed` | Final validation status |

### Example

```
ensure_musa_driver.output.installedVersion → meta.output.driverVersion
validate_musa_container_environment.output.torchMusaAvailable → meta.output.validationPassed
```

## Outputs

### Output Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | Execution status: `completed` / `failed` |
| `steps_completed` | string[] | Yes | List of completed atomic skill IDs |
| `driverVersion` | string | No | Installed driver version |
| `toolkitVersion` | string | No | Installed toolkit version |
| `validationPassed` | boolean | No | Final container validation status |

### Output Example

```json
{
  "status": "completed",
  "steps_completed": ["ensure_system_dependencies", "ensure_musa_driver", "ensure_mt_container_toolkit", "manage_container_images", "validate_musa_container_environment"],
  "driverVersion": "3.3.5-server",
  "toolkitVersion": "1.0.0",
  "validationPassed": true
}
```

## Atomic Skills Reference

<!-- Recommended but not mandatory - omit if redundant with Orchestration section -->

| Skill | Purpose | File | Required |
|-------|---------|------|----------|
| `ensure_system_dependencies` | Install system packages | `skills/env/ensure_system_dependencies/SKILL.md` | Yes |
| `ensure_musa_driver` | Install/verify driver | `skills/env/ensure_musa_driver/SKILL.md` | Yes |
| `ensure_mt_container_toolkit` | Install toolkit | `skills/env/ensure_mt_container_toolkit/SKILL.md` | Yes |
| `manage_container_images` | Pull runtime image | `skills/assets/manage_container_images/SKILL.md` | Yes |
| `validate_musa_container_environment` | Validate container | `skills/env/validate_musa_container_environment/SKILL.md` | Yes |

## Important Rules

1. **No direct execution**: This skill only orchestrates, all work is done by atomic skills
2. **State between steps**: Pass outputs from one step as inputs to next
3. **Resume capability**: Support resuming from any failed step
4. **Error propagation**: Report which atomic skill failed with context

## Troubleshooting

Manual debugging guidance for common failures.

### Common Issues

1. **Step 1 fails** - Check apt connectivity, sudo password
2. **Step 2 fails** - Check MOSS access, driver compatibility
3. **Step 3 fails** - Check Docker is running, toolkit download
4. **Step 4 fails** - Check Docker registry access
5. **Step 5 fails** - See `references/container-validation-runbook.md`