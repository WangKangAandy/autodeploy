---
name: update_musa_driver
description: Targeted MUSA driver update or reinstall workflow. Switches drivers quickly on an existing host without rerunning the full base environment deployment.
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
---

# Update MUSA Driver

This skill is for driver-only operations on a host that already has a usable MUSA environment or partial deployment.
Use it when the user asks to upgrade, downgrade, reinstall, or quickly switch the MUSA driver without rerunning the full base environment flow.

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

## When To Use This Skill

- Update only the host driver package
- Reinstall the current driver to recover from a broken state
- Switch to another driver version that matches a known SDK mapping
- Validate host driver loading after a driver-only change

## When Not To Use This Skill

- Do not use it for a fresh machine that still needs full base environment setup
- Do not use it when the user asks for container toolkit installation or full base environment setup as the main goal
- Do not add muDNN, MCCL, Triton, or other host-side packages here

## Source Of Truth

- Full environment workflow: `skills/deploy_musa_base_env/SKILL.md`
- SDK/driver compatibility mapping: `skills/deploy_musa_base_env/config/sdk_compatibility.yml`
- MOSS download and MinIO Client setup: `references/moss-download-guide.md`
- Driver installation reference: `references/driver-install-guide.md`
- Shared container validation troubleshooting: `references/container-validation-runbook.md`
- Remote command routing: `references/remote-execution-policy.md`

## Inputs

Collect only the minimum required values.

| Variable | Description | Required |
|----------|-------------|----------|
| `MT_GPU_DRIVER_VERSION` | Target driver version (e.g., `3.3.5-server`) | Preferred |
| `MUSA_SDK_VERSION` | SDK version used to resolve compatible driver from `sdk_compatibility.yml` | Optional |
| `MT_GPU_TYPE` | GPU type used for compatibility lookup | Optional |
| `MT_GPU_ARCH` | GPU architecture suffix used for compatibility lookup | Optional |
| `DRIVER_PACKAGE_PATH` | Pre-downloaded local driver package path | Optional |
| `DOCKER_IMAGE` | Validation image when optional container check is requested (read from `sdk_compatibility.yml`) | Optional |

## Driver Resolution Rules

- If `MT_GPU_DRIVER_VERSION` is provided, use it directly.
- If only `MUSA_SDK_VERSION` is provided, resolve `driver_version` from `skills/deploy_musa_base_env/config/sdk_compatibility.yml` using the current environment when possible.
- If both are provided, verify they do not conflict with a known compatibility mapping.
- If no mapping matches, ask the user for the exact driver version instead of guessing.
- If optional container validation is requested and `DOCKER_IMAGE` is not provided, resolve it from the matching `supported_images` entry in `skills/deploy_musa_base_env/config/sdk_compatibility.yml`.

### SDK → Driver Lookup

The YAML structure uses `compatibility` array and `metadata` block. Example lookup:

```bash
# Read from yml file - replace with actual values or use variables
MT_GPU_DRIVER_VERSION=$(yq '.compatibility[] | select(.sdk_version == "'$MUSA_SDK_VERSION'") | .driver_version' \
  skills/deploy_musa_base_env/config/sdk_compatibility.yml)
```

Or using Python for complex lookups:

```bash
MT_GPU_DRIVER_VERSION=$(python3 - <<'PY'
import yaml

with open("skills/deploy_musa_base_env/config/sdk_compatibility.yml", "r", encoding="utf-8") as f:
    data = yaml.safe_load(f)

entries = data.get("compatibility", [])
# Use first entry as default, or filter by your requirements
sdk_version = entries[0].get("sdk_version") if entries else None
gpu_type = entries[0].get("gpu_type") if entries else None

for item in entries:
    if (item.get("sdk_version") == sdk_version and
        item.get("gpu_type") == gpu_type):
        print(item["driver_version"])
        break
PY
)
```

### Driver → SDK Lookup (Reverse)

To find the SDK version for a given driver:

```bash
MUSA_SDK_VERSION=$(yq '.compatibility[] | select(.driver_version == "'$DRIVER_VERSION'") | .sdk_version' \
  skills/deploy_musa_base_env/config/sdk_compatibility.yml)
```

### Download Path Construction

Use the `metadata.driver_path_template` to construct download URLs:

```bash
DOWNLOAD_PATH=$(python3 - <<'PY'
import yaml

with open("skills/deploy_musa_base_env/config/sdk_compatibility.yml", "r", encoding="utf-8") as f:
    data = yaml.safe_load(f)

template = data["metadata"]["driver_path_template"]
# Use actual SDK and driver versions from compatibility mapping
sdk_version = data["compatibility"][0]["sdk_version"]
driver_version = data["compatibility"][0]["driver_version"]
path = template.format(sdk_version=sdk_version, driver_version=driver_version)
print(path)
PY
)
# Output: sh-moss/sw-release/musa/external/{sdk_version}/deb/musa_{driver_version}-server_amd64.deb
```

If the runtime does not have PyYAML available, use a small repo-local helper or ask the user for the target driver version instead of inventing one.

## Prerequisites

- Ubuntu or another compatible Linux distribution
- Sudo privileges
- `jq` available for state handling
- `mc` only if the package must be downloaded from MOSS (see `references/moss-download-guide.md` for setup)

## Sudo Password Handling

Check `MY_SUDO_PASSWD` first.

```bash
if [ -n "$MY_SUDO_PASSWD" ] && echo "$MY_SUDO_PASSWD" | sudo -S -v 2>/dev/null; then
    SUDO_PASSWORD="$MY_SUDO_PASSWD"
else
    # Use the question tool to prompt user
fi
```

Use sudo credentials only for package installation, package removal, module reload, and system package prerequisites.

## State Persistence

Save progress to `./.musa_driver_update_state.json` when the operation is long-running or may need resume.

### State Values
- `initialized`
- `package_ready`
- `driver_removed`
- `driver_installed`
- `driver_loaded`
- `validated`
- `completed`

## Workflow

### Step 1: Inspect Current Driver

```bash
CURRENT_VERSION=""

if dpkg -s musa &>/dev/null; then
  CURRENT_VERSION=$(dpkg -s musa | awk -F': ' '/^Version:/{print $2}')
  echo "Current driver version: ${CURRENT_VERSION}"
fi

dpkg -s musa || true
mthreads-gmi || true
```

If the currently installed driver already matches the requested version, do not reinstall automatically.
Run validation and exit unless the user explicitly requested a reinstall.

```bash
if [ -n "$CURRENT_VERSION" ] && [ "$CURRENT_VERSION" = "$MT_GPU_DRIVER_VERSION" ]; then
  echo "Requested driver version already installed; skipping reinstall"
  mthreads-gmi
  exit 0
fi
```

### Step 2: Check Minimal Prerequisites

Do not reinstall dependencies that are already present. Install only missing driver prerequisites:

```bash
MISSING_PACKAGES=""

for pkg in dkms libgbm1 libglapi-mesa linux-headers-$(uname -r); do
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then
    MISSING_PACKAGES="$MISSING_PACKAGES $pkg"
  fi
done

if [ -n "$MISSING_PACKAGES" ]; then
  echo "$SUDO_PASSWORD" | sudo -S apt update
  echo "$SUDO_PASSWORD" | sudo -S apt install -y $MISSING_PACKAGES
fi
```

Save state: `initialized`

### Step 3: Prepare Driver Package

For MinIO Client setup and MOSS configuration, see `references/moss-download-guide.md`.

Prefer existing local packages before downloading.
Check common local naming variants first, because some environments keep the package as `musa_<version>-server_amd64.deb` while others may use `musa_<version>_amd64.deb`.
Do not assume the package always lives under the requested SDK directory on MOSS. If the expected SDK path does not contain the target driver, search the broader `sw-release/musa/external/` tree and then download the matched file.

```bash
mkdir -p ./musa_packages

if [ -n "${DRIVER_PACKAGE_PATH:-}" ] && [ -f "$DRIVER_PACKAGE_PATH" ]; then
  PACKAGE_PATH="$DRIVER_PACKAGE_PATH"
elif [ -f "./musa_packages/musa_${MT_GPU_DRIVER_VERSION}_amd64.deb" ]; then
  PACKAGE_PATH="./musa_packages/musa_${MT_GPU_DRIVER_VERSION}_amd64.deb"
elif [ -f "./musa_packages/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb" ]; then
  PACKAGE_PATH="./musa_packages/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb"
else
  mc alias set sh-moss https://sh-moss.mthreads.com sw-guest-mt-sw sw-guest123
  BASE="sh-moss/sw-release/musa/external/${MUSA_SDK_VERSION}/deb"

  if mc ls "${BASE}/musa_${MT_GPU_DRIVER_VERSION}_amd64.deb" >/dev/null 2>&1; then
    mc cp "${BASE}/musa_${MT_GPU_DRIVER_VERSION}_amd64.deb" ./musa_packages/
    PACKAGE_PATH="./musa_packages/musa_${MT_GPU_DRIVER_VERSION}_amd64.deb"
  elif mc ls "${BASE}/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb" >/dev/null 2>&1; then
    mc cp "${BASE}/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb" ./musa_packages/
    PACKAGE_PATH="./musa_packages/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb"
  else
    REMOTE_PACKAGE=$(mc find "sh-moss/sw-release/musa/external" --name "musa_${MT_GPU_DRIVER_VERSION}*amd64.deb" | head -n 1)

    if [ -z "$REMOTE_PACKAGE" ]; then
      echo "Target driver package not found on MOSS"
      exit 1
    fi

    mc cp "$REMOTE_PACKAGE" ./musa_packages/
    PACKAGE_PATH="./musa_packages/$(basename "$REMOTE_PACKAGE")"
  fi
fi
```

Save state: `package_ready`

### Step 4: Remove Existing Driver

```bash
if dpkg -s musa &>/dev/null; then
  echo "$SUDO_PASSWORD" | sudo -S dpkg -P musa
  echo "$SUDO_PASSWORD" | sudo -S modprobe -rv mtgpu 2>/dev/null || true
fi
```

Save state: `driver_removed`

### Step 5: Install Target Driver

```bash
echo "$SUDO_PASSWORD" | sudo -S apt install -y "$PACKAGE_PATH"
```

Save state: `driver_installed`

### Step 6: Reload Driver Without Reboot

Prefer module reload before asking for reboot.
After package installation, the running kernel may still have the old `mtgpu` module loaded. Always validate the loaded driver version after reload instead of assuming the new package version is already active.

```bash
echo "$SUDO_PASSWORD" | sudo -S modprobe mtgpu || {
  echo "$SUDO_PASSWORD" | sudo -S modprobe -rv mtgpu 2>/dev/null || true
  echo "$SUDO_PASSWORD" | sudo -S modprobe mtgpu
}
```

If module loading still fails, stop and ask the user for a manual reboot.
Never auto-run `sudo reboot`.

Save state: `driver_loaded`

### Step 7: Validate Host Driver

```bash
mthreads-gmi
```

If `mthreads-gmi` still reports the old driver version after installation, run another explicit reload and validate again:

```bash
echo "$SUDO_PASSWORD" | sudo -S modprobe -rv mtgpu 2>/dev/null || true
echo "$SUDO_PASSWORD" | sudo -S modprobe mtgpu
mthreads-gmi
```

If the first validation immediately after reload hits a transient initialization error such as `failed to initialize mtml`, retry `mthreads-gmi` once before escalating. If the retry still fails, then treat it as a real validation failure.

Validation should confirm:

- GPU is visible
- Driver version matches the requested target version

Save state: `validated`

### Step 8: Optional Container Smoke Check

Do not stop, restart, or otherwise manage existing containers as part of the driver update flow.
The host driver switch may affect running workloads, but this skill does not pre-handle container lifecycle.

If the matching entry in `skills/deploy_musa_base_env/config/sdk_compatibility.yml` includes `supported_images`, ask the user whether they want to launch one of those images for post-update validation.
The user may choose to skip container validation.

Only do container validation if all of the following are true:

- `mt-container-toolkit` is already installed
- Docker is running
- the compatibility mapping has a supported image for the target environment
- the user explicitly chooses to run the validation container

```bash
if dpkg -s mt-container-toolkit &>/dev/null && systemctl is-active --quiet docker; then
  CONTAINER_NAME="musa_test_$(date +%s)"

  docker run --rm --env MTHREADS_VISIBLE_DEVICES=all \
    registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi

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

  docker exec "$CONTAINER_NAME" musaInfo

  docker exec "$CONTAINER_NAME" bash -lc 'python - <<"PY"
import torch
print("PyTorch MUSA available:", torch.musa.is_available())
if torch.musa.is_available():
    tensor = torch.tensor([1.0], device="musa")
    print("MUSA tensor test:", tensor + 1)
PY'

  docker stop "$CONTAINER_NAME"
  docker rm "$CONTAINER_NAME"
fi
```

If any optional container validation step fails, follow `references/container-validation-runbook.md`. Do not immediately assume the driver update failed, because the issue may be isolated to the validation image, its runtime libraries, or its `torch_musa` build targets.

Save state: `completed`

## Remote Support

When running on a remote MT-GPU Machine:

- Use `musa_exec` for host checks, package installation, driver removal, module reload, and validation
- Do not replace remote host operations with local Bash commands
- Keep driver package paths aligned with the repo's remote path conventions if packages are uploaded first

## Important Rules

1. Prefer `skills/deploy_musa_base_env/config/sdk_compatibility.yml` when selecting a driver for a known SDK
2. Prefer local package reuse before downloading a new driver package, and check both `_amd64.deb` and `-server_amd64.deb` naming variants
3. If the target driver is not present under the expected SDK directory on MOSS, search the broader external release tree before failing
4. Do not reinstall driver prerequisites if they are already present; only install missing packages
5. Never auto-run `sudo reboot`; manual module reload is the first recovery path
6. After installation, verify the loaded driver version with `mthreads-gmi`; package version and loaded module version may temporarily differ until reload completes
7. If validation hits a transient `mtml` initialization failure right after reload, retry once before treating it as a persistent failure
8. Do not stop or manage existing containers during the driver update flow unless the user explicitly asks
9. If the compatibility mapping contains supported images for the new driver environment, ask the user whether to run optional container validation; they may skip it
10. Do not reinstall container toolkit, pull images, or run full environment setup unless the user explicitly expands scope
11. Validate with `mthreads-gmi` after every driver switch before doing any optional container smoke check
12. If container validation fails, use `references/container-validation-runbook.md` to separate driver issues from image-side runtime or architecture issues
