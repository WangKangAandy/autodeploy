---
version: 1
name: validate_musa_container_environment
description: |
  Validate MUSA environment inside a Docker container.
  Tests MUSA tools, PyTorch MUSA backend, tensor operations, and GPU memory.

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
    - Tensor operations test (arithmetic, matmul, memory)
    - GPU memory verification
    - Container cleanup
  excludes:
    - Container runtime installation
    - Driver installation
    - Image building
    - Performance benchmarking
---

# Validate MUSA Container Environment

This atomic skill validates that MUSA is working correctly inside a Docker container. It provides comprehensive testing from MUSA tools to PyTorch tensor operations.

## Invocation

- **Exposure**: internal
- **Top-level intent**: `validate_musa_container_environment`
- **Callable from orchestration**: Yes

### Invocation Example

```
musa_dispatch(intent="validate_musa_container_environment", context={
  "DOCKER_IMAGE": "sh-harbor.mthreads.com/mcctest/musa-train:4.3.5_kuae2.1_torch2.9_deb"
})
```

## When To Use This Skill

- After base environment deployment
- After driver or toolkit changes
- Before running workloads (training/inference)
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
| `DOCKER_IMAGE` | Docker image for validation | Yes | - |
| `CONTAINER_NAME` | Container name (auto-generated if not provided) | No | `musa_test_<timestamp>` |

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
- **Re-run behavior**: Removes existing container with same name before starting new one

## Resume Behavior

- **Resume supported**: No
- Reason: Validation is quick, re-run from start is acceptable

## Workflow

### Step 1: Launch Test Container

**Action**:
```bash
# Generate container name if not provided
CONTAINER_NAME="${CONTAINER_NAME:-musa_test_$(date +%s)}"

# Remove existing container with same name
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo "Launching validation container: $CONTAINER_NAME"

docker run -itd \
  --name="$CONTAINER_NAME" \
  --env MTHREADS_VISIBLE_DEVICES=all \
  --shm-size=80g \
  --network=host \
  --privileged \
  --pid=host \
  -v /data:/data \
  "$DOCKER_IMAGE" \
  bash

if [ $? -ne 0 ]; then
    echo "Failed to launch container"
    exit 1
fi

echo "Container started: $CONTAINER_NAME"

# Save state
cat > .validate_musa_container_environment_state.json << EOF
{
  "status": "container_started",
  "containerName": "$CONTAINER_NAME",
  "imageName": "$DOCKER_IMAGE"
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
    docker stop "$CONTAINER_NAME" >/dev/null 2>&1
    docker rm "$CONTAINER_NAME" >/dev/null 2>&1
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

### Step 3: Validate PyTorch MUSA and Tensor Operations

**Action**:
```bash
echo "Testing PyTorch MUSA and tensor operations..."

PYTORCH_TEST=$(docker exec "$CONTAINER_NAME" bash -lc 'python - <<"PY"
import torch
import sys

# Check MUSA availability
if not torch.musa.is_available():
    print("ERROR: torch.musa.is_available() returned False")
    sys.exit(1)

print("torch.musa.is_available(): True")

# Test 1: Basic tensor operation
try:
    tensor = torch.tensor([1.0], device="musa")
    result = tensor + 1
    print(f"basic_tensor: {tensor.item()} + 1 = {result.item()}")
    if result.item() != 2.0:
        print("ERROR: Basic tensor operation failed")
        sys.exit(1)
    print("test_basic_tensor: PASSED")
except Exception as e:
    print(f"ERROR: Basic tensor operation failed: {e}")
    sys.exit(1)

# Test 2: Matrix multiplication
try:
    a = torch.randn(100, 100, device="musa")
    b = torch.randn(100, 100, device="musa")
    c = torch.mm(a, b)
    print("test_matmul: PASSED")
except Exception as e:
    print(f"ERROR: Matrix multiplication failed: {e}")
    sys.exit(1)

# Test 3: Memory allocation
try:
    large = torch.randn(1000, 1000, device="musa")
    print("test_memory_alloc: PASSED")
except Exception as e:
    print(f"ERROR: Memory allocation failed: {e}")
    sys.exit(1)

# Test 4: GPU Memory info
try:
    props = torch.musa.get_device_properties(0)
    total_memory_gb = props.total_memory / 1024**3
    print(f"gpu_memory_gb: {total_memory_gb:.1f}")
except Exception as e:
    print(f"Warning: Could not get GPU memory: {e}")

print("all_tests: PASSED")
PY'
)

PYTORCH_EXIT=$?

if [ $PYTORCH_EXIT -ne 0 ]; then
    echo "PyTorch MUSA validation failed"
    echo "$PYTORCH_TEST"
    docker stop "$CONTAINER_NAME" >/dev/null 2>&1
    docker rm "$CONTAINER_NAME" >/dev/null 2>&1
    exit 1
fi

echo "$PYTORCH_TEST"

# Parse GPU memory from output
GPU_MEMORY_GB=$(echo "$PYTORCH_TEST" | grep "gpu_memory_gb:" | awk '{print $2}')

# Update state
jq --arg mem "$GPU_MEMORY_GB" '.status = "torch_validated" | .gpuMemoryGB = $mem' \
    .validate_musa_container_environment_state.json > .tmp && mv .tmp .validate_musa_container_environment_state.json
```

**Save state**: `torch_validated`

**Verification**:
- torch.musa.is_available() returns True
- Basic tensor operation succeeds
- Matrix multiplication succeeds
- Memory allocation succeeds

---

### Step 4: Cleanup and Complete

**Action**:
```bash
echo "Cleaning up test container..."
docker stop "$CONTAINER_NAME" >/dev/null 2>&1
docker rm "$CONTAINER_NAME" >/dev/null 2>&1

# Update state
jq '.status = "completed"' .validate_musa_container_environment_state.json > .tmp && mv .tmp .validate_musa_container_environment_state.json

echo ""
echo "========================================="
echo "MUSA Container Environment Validation Complete"
echo "========================================="
echo "Image: $DOCKER_IMAGE"
echo "MUSA tools (musaInfo): OK"
echo "PyTorch MUSA: OK"
echo "Tensor operations: OK"
echo "GPU Memory: ${GPU_MEMORY_GB} GB"
echo "========================================="
```

**Save state**: `completed`

**Verification**:
- Container cleaned up

## Success Criteria

- Container starts successfully
- musaInfo executes
- torch.musa.is_available() = True
- All tensor tests pass (basic, matmul, memory)

### Example Checks

- docker exec container musaInfo succeeds
- docker exec container python -c "import torch; print(torch.musa.is_available())" prints True
- Matrix multiplication works
- GPU memory reported

## Outputs

### Output Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | Execution status: `completed` / `failed` |
| `containerName` | string | No | Container name used |
| `imageName` | string | Yes | Docker image tested |
| `musaInfoPassed` | boolean | No | Whether musaInfo succeeded |
| `torchMusaAvailable` | boolean | No | Whether torch.musa.is_available() is True |
| `tensorTestPassed` | boolean | No | Whether all tensor tests passed |
| `gpuMemoryGB` | float | No | GPU memory in GB |

### Output Example

```json
{
  "status": "completed",
  "containerName": "musa_test_1711478400",
  "imageName": "sh-harbor.mthreads.com/mcctest/musa-train:4.3.5_kuae2.1_torch2.9_deb",
  "musaInfoPassed": true,
  "torchMusaAvailable": true,
  "tensorTestPassed": true,
  "gpuMemoryGB": 32.0
}
```

## Side Effects

- **Modifies**: None
- **Creates**: Temporary container (cleaned up)
- **Removes/Replaces**: None
- **Requires reboot**: No

## Important Rules

1. **Always cleanup**: Remove test container after validation
2. **Fail fast**: Exit on first failure, don't continue
3. **Privileged mode**: Required for some GPU operations
4. **Shared memory**: Use `--shm-size=80g` for large models
5. **Comprehensive tests**: Test multiple tensor operations, not just availability

## Troubleshooting

### Common Issues

1. **torch.musa.is_available() returns False**
   - Check driver is loaded: `mthreads-gmi` on host
   - Check container toolkit binding: `docker info | grep mthreads`
   - Check image has correct torch_musa version
   - See: `references/container-validation-runbook.md`

2. **Container fails to start**
   - Check Docker is running: `systemctl status docker`
   - Check image exists: `docker images`
   - Check GPU driver: `mthreads-gmi`

3. **Tensor operation fails with "no kernel image"**
   - Image built for different GPU architecture
   - S5000 uses PH1, S4000 uses QY2
   - Use image matching GPU type

4. **Matrix multiplication fails**
   - May be architecture mismatch (PH1 vs QY2)
   - Check image compatibility with GPU type
   - Verify torch_musa version matches SDK

5. **Out of memory during test**
   - Check GPU memory: `mthreads-gmi`
   - Free up GPU memory from other processes