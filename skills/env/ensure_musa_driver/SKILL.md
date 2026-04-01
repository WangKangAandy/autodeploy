---
version: 1
name: ensure_musa_driver
description: Install and verify MUSA GPU driver on MT-GPU hosts.

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
  - 确保 MUSA 驱动
---

# Ensure MUSA Driver

Ensures MUSA GPU driver is installed and working at the target version.

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `MT_GPU_DRIVER_VERSION` | Target driver version (e.g., `3.3.5-server`) | Yes | - |
| `MUSA_SDK_VERSION` | SDK version for compatibility lookup | No | - |
| `DRIVER_PACKAGE_PATH` | Pre-downloaded driver package path | No | - |

## MOSS Credentials

Environment variables (in priority order):
1. `MOSS_ACCESS_KEY` / `MOSS_SECRET_KEY`
2. `MT_MOSS_ACCESS_KEY` / `MT_MOSS_SECRET_KEY`
3. Default guest credentials (for public packages)

## Workflow

### Step 1: Check Driver Status

```bash
CURRENT_VERSION=""
DRIVER_LOADED=false

if dpkg -s musa &>/dev/null; then
    CURRENT_VERSION=$(dpkg -s musa | awk -F': ' '/^Version:/{print $2}')
    echo "Current driver: ${CURRENT_VERSION}"
else
    echo "No driver installed"
fi

if mthreads-gmi &>/dev/null; then
    DRIVER_LOADED=true
    echo "Driver module loaded"
fi
```

Verification: Driver status determined

---

### Step 2: Prepare Driver Package

Skip if driver already matches target version and is loaded.

```bash
if [ "$CURRENT_VERSION" = "$MT_GPU_DRIVER_VERSION" ] && [ "$DRIVER_LOADED" = true ]; then
    echo "Driver already at target version. Skipping."
else
    if [ -n "${DRIVER_PACKAGE_PATH:-}" ] && [ -f "$DRIVER_PACKAGE_PATH" ]; then
        PACKAGE_PATH="$DRIVER_PACKAGE_PATH"
    else
        # Download from MOSS
        MOSS_AK="${MOSS_ACCESS_KEY:-${MT_MOSS_ACCESS_KEY:-sw-guest-mt-sw}}"
        MOSS_SK="${MOSS_SECRET_KEY:-${MT_MOSS_SECRET_KEY:-sw-guest123}}"

        mc alias set sh-moss https://sh-moss.mthreads.com "$MOSS_AK" "$MOSS_SK"
        mkdir -p ./musa_packages

        BASE="sh-moss/sw-release/musa/external/${MUSA_SDK_VERSION}/deb"
        mc cp "${BASE}/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb" ./musa_packages/
        PACKAGE_PATH="./musa_packages/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb"
    fi
fi
```

Verification: Package file exists

---

### Step 3: Apply Driver

```bash
if [ "$CURRENT_VERSION" != "$MT_GPU_DRIVER_VERSION" ] || [ "$DRIVER_LOADED" = false ]; then
    # Remove existing driver
    if dpkg -s musa &>/dev/null; then
        echo "$SUDO_PASSWORD" | sudo -S dpkg -P musa
        echo "$SUDO_PASSWORD" | sudo -S modprobe -rv mtgpu 2>/dev/null || true
    fi

    # Install new driver
    echo "$SUDO_PASSWORD" | sudo -S apt install -y "$PACKAGE_PATH"

    # Load module
    echo "$SUDO_PASSWORD" | sudo -S sh -c 'modprobe -rv mtgpu 2>/dev/null || true; modprobe mtgpu'
fi
```

Verification: Driver package installed, module loaded

---

### Step 4: Validate Driver

```bash
if ! mthreads-gmi; then
    sleep 2
    if ! mthreads-gmi; then
        echo "Driver validation failed"
        exit 1
    fi
fi

INSTALLED_VERSION=$(dpkg -s musa | awk -F': ' '/^Version:/{print $2}')
echo "Driver ${INSTALLED_VERSION} validated"
```

Verification: mthreads-gmi executes, version matches target

## Success Criteria

- Driver installed at target version
- Driver module loaded
- mthreads-gmi executes successfully

## Troubleshooting

1. **Module fails to load** - Check kernel headers: `apt install linux-headers-$(uname -r)`
2. **mthreads-gmi fails** - Transient error, retry after 2 seconds
3. **Package not found on MOSS** - Search: `mc find sh-moss/sw-release/musa/external --name "musa_*"`
4. **Dpkg lock** - Wait: `lsof /var/lib/dpkg/lock`