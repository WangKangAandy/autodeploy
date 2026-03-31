---
version: 1
name: validate_musa_container_environment
description: |
  Validate MUSA environment inside a Docker container.
  Tests MUSA tools and PyTorch MUSA backend with basic tensor operation.

category: env
kind: atomic
exposure: internal
risk_level: safe
execution_mode: remote

owners:
  - env-team

triggers:
  - validate container environment
  - test MUSA in container
  - validate model runtime
  - check torch musa
  - 验证容器环境
  - 验证模型运行环境

# Keep scope concise
scope:
  includes:
    - Container launch for validation
    - MUSA tools verification (musaInfo, mthreads-gmi)
    - PyTorch MUSA availability check
    - Basic tensor operation test
    - Container cleanup
  excludes:
    - Container runtime installation
    - Driver installation
    - Image building
    - Performance benchmarking
---

# Validate MUSA Container Environment

This atomic skill validates that MUSA is working correctly inside a Docker container. It tests MUSA tools and PyTorch MUSA backend with a basic tensor operation.

## Invocation

- **Exposure**: internal
- **Top-level intent**: `validate_musa_container_environment`

### Invocation Example

```
musa_dispatch(intent="validate_musa_container_environment", context={
  "DOCKER_IMAGE": "sh-harbor.mthreads.com/mcctest/musa-train:4.3.5_kuae2.1_torch2.9_deb"
})
```

## When To Use This Skill

- After base environment deployment
- After driver or toolkit changes
- Before running workloads (migration/training/inference)
- As final step of `deploy_musa_base_env` orchestration
- When troubleshooting torch.musa issues

## When Not To Use This Skill

- When driver is not installed (use `ensure_musa_driver`)
- When container toolkit is not installed (use `ensure_mt_container_toolkit`)
- For performance benchmarking (use benchmark skills)

## Source Of Truth

- Validation runbook: `references/container-validation-runbook.md`
- Supported images: `skills/config/env/sdk_compatibility.yml`

## Prerequisites

- MUSA driver installed and loaded
- MT Container Toolkit installed and bound
- Docker image available (use `manage_container_images`)

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `CONTAINER_NAME` | Existing container name to validate, or auto-generated if not provided | No | `musa_test_<timestamp>` |
| `DOCKER_IMAGE` | Docker image (required only if container doesn't exist) | No | - |

### Input Scenarios

| CONTAINER_NAME | DOCKER_IMAGE | Behavior |
|----------------|--------------|----------|
| Provided, container exists | Ignored | Use existing container directly |
| Provided, container not exists | Provided | Create new container with image |
| Not provided | Provided | Auto-generate name, create temporary container |
| Not provided | Not provided | Error: need at least one |

## Privileges Required

- **Sudo**: No
- **Remote access**: Yes
- **Docker access**: Yes
- **Network access**: Yes

## Execution Mode

Remote execution on MT-GPU machine via SSH.

## State Persistence

State file: `./.validate_musa_container_environment_state.json`

### State Values

- `initialized` - Skill started
- `container_started` - Validation container running
- `musa_validated` - MUSA tools working
- `torch_validated` - PyTorch MUSA working
- `completed` - All validations passed
- `failed_at_container` - Container start failed
- `failed_at_musa` - MUSA validation failed
- `failed_at_torch` - PyTorch validation failed

## Idempotency

- **Idempotent**: Yes
- **Re-run behavior**:
  - If container exists: reuse it directly
  - If container doesn't exist: create new one with provided image
  - Cleanup: only remove containers created by this skill

## Resume Behavior

- **Resume supported**: No
- Reason: Validation is quick, re-run from start is acceptable

## Workflow

### Step 1: Prepare Container

**Action**:
```bash
# Generate container name if not provided
CONTAINER_NAME="${CONTAINER_NAME:-musa_test_$(date +%s)}"

# Track whether we created the container (for cleanup decision)
CONTAINER_WAS_CREATED_BY_US=false

# Check if container already exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    # Container exists
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo "Using existing running container: $CONTAINER_NAME"
    else
        echo "Starting existing stopped container: $CONTAINER_NAME"
        docker start "$CONTAINER_NAME"
    fi
else
    # Container doesn't exist, need DOCKER_IMAGE
    if [ -z "$DOCKER_IMAGE" ]; then
        echo "ERROR: Container '$CONTAINER_NAME' not found and DOCKER_IMAGE not provided"
        echo "Provide either an existing CONTAINER_NAME or a DOCKER_IMAGE to create one."
        exit 1
    fi

    CONTAINER_WAS_CREATED_BY_US=true
    echo "Creating new container with image: $DOCKER_IMAGE"

    docker run -itd \
      --name="$CONTAINER_NAME" \
      --env MTHREADS_VISIBLE_DEVICES=all \
      --shm-size=80g \
      --privileged \
      "$DOCKER_IMAGE" \
      bash

    if [ $? -ne 0 ]; then
        echo "Failed to launch container"
        exit 1
    fi

    echo "Container started: $CONTAINER_NAME"
fi

# Save state
cat > .validate_musa_container_environment_state.json << EOF
{
  "status": "container_started",
  "containerName": "$CONTAINER_NAME",
  "imageName": "${DOCKER_IMAGE:-existing}",
  "containerCreatedByUs": $CONTAINER_WAS_CREATED_BY_US
}
EOF
```

**Save state**: `container_started`

**Verification**:
- Container running

---

### Step 2: Validate MUSA Tools

**Action**:
```bash
echo "Testing musaInfo..."
if ! docker exec "$CONTAINER_NAME" musaInfo; then
    echo "musaInfo failed"
    if [ "$CONTAINER_WAS_CREATED_BY_US" = "true" ]; then
        docker stop "$CONTAINER_NAME" >/dev/null 2>&1
        docker rm "$CONTAINER_NAME" >/dev/null 2>&1
    fi
    exit 1
fi

echo "musaInfo passed"

# Update state
jq '.status = "musa_validated"' .validate_musa_container_environment_state.json > .tmp && mv .tmp .validate_musa_container_environment_state.json
```

**Save state**: `musa_validated`

**Verification**:
- musaInfo executes successfully

---

### Step 3: Validate PyTorch MUSA

**Action**:
```bash
echo "Testing PyTorch MUSA..."

PYTORCH_TEST=$(docker exec "$CONTAINER_NAME" bash -lc 'python - <<"PY"
import torch
import sys

# Check MUSA availability
if not torch.musa.is_available():
    print("ERROR: torch.musa.is_available() returned False")
    sys.exit(1)

print("torch.musa.is_available(): True")

# Test: Tensor addition
try:
    tensor = torch.tensor([1.0], device="musa")
    result = tensor + 1
    print(f"tensor_add: {tensor.item()} + 1 = {result.item()}")
    if result.item() != 2.0:
        print("ERROR: Tensor addition failed")
        sys.exit(1)
    print("test_tensor_add: PASSED")
except Exception as e:
    print(f"ERROR: Tensor addition failed: {e}")
    sys.exit(1)

print("all_tests: PASSED")
PY'
)

PYTORCH_EXIT=$?

if [ $PYTORCH_EXIT -ne 0 ]; then
    echo "PyTorch MUSA validation failed"
    echo "$PYTORCH_TEST"
    if [ "$CONTAINER_WAS_CREATED_BY_US" = "true" ]; then
        docker stop "$CONTAINER_NAME" >/dev/null 2>&1
        docker rm "$CONTAINER_NAME" >/dev/null 2>&1
    fi
    exit 1
fi

echo "$PYTORCH_TEST"

# Update state
jq '.status = "torch_validated"' .validate_musa_container_environment_state.json > .tmp && mv .tmp .validate_musa_container_environment_state.json
```

**Save state**: `torch_validated`

**Verification**:
- torch.musa.is_available() returns True
- Tensor addition succeeds

---

### Step 4: Cleanup and Complete

**Action**:
```bash
# Only cleanup if we created the container
if [ "$CONTAINER_WAS_CREATED_BY_US" = "true" ]; then
    echo "Cleaning up test container created by this skill..."
    docker stop "$CONTAINER_NAME" >/dev/null 2>&1
    docker rm "$CONTAINER_NAME" >/dev/null 2>&1
else
    echo "Keeping existing container: $CONTAINER_NAME"
fi

# Update state
jq '.status = "completed"' .validate_musa_container_environment_state.json > .tmp && mv .tmp .validate_musa_container_environment_state.json

echo ""
echo "========================================="
echo "MUSA Container Environment Validation Complete"
echo "========================================="
echo "Image: $DOCKER_IMAGE"
echo "Container: $CONTAINER_NAME"
echo "MUSA tools (musaInfo): OK"
echo "PyTorch MUSA: OK"
echo "Tensor addition: OK"
echo "========================================="
```

**Save state**: `completed`

**Verification**:
- If container was created by this skill: cleaned up
- If container was existing: left running

## Success Criteria

- Container starts successfully
- musaInfo executes
- torch.musa.is_available() = True
- Tensor addition test passes

### Example Checks

- docker exec container musaInfo succeeds
- docker exec container python -c "import torch; print(torch.musa.is_available())" prints True
- Tensor addition works

## Outputs

### Output Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | Execution status: `completed` / `failed` |
| `containerName` | string | Yes | Container name used |
| `imageName` | string | No | Docker image (if new container created) |
| `containerCreatedByUs` | boolean | Yes | Whether container was created by this skill |
| `musaInfoPassed` | boolean | No | Whether musaInfo succeeded |
| `torchMusaAvailable` | boolean | No | Whether torch.musa.is_available() is True |
| `tensorTestPassed` | boolean | No | Whether tensor addition test passed |

### Output Example

```json
{
  "status": "completed",
  "containerName": "musa_test_1711478400",
  "imageName": "sh-harbor.mthreads.com/mcctest/musa-train:4.3.5_kuae2.1_torch2.9_deb",
  "containerCreatedByUs": true,
  "musaInfoPassed": true,
  "torchMusaAvailable": true,
  "tensorTestPassed": true
}
```



## Troubleshooting

### Common Issues

1. **torch.musa.is_available() returns False**
   - Check driver is loaded: `mthreads-gmi` on host
   - Check container toolkit binding: `docker info | grep mthreads`
   - See: `references/container-validation-runbook.md`

2. **Container fails to start**
   - Check Docker is running: `systemctl status docker`
   - Check GPU driver: `mthreads-gmi`