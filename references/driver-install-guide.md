# MUSA Driver Installation Guide

This document provides shared reference for MUSA driver operations used by both `deploy_musa_base_env` and `update_musa_driver` skills.

## Driver Package Download

### MOSS Setup

For MinIO Client setup and MOSS configuration, see `references/moss-download-guide.md`.

```bash
mc alias set sh-moss https://sh-moss.mthreads.com sw-guest-mt-sw sw-guest123
```

### Download Path Structure

Driver packages follow this path pattern on MOSS:

```
sh-moss/sw-release/musa/external/{SDK_VERSION}/deb/musa_{DRIVER_VERSION}[_server]_amd64.deb
```

Example:
```
sh-moss/sw-release/musa/external/4.3.1/deb/musa_3.3.1-server_amd64.deb
```

### Naming Variants

Driver packages may use different naming conventions:

| Variant | Example | When Used |
|---------|---------|-----------|
| Standard | `musa_3.3.1_amd64.deb` | Client/desktop drivers |
| Server | `musa_3.3.1-server_amd64.deb` | Server drivers (common) |

Always check both naming variants when looking for a package.

### Download with Fallback Search

If the expected SDK path does not contain the target driver, search the broader release tree:

```bash
mkdir -p ./musa_packages
BASE="sh-moss/sw-release/musa/external/${MUSA_SDK_VERSION}/deb"

# Try standard naming first
if mc ls "${BASE}/musa_${MT_GPU_DRIVER_VERSION}_amd64.deb" >/dev/null 2>&1; then
  mc cp "${BASE}/musa_${MT_GPU_DRIVER_VERSION}_amd64.deb" ./musa_packages/
  PACKAGE_PATH="./musa_packages/musa_${MT_GPU_DRIVER_VERSION}_amd64.deb"

# Try server naming variant
elif mc ls "${BASE}/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb" >/dev/null 2>&1; then
  mc cp "${BASE}/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb" ./musa_packages/
  PACKAGE_PATH="./musa_packages/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb"

# Search broader tree
else
  REMOTE_PACKAGE=$(mc find "sh-moss/sw-release/musa/external" --name "musa_${MT_GPU_DRIVER_VERSION}*amd64.deb" | head -n 1)

  if [ -z "$REMOTE_PACKAGE" ]; then
    echo "Target driver package not found on MOSS"
    exit 1
  fi

  mc cp "$REMOTE_PACKAGE" ./musa_packages/
  PACKAGE_PATH="./musa_packages/$(basename "$REMOTE_PACKAGE")"
fi
```

## Driver Installation

### Prerequisites

Ensure these packages are installed before driver installation:

```bash
sudo apt install -y \
  lightdm \
  dkms \
  libgbm1 \
  libglapi-mesa \
  linux-headers-$(uname -r)
```

For lightdm installation, if prompted for display manager, select lightdm.

### Remove Existing Driver

```bash
if dpkg -s musa &>/dev/null; then
  sudo dpkg -P musa
  sudo modprobe -rv mtgpu 2>/dev/null || true
fi
```

### Install Driver Package

```bash
sudo apt install -y "$PACKAGE_PATH"
```

Or with explicit deb file:

```bash
sudo apt install -y ./musa_packages/musa_3.3.1-server_amd64.deb
```

## Module Loading

### Load Driver Module

After installation, load the kernel module:

```bash
sudo modprobe mtgpu
```

### Reload Driver Module

If the driver was already loaded or needs refresh:

```bash
sudo modprobe -rv mtgpu 2>/dev/null || true
sudo modprobe mtgpu
```

If module loading fails repeatedly, ask the user for a manual reboot. Never auto-run `sudo reboot`.

## Driver Verification

### Host Verification

```bash
mthreads-gmi
```

Should show:
- GPU device information
- Driver version
- Memory information

### Check Installed Package Version

```bash
dpkg -s musa | awk -F': ' '/^Version:/{print $2}'
```

### Check Loaded Module

```bash
lsmod | grep mtgpu
```

## Sudo Password Handling

Check `MY_SUDO_PASSWD` environment variable first:

```bash
if [ -n "$MY_SUDO_PASSWD" ] && echo "$MY_SUDO_PASSWD" | sudo -S -v 2>/dev/null; then
  SUDO_PASSWORD="$MY_SUDO_PASSWD"
else
  # Prompt user for password
fi
```

**SUDO_PASSWORD Usage Scope:**
- System package installation (`apt install`)
- Driver package installation (`dpkg -i`, `apt install ./package.deb`)
- Driver package removal (`dpkg -P`)
- Module operations (`modprobe`)

**Never use SUDO_PASSWORD for:**
- Docker pull operations
- File downloads
- Git operations

## Common Issues

### 1. Driver Installation Fails

**Symptom:** `dpkg -i` or `apt install` fails with dependency errors.

**Solution:** Check kernel headers match the running kernel:

```bash
apt install linux-headers-$(uname -r)
```

### 2. Module Load Fails After Install

**Symptom:** `modprobe mtgpu` fails or `mthreads-gmi` cannot find GPU.

**Solution:**
1. Try explicit reload: `sudo modprobe -rv mtgpu && sudo modprobe mtgpu`
2. Check dmesg for errors: `dmesg | tail -50`
3. If still failing, ask for manual reboot

### 3. mthreads-gmi Shows Wrong Version

**Symptom:** After driver update, `mthreads-gmi` still reports old version.

**Solution:** The old module may still be loaded. Force reload:

```bash
sudo modprobe -rv mtgpu 2>/dev/null || true
sudo modprobe mtgpu
mthreads-gmi
```

### 4. Transient Initialization Error

**Symptom:** `mthreads-gmi` returns `failed to initialize mtml` right after reload.

**Solution:** This is often transient. Retry once:

```bash
mthreads-gmi || sleep 2 && mthreads-gmi
```

### 5. Driver Package Not Found

**Symptom:** Expected driver package not at the SDK path on MOSS.

**Solution:** Use broader search as shown in the download section above. The driver may exist under a different SDK version's directory.

## SDK/Driver Compatibility

For SDK and driver compatibility mapping, see `skills/deploy_musa_base_env/config/sdk_compatibility.yml`.

Key considerations:
- Each SDK version typically pairs with a specific driver version
- Driver naming may vary (with/without `-server` suffix)
- GPU type and architecture affect compatibility

## Remote Execution

When executing on Remote MT-GPU Machine:

- Use `remote-exec` tool for host-level commands (driver installation, modprobe)
- Use `remote-sync` to transfer downloaded driver packages
- Keep driver package paths aligned with remote path conventions:
  - Remote host: `~/workspace/<project>/musa_packages/`