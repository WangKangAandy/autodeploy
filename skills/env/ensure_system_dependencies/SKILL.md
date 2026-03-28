---
version: 1
name: ensure_system_dependencies
description: |
  Ensure system dependencies required for MUSA GPU driver and container runtime are installed.
  This skill checks for missing packages and installs them as needed.

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
  - ensure system packages
  - 安装系统依赖

# Keep scope concise - list only what this skill handles/doesn't handle
scope:
  includes:
    - System package installation (apt)
    - Kernel headers matching current kernel
    - Display manager (lightdm)
    - Build tools and libraries
  excludes:
    - GPU driver installation
    - Container toolkit installation
    - Docker installation
---

# Ensure System Dependencies

This atomic skill ensures all required system dependencies are installed for MUSA GPU driver and container runtime operation.

## Invocation

- **Exposure**: internal
- **Top-level intent**: `ensure_system_dependencies`
- **Callable from orchestration**: Yes

### Invocation Example

```
musa_dispatch(intent="ensure_system_dependencies", context={
  "mode": "full"
})
```

## When To Use This Skill

- Before installing MUSA driver
- Before updating driver on a fresh system
- When system dependency issues are suspected
- As part of `deploy_musa_base_env` orchestration

## When Not To Use This Skill

- When only driver update is needed on an already-configured system (use `ensure_musa_driver` directly)
- When Docker is not installed (Docker is a prerequisite, not installed by this skill)

## Dependencies

This skill installs the following packages:

| Package | Purpose |
|---------|---------|
| `build-essential` | GCC, make, build tools |
| `dkms` | Dynamic Kernel Module Support |
| `lightdm` | Display manager |
| `libgbm1`, `libglapi-mesa` | Graphics libraries |
| `linux-headers-$(uname -r)` | Kernel headers matching current kernel |
| `wget`, `curl` | Download tools |
| `jq` | JSON processor (for state files) |
| `yq` | YAML processor (for config files) |

## Source Of Truth

- Package list: `skills/env/ensure_system_dependencies/config/packages.yml`
- Driver installation reference: `references/driver-install-guide.md`

## Prerequisites

- Ubuntu 20.04 or compatible Linux distribution
- Sudo privileges
- Internet connectivity for package downloads

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `mode` | Execution mode: `full` (check and install all) or `check_and_fix` (only install missing) | No | `full` |

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
- `apt update`
- `apt install`
- Kernel headers installation

## State Persistence

State file: `./.ensure_system_dependencies_state.json`

### State Values

- `initialized` - Skill started, checking current state
- `checked` - Package check completed
- `installed` - Missing packages installed
- `completed` - All dependencies verified
- `failed_at_checked` - Check failed
- `failed_at_installed` - Installation failed

## Idempotency

- **Idempotent**: Yes
- **Re-run behavior**: Only installs missing packages, skips already installed

## Resume Behavior

- **Resume supported**: Yes
- **Resume from states**:
  - `checked` → continue from install step
  - `installed` → continue from verify step

## Workflow

### Step 1: Check Current State

**Action**:
Check which required packages are already installed:

```bash
# Required packages (from config/packages.yml)
REQUIRED_PACKAGES="lightdm dkms libgbm1 libglapi-mesa linux-headers-$(uname -r) build-essential wget curl jq yq"

MISSING_PACKAGES=""
INSTALLED_PACKAGES=""

for pkg in $REQUIRED_PACKAGES; do
    if dpkg -s "$pkg" >/dev/null 2>&1; then
        INSTALLED_PACKAGES="$INSTALLED_PACKAGES $pkg"
    else
        MISSING_PACKAGES="$MISSING_PACKAGES $pkg"
    fi
done

echo "Already installed:$INSTALLED_PACKAGES"
echo "Missing:$MISSING_PACKAGES"

# Save state
echo '{"status": "checked", "installed": "'$INSTALLED_PACKAGES'", "missing": "'$MISSING_PACKAGES'"}' > .ensure_system_dependencies_state.json
```

**Save state**: `checked`

**Verification**:
- Package check completed

---

### Step 2: Install Missing Packages

**Action**:
If `mode=check_and_fix` and no packages are missing, skip this step.

```bash
if [ -z "$MISSING_PACKAGES" ]; then
    echo "All required packages are already installed."
    # Skip to Step 3
else
    echo "Installing missing packages: $MISSING_PACKAGES"

    # Update package list
    echo "$SUDO_PASSWORD" | sudo -S apt update

    # Install packages non-interactively
    export DEBIAN_FRONTEND=noninteractive
    export NEEDRESTART_MODE=a

    echo "$SUDO_PASSWORD" | sudo -S apt install -y $MISSING_PACKAGES
fi
```

**Note for lightdm**: If prompted for display manager during installation, select `lightdm`.

**Save state**: `installed`

**Verification**:
- Packages installed without errors

---

### Step 3: Verify Installation

**Action**:
```bash
# Verify all required packages are now installed
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

echo "All required packages installed successfully."

# Update state file
jq '.status = "completed"' .ensure_system_dependencies_state.json > .ensure_system_dependencies_state.json.tmp
mv .ensure_system_dependencies_state.json.tmp .ensure_system_dependencies_state.json
```

**Save state**: `completed`

**Verification**:
- All packages installed

## Success Criteria

- All required packages installed
- No failed packages

### Example Checks

- dpkg -s build-essential shows "install ok installed"
- dpkg -s dkms shows "install ok installed"
- Kernel headers match current kernel

## Outputs

### Output Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | Execution status: `completed` / `failed` |
| `installed` | string | No | Space-separated list of already installed packages |
| `missing` | string | No | Space-separated list of packages that were missing |
| `newly_installed` | string[] | No | List of newly installed packages |

### Output Example

```json
{
  "status": "completed",
  "installed": "lightdm dkms libgbm1 libglapi-mesa linux-headers-xxx build-essential wget curl jq",
  "missing": "",
  "newly_installed": ["dkms", "linux-headers-xxx"]
}
```

## Side Effects

- **Modifies**: System package state
- **Creates**: None
- **Removes/Replaces**: None
- **Requires reboot**: No

## Important Rules

1. **Idempotent**: Running multiple times should not cause errors
2. **Minimal changes**: Only install what's missing
3. **Kernel headers**: Always match current kernel version (`linux-headers-$(uname -r)`)
4. **Non-interactive**: Use `DEBIAN_FRONTEND=noninteractive` for automation

## Troubleshooting

### Common Issues

1. **Kernel headers not found for current kernel**
   - Check if kernel is up to date: `uname -r` vs `apt list linux-image-*`
   - May need to update kernel first or install headers for older kernel

2. **lightdm installation prompts for display manager**
   - Use `DEBIAN_FRONTEND=noninteractive` to avoid prompts
   - Or pre-select with `debconf-set-selections`

3. **Package manager locked**
   - Wait for other apt processes to finish
   - Check with `lsof /var/lib/dpkg/lock`