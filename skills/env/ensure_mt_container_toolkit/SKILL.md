---
version: 1
name: ensure_mt_container_toolkit
description: |
  Ensure MT Container Toolkit is installed and bound to Docker.
  Validates container GPU access before and after installation.

category: env
kind: atomic
exposure: user
risk_level: idempotent
execution_mode: remote

owners:
  - env-team

triggers:
  - install container toolkit
  - ensure container toolkit
  - bind MUSA runtime to Docker
  - 配置容器工具包

# Keep scope concise - list only what this skill handles/doesn't handle
scope:
  includes:
    - Container toolkit installation
    - Docker runtime binding
    - Container GPU access validation
  excludes:
    - GPU driver installation (use ensure_musa_driver)
    - Docker installation (prerequisite)
    - Docker image management
---

# Ensure MT Container Toolkit

This atomic skill ensures the MT Container Toolkit is installed and properly bound to Docker for GPU container access.

## Invocation

- **Exposure**: user
- **Top-level intent**: `ensure_mt_container_toolkit`
- **Callable from orchestration**: Yes

### Invocation Example

```
musa_dispatch(intent="ensure_mt_container_toolkit", context={
  "TOOLKIT_VERSION": "1.0.0"
})
```

## When To Use This Skill

- After MUSA driver is installed
- When container GPU access is needed
- When container toolkit needs update
- As part of `deploy_musa_base_env` orchestration

## When Not To Use This Skill

- When driver is not installed (use `ensure_musa_driver` first)
- When Docker is not installed (Docker is a prerequisite)
- For application-level container operations

## Source Of Truth

- Toolkit versions: `skills/config/env/container_toolkit.yml`
- SDK compatibility: `skills/config/env/sdk_compatibility.yml`
- Container validation runbook: `references/container-validation-runbook.md`

## Prerequisites

- MUSA driver installed and loaded
- Docker installed and running
- Sudo privileges
- `yq` installed (for config parsing, installed by `ensure_system_dependencies`)

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `TOOLKIT_VERSION` | Target toolkit version | No | latest |

## Privileges Required

- **Sudo**: Yes
- **Remote access**: Yes
- **Docker access**: Yes
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
- Package installation
- Docker binding
- Docker service restart

## State Persistence

State file: `./.ensure_mt_container_toolkit_state.json`

### State Values

- `initialized` - Skill started
- `checked` - Current state checked
- `installed` - Toolkit installed
- `bound` - Runtime bound to Docker
- `validated` - Container GPU access verified
- `completed` - All steps done
- `failed_at_checked` - State check failed
- `failed_at_installed` - Installation failed
- `failed_at_bound` - Binding failed
- `failed_at_validated` - Validation failed

## Idempotency

- **Idempotent**: Yes
- **Re-run behavior**: Validates first, skips if already working

## Resume Behavior

- **Resume supported**: Yes
- **Resume from states**:
  - `checked` → continue from install/bind step
  - `installed` → continue from bind step
  - `bound` → continue from validate step

## Workflow

### Step 1: Check Current State

**Action**:
```bash
TOOLKIT_INSTALLED=false
RUNTIME_BOUND=false

# Check if toolkit is installed
if dpkg -s mt-container-toolkit &>/dev/null; then
    TOOLKIT_INSTALLED=true
    TOOLKIT_VERSION=$(dpkg -s mt-container-toolkit | awk -F': ' '/^Version:/{print $2}')
    echo "mt-container-toolkit ${TOOLKIT_VERSION} is installed"
else
    echo "mt-container-toolkit is NOT installed"
fi

# Check if Docker has MUSA runtime configured
if docker info 2>/dev/null | grep -q "mthreads"; then
    RUNTIME_BOUND=true
    echo "MUSA runtime is bound to Docker"
else
    echo "MUSA runtime is NOT bound to Docker"
fi

# Save state
cat > .ensure_mt_container_toolkit_state.json << EOF
{
  "status": "checked",
  "toolkitInstalled": ${TOOLKIT_INSTALLED},
  "toolkitVersion": "${TOOLKIT_VERSION:-}",
  "runtimeBound": ${RUNTIME_BOUND}
}
EOF
```

**Save state**: `checked`

**Verification**:
- Current state determined

---

### Step 2: Validate Container Runtime (Quick Check)

**Action**:
Always validate first - skip installation if already working:

```bash
VALIDATION_IMAGE="registry.mthreads.com/cloud-mirror/ubuntu:20.04"
VALIDATION_CMD="mthreads-gmi"

if docker run --rm --env MTHREADS_VISIBLE_DEVICES=all "$VALIDATION_IMAGE" $VALIDATION_CMD 2>/dev/null; then
    echo "Container runtime is working correctly"
    echo "Skipping toolkit installation."

    # Update state and complete
    jq '.status = "completed"' .ensure_mt_container_toolkit_state.json > .tmp && mv .tmp .ensure_mt_container_toolkit_state.json
    # Skip to Step 5 (Complete)
    exit 0
else
    echo "Container runtime validation failed"
    echo "Proceeding to diagnose and fix..."
fi
```

**Verification**:
- Container can access GPU

---

### Step 3: Install or Bind

**Action**:

#### Case A: Toolkit installed but not bound

```bash
if [ "$TOOLKIT_INSTALLED" = true ] && [ "$RUNTIME_BOUND" = false ]; then
    echo "Binding MUSA runtime to Docker..."
    (cd /usr/bin/musa && echo "$SUDO_PASSWORD" | sudo -S ./docker setup $PWD)

    # Restart Docker if needed
    if ! systemctl is-active --quiet docker; then
        echo "$SUDO_PASSWORD" | sudo -S systemctl restart docker
        (cd /usr/bin/musa && echo "$SUDO_PASSWORD" | sudo -S ./docker setup $PWD)
    fi

    # Update state
    jq '.status = "bound"' .ensure_mt_container_toolkit_state.json > .tmp && mv .tmp .ensure_mt_container_toolkit_state.json
fi
```

#### Case B: Toolkit not installed - Full Installation

```bash
if [ "$TOOLKIT_INSTALLED" = false ]; then
    # Resolve config path
    TOOLKIT_CONFIG="${PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || echo '.')}/skills/config/env/container_toolkit.yml"

    # Determine toolkit version
    if [ -z "$TOOLKIT_VERSION" ]; then
        TOOLKIT_VERSION=$(yq '.toolkits | sort_by(.version) | reverse | .[0].version' "$TOOLKIT_CONFIG")
    fi

    # Get download URL
    TOOLKIT_URL=$(yq '.toolkits[] | select(.version == "'${TOOLKIT_VERSION}'") | .url' "$TOOLKIT_CONFIG")

    # Download
    mkdir -p ./musa_packages
    wget -O ./musa_packages/container_toolkit.zip "$TOOLKIT_URL"

    # Extract
    unzip -o ./musa_packages/container_toolkit.zip -d ./musa_packages/
    cd ./musa_packages/mt-container-toolkit-*

    # Non-interactive install
    export DEBIAN_FRONTEND=noninteractive
    export NEEDRESTART_MODE=a

    # Handle partial install recovery
    if dpkg -s mt-container-toolkit 2>/dev/null | grep -q "reinstreq\|half-installed"; then
        echo "$SUDO_PASSWORD" | sudo -S dpkg --remove --force-remove-reinstreq mt-container-toolkit || true
    fi
    echo "$SUDO_PASSWORD" | sudo -S dpkg --configure -a

    # Install bundled components
    if ls *sgpu-dkms*.deb >/dev/null 2>&1; then
        echo "$SUDO_PASSWORD" | sudo -S apt install -y ./*sgpu-dkms*.deb
    fi

    if ls *mtml*.deb >/dev/null 2>&1; then
        echo "$SUDO_PASSWORD" | sudo -S apt install -y ./*mtml*.deb
    fi

    # Install main toolkit
    echo "$SUDO_PASSWORD" | sudo -S apt install -y ./*mt-container-toolkit*.deb

    # Bind to Docker
    (cd /usr/bin/musa && echo "$SUDO_PASSWORD" | sudo -S ./docker setup $PWD)

    # Restart Docker
    if ! systemctl is-active --quiet docker; then
        echo "$SUDO_PASSWORD" | sudo -S systemctl restart docker
        (cd /usr/bin/musa && echo "$SUDO_PASSWORD" | sudo -S ./docker setup $PWD)
    fi

    # Update state
    jq '.status = "installed" | .runtimeBound = true' .ensure_mt_container_toolkit_state.json > .tmp && mv .tmp .ensure_mt_container_toolkit_state.json
fi
```

**Save state**: `installed` or `bound`

**Verification**:
- Toolkit installed or bound
- Docker has mthreads runtime

---

### Step 4: Validate

**Action**:
```bash
# Final validation
VALIDATION_IMAGE="registry.mthreads.com/cloud-mirror/ubuntu:20.04"
VALIDATION_CMD="mthreads-gmi"

if ! docker run --rm --env MTHREADS_VISIBLE_DEVICES=all "$VALIDATION_IMAGE" $VALIDATION_CMD; then
    echo "Container runtime validation failed after installation"
    # Follow troubleshooting runbook
    echo "See: references/container-validation-runbook.md"
    exit 1
fi

echo "Container runtime validation successful"

# Update state
jq '.status = "validated"' .ensure_mt_container_toolkit_state.json > .tmp && mv .tmp .ensure_mt_container_toolkit_state.json
```

**Save state**: `validated`

**Verification**:
- Container can access GPU

---

### Step 5: Complete

**Action**:
```bash
jq '.status = "completed"' .ensure_mt_container_toolkit_state.json > .tmp && mv .tmp .ensure_mt_container_toolkit_state.json
echo "MT Container Toolkit is ready"
```

**Save state**: `completed`

**Verification**:
- All steps completed

## Success Criteria

- Toolkit installed
- Docker has mthreads runtime
- Container can access GPU

### Example Checks

- docker info | grep mthreads
- docker run --rm --env MTHREADS_VISIBLE_DEVICES=all registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi

## Outputs

### Output Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | Execution status: `completed` / `failed` |
| `toolkitInstalled` | boolean | No | Whether toolkit is installed |
| `toolkitVersion` | string | No | Installed toolkit version |
| `runtimeBound` | boolean | No | Whether runtime is bound to Docker |
| `validationPassed` | boolean | No | Container validation result |

### Output Example

```json
{
  "status": "completed",
  "toolkitInstalled": true,
  "toolkitVersion": "1.0.0",
  "runtimeBound": true,
  "validationPassed": true
}
```

## Side Effects

- **Modifies**: Docker configuration
- **Creates**: /usr/bin/musa symlinks
- **Removes/Replaces**: Previous toolkit version
- **Requires reboot**: No

## Important Rules

1. **Validate first**: Always check if container runtime works before installing
2. **Bind only if needed**: If toolkit installed but not bound, only run binding
3. **Handle partial install**: Clean up broken installations before retry
4. **Docker restart**: May be needed after binding

## Troubleshooting

### Common Issues

1. **"mthreads-container-runtime not found in PATH"**
   ```bash
   sudo ln -sf /usr/bin/musa/mthreads-container-runtime /usr/bin/mthreads-container-runtime
   sudo ln -sf /usr/bin/musa/mthreads-container-runtime /usr/bin/mthreads-container-runtime-experimental
   sudo systemctl restart docker
   ```

2. **Docker not running**
   ```bash
   sudo systemctl start docker
   ```

3. **Validation fails after installation**
   - Check driver is loaded: `mthreads-gmi`
   - Check Docker has runtime: `docker info | grep mthreads`
   - See `references/container-validation-runbook.md`