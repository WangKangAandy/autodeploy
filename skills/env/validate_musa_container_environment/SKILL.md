---
version: 1
name: validate_musa_container_environment
description: Validate MUSA GPU access in Docker containers.

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
  - 验证容器环境
---

# Validate MUSA Container Environment

Validates that Docker containers can access MUSA GPU.

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DOCKER_IMAGE` | Docker image for validation | No | From config |
| `CONTAINER_NAME` | Existing container to validate | No | - |

## Workflow

### Step 1: Host Driver Check

```bash
if ! mthreads-gmi; then
    echo "Error: MUSA driver not working on host"
    exit 1
fi
echo "Host driver: OK"
```

---

### Step 2: Container Validation

**Option A: New container**

```bash
VALIDATION_IMAGE="${DOCKER_IMAGE:-registry.mthreads.com/cloud-mirror/ubuntu:20.04}"

docker run --rm --env MTHREADS_VISIBLE_DEVICES=all \
    "$VALIDATION_IMAGE" mthreads-gmi
```

**Option B: Existing container**

```bash
if [ -n "$CONTAINER_NAME" ]; then
    docker exec "$CONTAINER_NAME" mthreads-gmi
fi
```

---

### Step 3: PyTorch Validation (if available)

```bash
if docker exec "$CONTAINER_NAME" python3 -c "import torch" 2>/dev/null; then
    docker exec "$CONTAINER_NAME" python3 -c "
import torch
print(f'torch.musa.is_available(): {torch.musa.is_available()}')
print(f'torch.tensor(1, device=\"musa\") + 1 = {torch.tensor(2, device=\"musa\")}')
"
fi
```

## Success Criteria

- mthreads-gmi works in container
- PyTorch can access MUSA GPU (if PyTorch present)

## Attentions
- If the user gives a document, and it includes inference, training, or other operations, strictly follow those steps instead of stopping after PyTorch validation!

## Troubleshooting

1. **mthreads-gmi fails** - Check container toolkit binding
2. **PyTorch not found** - Expected if image doesn't include PyTorch
3. **torch.musa unavailable** - Check MUSA PyTorch version