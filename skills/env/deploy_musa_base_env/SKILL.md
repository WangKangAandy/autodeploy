---
version: 1
name: deploy_musa_base_env
description: Deploy complete MUSA GPU container runtime environment.

category: env
kind: meta
exposure: user
risk_level: idempotent
execution_mode: mixed
depends_on:
  - ensure_system_dependencies
  - ensure_musa_driver
  - ensure_mt_container_toolkit
  - manage_container_images
  - validate_musa_container_environment

owners:
  - env-team

triggers:
  - deploy MUSA environment
  - setup MUSA SDK
  - 部署 MUSA 环境
  - 安装 MUSA

orchestration_mode: sequential
failure_policy: fail_fast
---

# Deploy MUSA Base Environment

Meta skill that orchestrates complete MUSA environment deployment.

## Orchestration

```
1. ensure_system_dependencies → Install system packages
2. ensure_musa_driver → Install MUSA GPU driver
3. ensure_mt_container_toolkit → Install container toolkit
4. manage_container_images → Pull Docker runtime image
5. validate_musa_container_environment → Validate container GPU access
```

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `MUSA_SDK_VERSION` | MUSA SDK version | No | From config |
| `MT_GPU_DRIVER_VERSION` | GPU driver version | No | From config |
| `DOCKER_IMAGE` | Docker image for validation | No | From config |

## Deployment Mode

Ask user before starting:
1. **Local** - Deploy on current machine
2. **Remote** - Deploy on remote MT-GPU machine via SSH

For remote deployment, collect host, user, password, then set mode:
```
musa_mode(mode="remote", host="...", user="...", password="...")
```

## Workflow

### Step 1: Collect Inputs

Read defaults from `skills/config/env/sdk_compatibility.yml`:
```bash
SDK_VERSION=$(yq '.compatibility[0].sdk_version' "$CONFIG")
DRIVER_VERSION=$(yq '.compatibility[0].driver_version' "$CONFIG")
DOCKER_IMAGE=$(yq '.compatibility[0].supported_images[0]' "$CONFIG")
```

---

### Step 2-6: Execute Atomic Skills

Call each atomic skill in sequence, set status after each.

```bash
ensure_system_dependencies() && STATUS_DEPS="✓"
ensure_musa_driver() && STATUS_DRIVER="✓"
ensure_mt_container_toolkit() && STATUS_TOOLKIT="✓"
manage_container_images() && STATUS_IMAGE="✓"
validate_musa_container_environment() && STATUS_VALIDATION="✓"
```

If any fails, stop (failure_policy: fail_fast).

---

### Step 7: Summary

```bash
echo "=========================================
MUSA SDK Deployment Complete
=========================================
SDK Version: $MUSA_SDK_VERSION
Driver Version: $MT_GPU_DRIVER_VERSION
Docker Image: $DOCKER_IMAGE

Deployment Status:
  [$STATUS_DEPS] System dependencies
  [$STATUS_DRIVER] MUSA driver
  [$STATUS_TOOLKIT] Container toolkit
  [$STATUS_IMAGE] Docker image
  [$STATUS_VALIDATION] Container GPU access
========================================="
```

## State Persistence

State file: `./.musa_deployment_state.json`

State values: `initialized` → `dependencies_installed` → `driver_installed` → `toolkit_installed` → `image_pulled` → `container_validated` → `completed`

## Success Criteria

- All atomic skills completed
- mthreads-gmi works on host
- Container can access GPU
- PyTorch's tensor addition verification works