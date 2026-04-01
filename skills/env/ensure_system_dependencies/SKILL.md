---
version: 1
name: ensure_system_dependencies
description: Install system dependencies required for MUSA GPU driver and container runtime.

category: env
kind: atomic
exposure: internal
risk_level: safe
execution_mode: remote

owners:
  - env-team

triggers:
  - install system dependencies
  - check system dependencies
  - 安装系统依赖
---

# Ensure System Dependencies

Installs required system packages for MUSA driver and container runtime.

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `mode` | `full` (install all) or `check_and_fix` (only missing) | No | `full` |

## Packages Installed

| Package | Purpose |
|---------|---------|
| `build-essential` | GCC, make, build tools |
| `dkms` | Dynamic Kernel Module Support |
| `lightdm` | Display manager |
| `libgbm1`, `libglapi-mesa` | Graphics libraries |
| `linux-headers-$(uname -r)` | Kernel headers |
| `wget`, `curl`, `jq`, `yq` | Download and processing tools |

## Workflow

### Step 1: Check Current State

```bash
REQUIRED_PACKAGES="lightdm dkms libgbm1 libglapi-mesa linux-headers-$(uname -r) build-essential wget curl jq yq"

MISSING_PACKAGES=""
for pkg in $REQUIRED_PACKAGES; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
        MISSING_PACKAGES="$MISSING_PACKAGES $pkg"
    fi
done

echo "Missing packages:$MISSING_PACKAGES"
```

Verification: Package check completed

---

### Step 2: Install Missing Packages

```bash
if [ -n "$MISSING_PACKAGES" ]; then
    echo "Installing: $MISSING_PACKAGES"

    export DEBIAN_FRONTEND=noninteractive
    export NEEDRESTART_MODE=a

    echo "$SUDO_PASSWORD" | sudo -S apt update
    echo "$SUDO_PASSWORD" | sudo -S apt install -y $MISSING_PACKAGES
fi
```

Note: If prompted for display manager during lightdm installation, select `lightdm`.

Verification: Packages installed without errors

---

### Step 3: Verify Installation

```bash
FAILED_PACKAGES=""
for pkg in $REQUIRED_PACKAGES; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
        FAILED_PACKAGES="$FAILED_PACKAGES $pkg"
    fi
done

if [ -n "$FAILED_PACKAGES" ]; then
    echo "Failed to install: $FAILED_PACKAGES"
    exit 1
fi

echo "All required packages installed."
```

Verification: All packages installed

## Success Criteria

- All required packages installed
- `dpkg -s build-essential` shows "install ok installed"
- `dpkg -s dkms` shows "install ok installed"

## Troubleshooting

1. **Kernel headers not found** - Check if kernel is up to date: `uname -r` vs `apt list linux-image-*`
2. **lightdm prompts for display manager** - Use `DEBIAN_FRONTEND=noninteractive`
3. **Package manager locked** - Wait for other apt processes: `lsof /var/lib/dpkg/lock`