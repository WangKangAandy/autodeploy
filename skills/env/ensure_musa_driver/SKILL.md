---
version: 1
name: ensure_musa_driver
description: |
  Ensure MUSA GPU driver is in the target state.
  Handles driver check, installation, update, and verification.

category: env
kind: atomic
exposure: internal
risk_level: idempotent
execution_mode: remote

owners:
  - env-team

triggers:
  - ensure MUSA driver
  - install MUSA driver
  - update MUSA driver
  - check driver status
  - 确保 MUSA 驱动

# Keep scope concise - list only what this skill handles/doesn't handle
scope:
  includes:
    - Driver version check
    - Driver package preparation
    - Driver installation/update
    - Driver module loading
    - Driver validation
  excludes:
    - System dependencies installation (use ensure_system_dependencies)
    - Container toolkit installation
    - Container validation
---

# Ensure MUSA Driver

This atomic skill ensures the MUSA GPU driver is installed and in the target state.

## Invocation

- **Exposure**: internal
- **Top-level intent**: `ensure_musa_driver`
- **Callable from orchestration**: Yes

### Invocation Example

```
musa_dispatch(intent="ensure_musa_driver", context={
  "MT_GPU_DRIVER_VERSION": "3.3.5-server",
  "MUSA_SDK_VERSION": "4.3.5"
})
```

## When To Use This Skill

- When you need a specific driver version installed
- When driver state needs to be verified
- As part of `deploy_musa_base_env` orchestration
- As part of `update_musa_driver` workflow

## When Not To Use This Skill

- When you need full environment deployment (use `deploy_musa_base_env`)
- When system dependencies are not yet installed (use `ensure_system_dependencies` first)

## Source Of Truth

- SDK/Driver compatibility: `skills/config/env/sdk_compatibility.yml`
- MOSS download guide: `references/moss-download-guide.md`
- Driver install guide: `references/driver-install-guide.md`

## Prerequisites

- System dependencies installed (use `ensure_system_dependencies`)
- Sudo privileges
- MOSS access (for driver download) or local package path

## MOSS Credentials

MOSS credentials are read from environment variables (in order of priority):

1. `MOSS_ACCESS_KEY` / `MOSS_SECRET_KEY`
2. `MT_MOSS_ACCESS_KEY` / `MT_MOSS_SECRET_KEY`
3. Default guest credentials (for public packages)

```bash
# Set credentials (optional, defaults to guest)
export MOSS_ACCESS_KEY="your-access-key"
export MOSS_SECRET_KEY="your-secret-key"
```

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `MT_GPU_DRIVER_VERSION` | Target driver version (e.g., `3.3.5-server`) | Yes | - |
| `MUSA_SDK_VERSION` | SDK version for compatibility lookup | No* | - |
| `DRIVER_PACKAGE_PATH` | Pre-downloaded driver package path | No | - |

*If `MT_GPU_DRIVER_VERSION` not provided, can be resolved from `MUSA_SDK_VERSION` via compatibility mapping.

## Privileges Required

- **Sudo**: Yes
- **Remote access**: Yes
- **Docker access**: No
- **Network access**: Yes

## Execution Mode

Remote execution on MT-GPU machine via SSH.

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
- Driver package installation (`dpkg -i`, `apt install`)
- Driver removal (`dpkg -P`)
- Module loading (`modprobe`)

## State Persistence

State file: `./.ensure_musa_driver_state.json`

### State Values

- `initialized` - Skill started, collecting inputs
- `checked` - Current driver status checked
- `prepared` - Driver package ready
- `applied` - Driver installed/updated
- `validated` - Driver verified working
- `completed` - All steps done
- `failed_at_checked` - Status check failed
- `failed_at_prepared` - Package preparation failed
- `failed_at_applied` - Driver installation failed
- `failed_at_validated` - Driver validation failed

## Idempotency

- **Idempotent**: Yes
- **Re-run behavior**: If driver already at target version and loaded, skips installation

## Resume Behavior

- **Resume supported**: Yes
- **Resume from states**:
  - `checked` → continue from prepare step
  - `prepared` → continue from apply step
  - `applied` → continue from validate step

## Workflow

### Step 1: Check Driver Status

**Action**:
```bash
CURRENT_VERSION=""
DRIVER_LOADED=false

# Check if driver package is installed
if dpkg -s musa &>/dev/null; then
    CURRENT_VERSION=$(dpkg -s musa | awk -F': ' '/^Version:/{print $2}')
    echo "Current driver version: ${CURRENT_VERSION}"
else
    echo "No driver installed"
fi

# Check if driver module is loaded
if mthreads-gmi &>/dev/null; then
    DRIVER_LOADED=true
    echo "Driver module is loaded"
else
    echo "Driver module is not loaded"
fi

# Save state
cat > .ensure_musa_driver_state.json << EOF
{
  "status": "checked",
  "currentVersion": "${CURRENT_VERSION}",
  "targetVersion": "${MT_GPU_DRIVER_VERSION}",
  "driverLoaded": ${DRIVER_LOADED}
}
EOF
```

**Save state**: `checked`

**Verification**:
- Driver status determined

---

### Step 2: Prepare Driver Package

**Action**:
If driver already matches target version, skip to Step 4.

```bash
# Check if we need to update
if [ "$CURRENT_VERSION" = "$MT_GPU_DRIVER_VERSION" ] && [ "$DRIVER_LOADED" = true ]; then
    echo "Driver already at target version and loaded. Skipping installation."
    # Jump to validation (Step 4)
else
    # Prepare package
    if [ -n "${DRIVER_PACKAGE_PATH:-}" ] && [ -f "$DRIVER_PACKAGE_PATH" ]; then
        PACKAGE_PATH="$DRIVER_PACKAGE_PATH"
    elif [ -f "./musa_packages/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb" ]; then
        PACKAGE_PATH="./musa_packages/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb"
    else
        # Download from MOSS
        # See prepare_musa_package skill or references/moss-download-guide.md

        # Get MOSS credentials from environment
        MOSS_AK="${MOSS_ACCESS_KEY:-${MT_MOSS_ACCESS_KEY:-sw-guest-mt-sw}}"
        MOSS_SK="${MOSS_SECRET_KEY:-${MT_MOSS_SECRET_KEY:-sw-guest123}}"

        mc alias set sh-moss https://sh-moss.mthreads.com "$MOSS_AK" "$MOSS_SK"
        mkdir -p ./musa_packages

        BASE="sh-moss/sw-release/musa/external/${MUSA_SDK_VERSION}/deb"
        mc cp "${BASE}/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb" ./musa_packages/
        PACKAGE_PATH="./musa_packages/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb"
    fi

    echo "Driver package ready: $PACKAGE_PATH"
fi
```

**Save state**: `prepared`

**Verification**:
- Package file exists and has content

---

### Step 3: Apply Driver

**Action**:
```bash
# Only run if driver needs update
if [ "$CURRENT_VERSION" != "$MT_GPU_DRIVER_VERSION" ] || [ "$DRIVER_LOADED" = false ]; then

    # Uninstall existing driver if present
    if dpkg -s musa &>/dev/null; then
        echo "Removing existing driver..."
        echo "$SUDO_PASSWORD" | sudo -S dpkg -P musa
        echo "$SUDO_PASSWORD" | sudo -S modprobe -rv mtgpu 2>/dev/null || true
    fi

    # Install new driver
    echo "Installing driver ${MT_GPU_DRIVER_VERSION}..."
    echo "$SUDO_PASSWORD" | sudo -S apt install -y "$PACKAGE_PATH"

    # Load driver module
    echo "$SUDO_PASSWORD" | sudo -S sh -c 'modprobe -rv mtgpu 2>/dev/null || true; modprobe mtgpu'
fi
```

**Save state**: `applied`

**Verification**:
- Driver package installed
- Module loaded

---

### Step 4: Validate Driver

**Action**:
```bash
# Verify driver is working
if ! mthreads-gmi; then
    echo "Error: mthreads-gmi failed after driver installation"

    # Retry once for transient errors
    sleep 2
    if ! mthreads-gmi; then
        echo "Driver validation failed"
        exit 1
    fi
fi

# Verify version
INSTALLED_VERSION=$(dpkg -s musa | awk -F': ' '/^Version:/{print $2}')
if [ "$INSTALLED_VERSION" != "$MT_GPU_DRIVER_VERSION" ]; then
    echo "Warning: Installed version ($INSTALLED_VERSION) differs from target ($MT_GPU_DRIVER_VERSION)"
fi

echo "Driver validation successful"

# Update state
jq '.status = "validated"' .ensure_musa_driver_state.json > .tmp && mv .tmp .ensure_musa_driver_state.json
```

**Save state**: `validated`

**Verification**:
- mthreads-gmi executes successfully
- Version matches target

---

### Step 5: Complete

**Action**:
```bash
# Final state update
jq '.status = "completed"' .ensure_musa_driver_state.json > .tmp && mv .tmp .ensure_musa_driver_state.json

echo "MUSA driver ${MT_GPU_DRIVER_VERSION} is ready"
```

**Save state**: `completed`

**Verification**:
- All steps completed

## Success Criteria

- Driver installed at target version
- Driver module loaded
- mthreads-gmi executes successfully

### Example Checks

- mthreads-gmi shows GPU info
- dpkg -s musa shows target version
- lsmod | grep mtgpu shows module loaded

## Outputs

### Output Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | Execution status: `completed` / `failed` |
| `currentVersion` | string | No | Version before installation |
| `targetVersion` | string | Yes | Target driver version |
| `installedVersion` | string | No | Version after installation |
| `driverLoaded` | boolean | No | Whether driver module is loaded |
| `mthreadsGmiOutput` | string | No | Output from mthreads-gmi |

### Output Example

```json
{
  "status": "completed",
  "currentVersion": "3.3.4-server",
  "targetVersion": "3.3.5-server",
  "installedVersion": "3.3.5-server",
  "driverLoaded": true,
  "mthreadsGmiOutput": "..."
}
```

## Side Effects

- **Modifies**: Driver package state (dpkg)
- **Creates**: None
- **Removes/Replaces**: Previous driver version
- **Requires reboot**: No (module reload via modprobe)

## Important Rules

1. **Version match skip**: If current version matches target and driver is loaded, skip installation
2. **Module reload required**: After driver update, must reload `mtgpu` module
3. **No auto-reboot**: Never run `sudo reboot` automatically
4. **Transient error retry**: Retry `mthreads-gmi` once if it fails immediately after reload
5. **Clean uninstall**: Always remove old driver before installing new one

## Troubleshooting

### Common Issues

1. **Driver module fails to load**
   - Check kernel headers: `apt install linux-headers-$(uname -r)`
   - Check for conflicting drivers
   - May need manual reboot

2. **mthreads-gmi fails with "failed to initialize mtml"**
   - Transient error, retry after 2 seconds
   - If persists, check driver installation

3. **Package not found on MOSS**
   - Check SDK/driver compatibility mapping
   - Search broader MOSS path: `mc find sh-moss/sw-release/musa/external --name "musa_*"`

4. **Dpkg lock**
   - Wait for other package operations to complete
   - Check: `lsof /var/lib/dpkg/lock`