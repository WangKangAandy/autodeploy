# Container Validation Runbook

This runbook is the shared troubleshooting path for container validation in:

- `skills/deploy_musa_base_env/SKILL.md`
- `skills/update_musa_driver/SKILL.md`

Use it when container validation fails after the host driver and container toolkit appear to be installed.

## Goal

Classify validation failures into one of these buckets:

1. Host driver not ready
2. Container runtime / toolkit binding issue
3. Image runtime library issue
4. `torch_musa` architecture mismatch

## Required Inputs

```bash
IMAGE="<image_name>"
CONTAINER_NAME="musa_validation_$(date +%s)"
```

Launch the test container with the standard validation options:

```bash
docker run -itd \
  --name="$CONTAINER_NAME" \
  --env MTHREADS_VISIBLE_DEVICES=all \
  --shm-size=80g \
  --network=host \
  --privileged \
  --pid=host \
  -v /data:/data \
  "$IMAGE" \
  bash
```

Clean up after validation:

```bash
docker stop "$CONTAINER_NAME"
docker rm "$CONTAINER_NAME"
```

## Layered Validation Sequence

### Step 0: Confirm host driver first

```bash
mthreads-gmi
```

If this fails, stop here and fix the host driver before continuing.

### Step 1: Confirm container runtime access

```bash
docker run --rm --env MTHREADS_VISIBLE_DEVICES=all registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi
```

If this fails, treat it as a container toolkit or Docker binding issue instead of an image issue.

### Step 2: Confirm basic MUSA runtime in the target image

```bash
docker exec "$CONTAINER_NAME" musaInfo
```

If this fails, inspect image-side runtime libraries before blaming PyTorch.

### Step 3: Confirm PyTorch MUSA availability and a real tensor op

```bash
docker exec "$CONTAINER_NAME" bash -lc 'python - <<"PY"
import torch
print("PyTorch MUSA available:", torch.musa.is_available())
if torch.musa.is_available():
    tensor = torch.tensor([1.0], device="musa")
    print("MUSA tensor test:", tensor + 1)
PY'
```

Do not stop at `torch.musa.is_available()`. A real tensor op is required to catch architecture and runtime issues.

## Failure Routing

### Case A: `import torch` fails with `file too short`

Typical error:

```text
ImportError: /usr/lib/x86_64-linux-gnu/libmusa.so.4: file too short
```

Inspect the library files inside the container:

```bash
docker exec "$CONTAINER_NAME" bash -lc 'ls -l /usr/lib/x86_64-linux-gnu/libmusa.so* /lib/x86_64-linux-gnu/libmusa.so*'
docker exec "$CONTAINER_NAME" bash -lc 'stat /usr/lib/x86_64-linux-gnu/libmusa.so.4.3.1 /lib/x86_64-linux-gnu/libmusa.so.4.3.1'
```

If the target file is zero bytes, the image is broken.

Temporary host-to-container hotfix:

```bash
docker cp /usr/lib/x86_64-linux-gnu/libmusa.so.4.3.1 "$CONTAINER_NAME":/tmp/libmusa.so.4.3.1.host
docker exec "$CONTAINER_NAME" bash -lc '
  cp -f /tmp/libmusa.so.4.3.1.host /usr/lib/x86_64-linux-gnu/libmusa.so.4.3.1 && \
  cp -f /tmp/libmusa.so.4.3.1.host /lib/x86_64-linux-gnu/libmusa.so.4.3.1 && \
  sync
'
```

Then rerun Step 2 and Step 3.

If the hotfix works, record the image as a known-bad image rather than treating the environment as healthy by default.

### Case B: `torch.musa.is_available()` is `True` but tensor ops fail with `invalid device function`

Inspect the image architecture targets:

```bash
docker exec "$CONTAINER_NAME" bash -lc 'python - <<"PY"
import torch
import torch_musa
print("arch list", getattr(torch.musa, "get_arch_list", lambda: "n/a")())
print("device capability", torch.musa.get_device_capability(0))
PY'
```

Interpretation:

- If `arch list` does not cover the current device capability, treat this as an image architecture mismatch
- If `arch list` matches but tensor ops still fail, return to Case A and inspect runtime libraries first

The fix is to switch to an image that matches the target GPU architecture. Do not misclassify this as a host driver failure if Step 0 and Step 1 already passed.

### Case C: `musaInfo` fails but host/container `mthreads-gmi` passes

Treat this as an image runtime issue.

Check:

```bash
docker exec "$CONTAINER_NAME" bash -lc 'ls -l /usr/lib/x86_64-linux-gnu/libmusa.so* /lib/x86_64-linux-gnu/libmusa.so*'
docker exec "$CONTAINER_NAME" bash -lc 'musaInfo || true'
```

If `libmusa.so` files are empty or broken, handle it with Case A.

### Case D: `docker run ... mthreads-gmi` fails before target image validation

Treat this as a host/container runtime integration issue.

Check:

```bash
systemctl status docker
dpkg -s mt-container-toolkit
mthreads-gmi
```

If needed, rerun Docker binding:

```bash
(cd /usr/bin/musa && sudo ./docker setup $PWD)
sudo systemctl restart docker
```

## What To Record After A Failure

When a validation issue is confirmed, record all of the following in the relevant doc or state file:

- Host driver version from `mthreads-gmi`
- Validation image tag
- Whether `musaInfo` passed
- Whether `torch.musa.is_available()` passed
- Whether a real tensor op passed
- `torch.musa.get_arch_list()` output when available
- Whether a host `libmusa.so.4.3.1` hotfix changed the result

This makes repeated incidents easier to classify without rediscovering the same root cause.
