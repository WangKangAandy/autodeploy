---
version: 1
name: update_musa_driver
description: Update or reinstall MUSA GPU driver.

category: env
kind: meta
exposure: user
risk_level: idempotent
execution_mode: mixed
depends_on:
  - ensure_system_dependencies
  - ensure_musa_driver

owners:
  - env-team

triggers:
  - update driver
  - upgrade driver
  - reinstall driver
  - 更新驱动
  - 重装驱动

orchestration_mode: sequential
failure_policy: fail_fast
---

# Update MUSA Driver

Meta skill for driver-only update or reinstall.

## Orchestration

```
1. ensure_system_dependencies → Verify system packages
2. ensure_musa_driver → Download and install driver
```

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `MT_GPU_DRIVER_VERSION` | Target driver version | No | Latest |
| `MUSA_SDK_VERSION` | SDK version for compatibility | No | From config |

## Deployment Mode

Ask user before starting:
1. **Local** - Update on current machine
2. **Remote** - Update on remote MT-GPU machine via SSH

Set mode with `musa_mode(mode="remote", ...)` for remote.

## Workflow

### Step 1: Verify System Dependencies

Call `ensure_system_dependencies` to verify build-essential, dkms, kernel headers.

---

### Step 2: Download and Install Driver

Call `ensure_musa_driver` with specified version.

---

### Step 3: Reload Driver Module

```bash
echo "$SUDO_PASSWORD" | sudo -S modprobe -rv mtgpu
echo "$SUDO_PASSWORD" | sudo -S modprobe mtgpu
```

---

### Step 4: Validate

```bash
mthreads-gmi
```

## Success Criteria

- Driver installed at target version
- mthreads-gmi works
- No reboot required

## Troubleshooting

1. **Module fails to load** - Check kernel headers: `apt install linux-headers-$(uname -r)`
2. **Download fails** - Verify MOSS credentials
3. **Validation fails** - Try manual reload: `sudo modprobe -rv mtgpu && sudo modprobe mtgpu`