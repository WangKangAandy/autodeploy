---
name: deploy_musa_base_env
description: |
  Deploy MUSA GPU container runtime environment on bare-metal hosts.

  **Scope**: System dependencies → GPU driver → Container toolkit → Docker image → Container validation

  **NOT in scope**:
  - MUSA toolkits (mcc, mublas, mufft, etc.) - these are bundled in Docker images
  - Application-level libraries (PyTorch, TensorFlow) - use pre-built images

triggers:
  - deploy MUSA container runtime
  - setup MUSA Docker environment
  - 配置 MUSA 容器运行时
  - 安装 MUSA GPU 驱动
  - MUSA Docker 环境部署

scope:
  includes:
    - System dependencies (build-essential, dkms, etc.)
    - GPU driver installation
    - Container toolkit installation and Docker binding
    - Docker image pull
    - Container GPU access validation
  excludes:
    - MUSA toolkits (mcc, mublas, mufft, muPP, etc.)
    - Deep learning frameworks (PyTorch, TensorFlow)
    - Application deployment
---

# MUSA Full Environment Deployment

This skill performs a complete MUSA SDK deployment on a bare-metal host, following the sequence: system dependencies → GPU driver → container toolkit → Docker image → container environment validation. It supports both local execution and remote deployment modes.

## Deployment Mode Selection

**IMPORTANT: Before starting deployment, ask the user:**

1. **Local deployment**: Deploy on the current machine
2. **Remote deployment**: Deploy on a remote MT-GPU machine via SSH

If remote deployment is selected, collect:
- Host IP address
- SSH username
- SSH password
- SSH port (default: 22)

Then use the `musa_set_mode` tool to configure the deployment mode:

```
# For local deployment:
musa_set_mode(mode="local")

# For remote deployment:
musa_set_mode(mode="remote", host="192.168.1.100", user="gpuuser", password="xxx", port=22)
```

## Source Of Truth

- SDK/driver compatibility mapping: `skills/deploy_musa_base_env/config/sdk_compatibility.yml`
- MOSS download and MinIO Client setup: `references/moss-download-guide.md`
- Driver installation reference: `references/driver-install-guide.md`
- Container validation troubleshooting: `references/container-validation-runbook.md`
- Remote command routing: `references/remote-execution-policy.md`

## Prerequisites

### System Requirements
- Ubuntu 20.04 or compatible Linux distribution
- Docker installed and running
- Internet connectivity for package downloads
- Sudo privileges for system package installation

### Required Tools
Check and install required tools at the very start:

| Tool | Purpose | Install Command |
|------|---------|-----------------|
| `wget` | Download packages | `sudo apt install -y wget` |
| `curl` | HTTP client | `sudo apt install -y curl` |
| `jq` | JSON processor | `sudo apt install -y jq` |
| `mc` | MinIO Client for MOSS downloads | See `references/moss-download-guide.md` |

For MinIO Client setup and MOSS configuration details, see `references/moss-download-guide.md`.



## Predefined SDK Versions

All version mapping (SDK, driver, GPU type, supported images) is maintained in `skills/deploy_musa_base_env/config/sdk_compatibility.yml`.

Read dynamically using:

```bash
yq '.compatibility[0].driver_version' skills/deploy_musa_base_env/config/sdk_compatibility.yml
```

Container toolkit compatibility is not treated as a default mapping constraint unless a specific SDK entry later declares an explicit minimum version requirement.


## Input Variables

When in custom mode, collect the following variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `MUSA_SDK_VERSION` | MUSA SDK version (read from `sdk_compatibility.yml` if not specified) | Yes |
| `MT_GPU_DRIVER_VERSION` | GPU driver version (resolved from SDK compatibility mapping) | Yes |
| `MT_GPU_TYPE` | GPU type: S5000 or S4000 | Yes |
| `MT_GPU_ARCH` | Architecture suffix: PH1 (S5000) or QY2 (S4000) | Yes |
| `DOCKER_IMAGE` | Docker image for container validation (read from `sdk_compatibility.yml`) | Yes |

**Default values are read from `skills/deploy_musa_base_env/config/sdk_compatibility.yml`.**

## Sudo Password Handling

### Primary Method: Environment Variable
Check `MY_SUDO_PASSWD` environment variable first. This is the preferred method for automation:

```bash
if [ -n "$MY_SUDO_PASSWD" ] && echo "$MY_SUDO_PASSWD" | sudo -S -v 2>/dev/null; then
    SUDO_PASSWORD="$MY_SUDO_PASSWD"
else
    # Use the question tool to prompt user
fi
```


**SUDO_PASSWORD Usage Scope:**
- System package installation (`apt install`)
- Driver package installation (`dpkg -i`)
- Toolkits installation scripts
- Container toolkit installation
- Docker service restart

**Never use SUDO_PASSWORD for:**
- Docker pull operations
- File downloads
- Git operations

## State Persistence

Save state to `./.musa_deployment_state.json` before reboot and load on resume. Use `jq` to read/write state fields.

### State Values
- `initialized` - Skill started, variables collected
- `dependencies_installed` - System dependencies installed
- `driver_installed` - GPU driver installed
- `driver_loaded` - GPU driver loaded
- `container_toolkit_installed` - Container toolkit installed and bound
- `docker_image_pulled` - Docker image pulled from registry
- `container_validated` - Container environment validated
- `completed` - All steps completed successfully


## Installation Steps

### Step 1: System Dependencies Installation

Install required system packages:

```bash
echo "$SUDO_PASSWORD" | sudo -S apt update
echo "$SUDO_PASSWORD" | sudo -S apt install -y \
    lightdm \
    dkms \
    libgbm1 \
    libglapi-mesa \
    linux-headers-$(uname -r)
```

For lightdm installation, if prompted for display manager, select lightdm.


Save state: `dependencies_installed`

### Step 2: GPU Driver Installation

#### 2.1 Check and Compare Driver Version

**IMPORTANT**: Compare driver version before downloading. Skip if already matches requirement.

```bash
# Read required driver version from config
REQUIRED_DRIVER=$(yq '.compatibility[] | select(.sdk_version == "'$MUSA_SDK_VERSION'") | .driver_version' skills/deploy_musa_base_env/config/sdk_compatibility.yml)
echo "Required driver version for SDK $MUSA_SDK_VERSION: $REQUIRED_DRIVER"

# Check if driver is already installed
if dpkg -s musa &>/dev/null; then
    CURRENT_VERSION=$(dpkg -s musa | grep Version | awk '{print $2}')
    echo "Current driver version: $CURRENT_VERSION"
    
    # Compare versions
    if [ "$CURRENT_VERSION" = "$REQUIRED_DRIVER" ]; then
        echo "✓ Driver version matches requirement: $CURRENT_VERSION"
        echo "Skipping driver download and installation."

        # Verify driver is loaded
        if mthreads-gmi &>/dev/null; then
            echo "✓ Driver is loaded and working"
            # Save state and skip to Step 3
            # State: driver_installed, driver_loaded
        else
            echo "Driver not loaded, loading..."
            echo "$SUDO_PASSWORD" | sudo -S modprobe mtgpu
            mthreads-gmi
        fi

        # Skip to Step 3: Container Runtime Validation
        echo "Proceeding to Step 3: Container Runtime Validation"
        # Continue to Step 3

    else
        echo "✗ Driver version mismatch"
        echo "  Current: $CURRENT_VERSION"
        echo "  Required: $REQUIRED_DRIVER"
        echo "Proceeding with driver update..."
    fi
else
    echo "No driver installed. Proceeding with installation..."
fi
```

If driver version matches and is loaded, save state: `driver_installed`, `driver_loaded` and skip to Step 3.

#### 2.2 Download Driver Package

For MinIO Client setup and MOSS configuration, see `references/moss-download-guide.md`.

```bash
# Set up MinIO client for MOSS access
mc alias set sh-moss https://sh-moss.mthreads.com sw-guest-mt-sw sw-guest123

# Download driver package
mkdir -p ./musa_packages
BASE="sh-moss/sw-release/musa/external/${MUSA_SDK_VERSION}/deb"
mc cp "${BASE}/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb" ./musa_packages/
```

#### 2.3 Install Driver
```bash
# Uninstall old driver if exists
if dpkg -s musa &>/dev/null; then
    echo "$SUDO_PASSWORD" | sudo -S dpkg -P musa
    sudo modprobe -rv mtgpu 2>/dev/null || true
fi

# Install new driver
echo "$SUDO_PASSWORD" | sudo -S apt install ./musa_packages/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb

# Reload driver module (unload old, load new)
echo "$SUDO_PASSWORD" | sudo -S sh -c 'modprobe -rv mtgpu 2>/dev/null || true; modprobe mtgpu'
```

Save state: `driver_installed`


#### 2.4 Post-Installation Verification
After driver installation:
```bash
mthreads-gmi
```

Should show GPU information and driver version.  
Save state: `driver_loaded`

### Step 3: Container Runtime Validation and Toolkit Installation

#### 3.1 Validate Container Runtime First

**IMPORTANT**: Always validate container runtime first using actual Docker run. Do NOT install toolkit blindly.

Read validation image from config:
```bash
# Read validation image from sdk_compatibility.yml
VALIDATION_IMAGE=$(yq '.metadata.validation_image' skills/deploy_musa_base_env/config/sdk_compatibility.yml)
VALIDATION_CMD=$(yq '.metadata.validation_command' skills/deploy_musa_base_env/config/sdk_compatibility.yml)

# Default fallback
VALIDATION_IMAGE=${VALIDATION_IMAGE:-"registry.mthreads.com/cloud-mirror/ubuntu:20.04"}
VALIDATION_CMD=${VALIDATION_CMD:-"mthreads-gmi"}
```

Run validation test:
```bash
# Test container runtime with GPU access
if docker run --rm --env MTHREADS_VISIBLE_DEVICES=all "$VALIDATION_IMAGE" $VALIDATION_CMD 2>/dev/null; then
    echo "✓ Container runtime is working correctly"
    echo "Skipping container toolkit installation."
    # Save state and skip to Step 4
    # State: container_toolkit_installed
else
    echo "✗ Container runtime validation failed"
    echo "Proceeding to diagnose and fix..."
fi
```

If validation passes, save state: `container_toolkit_installed` and skip to Step 4.

#### 3.2 Diagnose Failure (if validation failed)

If container runtime validation failed, check why:

```bash
# Check if mt-container-toolkit is installed
if dpkg -s mt-container-toolkit &>/dev/null; then
    TOOLKIT_INSTALLED=true
    echo "mt-container-toolkit is installed"
else
    TOOLKIT_INSTALLED=false
    echo "mt-container-toolkit is NOT installed"
fi

# Check if Docker has MUSA runtime configured
if docker info 2>/dev/null | grep -q "mthreads"; then
    RUNTIME_BOUND=true
    echo "MUSA runtime is bound to Docker"
else
    RUNTIME_BOUND=false
    echo "MUSA runtime is NOT bound to Docker"
fi
```

#### 3.3 Fix Based on Diagnosis

**Case A: Toolkit installed but not bound**
```bash
if [ "$TOOLKIT_INSTALLED" = true ] && [ "$RUNTIME_BOUND" = false ]; then
    echo "Binding MUSA runtime to Docker..."
    (cd /usr/bin/musa && echo "$SUDO_PASSWORD" | sudo -S ./docker setup $PWD)
    
    # Restart Docker if needed
    if ! systemctl is-active --quiet docker; then
        echo "$SUDO_PASSWORD" | sudo -S systemctl restart docker
        (cd /usr/bin/musa && echo "$SUDO_PASSWORD" | sudo -S ./docker setup $PWD)
    fi
    
    # Re-validate
    if docker run --rm --env MTHREADS_VISIBLE_DEVICES=all "$VALIDATION_IMAGE" $VALIDATION_CMD; then
        echo "✓ Binding successful"
        # Save state: container_toolkit_installed
    else
        echo "✗ Binding failed, proceeding to full installation"
    fi
fi
```

**Case B: Toolkit not installed - Full Installation**

If toolkit is not installed or binding failed, proceed with full installation:

##### 3.3.1 Determine Container Toolkit Version
Select the latest version from `skills/deploy_musa_base_env/config/container_toolkit.yml`:

```bash
# Detect OS and CPU
OS_TYPE=$(lsb_release -si 2>/dev/null || echo "Ubuntu")
CPU_ARCH=$(uname -m)

# Parse container_toolkit.yml to find matching entry
# Use yq or jq with yq-to-json conversion
TOOLKIT_VERSION=$(yq '.toolkits | sort_by(.version) | reverse | .[0].version' skills/deploy_musa_base_env/config/container_toolkit.yml)
```

##### 3.3.2 Download Container Toolkit
```bash
# Get URL from config
TOOLKIT_URL=$(yq '.toolkits[] | select(.version == "'${TOOLKIT_VERSION}'") | .url' skills/deploy_musa_base_env/config/container_toolkit.yml)
TOOLKIT_MD5=$(yq '.toolkits[] | select(.version == "'${TOOLKIT_VERSION}'") | .md5' skills/deploy_musa_base_env/config/container_toolkit.yml)

# Download
mkdir -p ./musa_packages
wget -O ./musa_packages/container_toolkit.zip "$TOOLKIT_URL"

# Verify checksum if available
if [ -n "$TOOLKIT_MD5" ] && [ "$TOOLKIT_MD5" != "null" ]; then
    echo "$TOOLKIT_MD5 ./musa_packages/container_toolkit.zip" | md5sum -c || echo "Warning: checksum verification failed"
fi
```

##### 3.3.3 Install Container Toolkit
```bash
# Extract and install
unzip -o ./musa_packages/container_toolkit.zip -d ./musa_packages/
cd ./musa_packages/mt-container-toolkit-*

# Avoid interactive debconf / dialog popups
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

# Handle partial install recovery
if dpkg -s mt-container-toolkit 2>/dev/null | grep -q "reinstreq\|half-installed"; then
    echo "$SUDO_PASSWORD" | sudo -S dpkg --remove --force-remove-reinstreq mt-container-toolkit || true
fi
echo "$SUDO_PASSWORD" | sudo -S DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a dpkg --configure -a

# Install bundled components if present
if ls *sgpu-dkms*.deb >/dev/null 2>&1; then
    echo "$SUDO_PASSWORD" | sudo -S DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a \
      apt install -y ./*sgpu-dkms*.deb
fi

if ls *mtml*.deb >/dev/null 2>&1; then
    echo "$SUDO_PASSWORD" | sudo -S DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a \
      apt install -y ./*mtml*.deb
fi

# Install main toolkit
echo "$SUDO_PASSWORD" | sudo -S DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a \
  apt install -y ./*mt-container-toolkit*.deb

# Bind to Docker
(cd /usr/bin/musa && echo "$SUDO_PASSWORD" | sudo -S ./docker setup $PWD)

# Restart Docker if needed
if ! systemctl is-active --quiet docker; then
    echo "$SUDO_PASSWORD" | sudo -S systemctl restart docker
    (cd /usr/bin/musa && echo "$SUDO_PASSWORD" | sudo -S ./docker setup $PWD)
fi
```

#### 3.4 Final Validation

After installation or binding, validate again:

```bash
# Final validation
if docker run --rm --env MTHREADS_VISIBLE_DEVICES=all "$VALIDATION_IMAGE" $VALIDATION_CMD; then
    echo "✓ Container runtime validation successful"
    # Save state: container_toolkit_installed
else
    echo "✗ Container runtime validation failed after installation"
    echo "Check logs and troubleshoot"
    exit 1
fi
```

Save state: `container_toolkit_installed`

### Step 4: Docker Image Pull


```bash
docker pull "$DOCKER_IMAGE"
```

Save state: `docker_image_pulled`

### Step 5: Container Environment Validation

#### 5.1 Launch Test Container
```bash
CONTAINER_NAME="musa_test_$(date +%s)"

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
```

#### 5.2 Validate MUSA Environment
```bash
# Basic MUSA check
docker exec "$CONTAINER_NAME" musaInfo

# PyTorch MUSA availability plus a real tensor op
docker exec "$CONTAINER_NAME" bash -lc 'python - <<"PY"
import torch
print("PyTorch MUSA available:", torch.musa.is_available())
if torch.musa.is_available():
    tensor = torch.tensor([1.0], device="musa")
    print("MUSA tensor test:", tensor + 1)
PY'
```

If any container validation step fails, follow the shared troubleshooting runbook in `references/container-validation-runbook.md` before changing drivers, reinstalling the full stack, or blaming the host environment.

#### 5.3 Cleanup Test Container
```bash
docker stop "$CONTAINER_NAME"
docker rm "$CONTAINER_NAME"
```

Save state: `container_validated` and `completed`

## Final Summary

Print a comprehensive deployment summary:

```bash
echo "========================================="
echo "MUSA SDK Deployment Complete"
echo "========================================="
echo "SDK Version: $MUSA_SDK_VERSION"
echo "Driver Version: $MT_GPU_DRIVER_VERSION"
echo "GPU Type: $MT_GPU_TYPE ($MT_GPU_ARCH)"
echo "Docker Image: $DOCKER_IMAGE"
echo ""
echo "Verification Commands:"
echo "  Host driver: mthreads-gmi"
echo "  Container GPU: docker run --rm --env MTHREADS_VISIBLE_DEVICES=all registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi"
echo "  MUSA tools: musaInfo, musa_version_query"
echo "  PyTorch MUSA: python -c \"import torch; print(torch.musa.is_available()); print(torch.tensor(1, device='musa') + 1)\""
echo "========================================="
```

## Important Rules

1. **SUDO_PASSWORD scope** - Only use for system operations, never for Docker or download operations
2. **State persistence** - Always save state before operations that might fail or require reboot
3. **Error handling** - Check each command's exit code and provide clear error messages
4. **Cleanup** - Remove temporary files and test containers after validation
5. **Remote execution** - When using remote tools, follow path conventions:
   - Local: `repositories/<project>/`
   - Remote host: `~/workspace/<project>/`
   - Container: `/workspace/<project>/`

## Remote Deployment Support

This skill can be executed remotely using the MUSA deployment tools:

- Use `musa_exec` for host-level commands (driver installation, package management)
- Use `musa_docker` for container operations (image pull, container validation)
- Use `musa_sync` to transfer downloaded packages to remote host

Example remote workflow:
1. Call `musa_set_mode` with remote connection details
2. Collect version information locally
3. Sync skill scripts to remote host
4. Execute deployment steps via MUSA tools
5. Pull verification results back to local machine

## Troubleshooting

### Common Issues

1. **Driver installation fails** - Check kernel headers: `apt install linux-headers-$(uname -r)`
2. **Container toolkit binding fails** - Ensure Docker is running: `systemctl status docker`
3. **Docker image pull fails** - Verify registry credentials and network connectivity
4. **MUSA not available in container** - Check container toolkit installation and Docker restart
5. **Permission denied errors** - Verify sudo password is correct and has required privileges
6. **"mthreads-container-runtime not found in PATH" error** - Create symbolic links:
   ```bash
   sudo ln -sf /usr/bin/musa/mthreads-container-runtime /usr/bin/mthreads-container-runtime
   sudo ln -sf /usr/bin/musa/mthreads-container-runtime /usr/bin/mthreads-container-runtime-experimental
   sudo systemctl restart docker
   ```
   This occurs because the container toolkit runtime binary is installed in `/usr/bin/musa/` but Docker expects it in `$PATH`.
7. **Container validation fails inside a specific image** - Follow `references/container-validation-runbook.md` to distinguish toolkit binding issues, broken image libraries, and `torch_musa` architecture mismatch before reinstalling host components.

### Validation Checklist

- [ ] `mthreads-gmi` shows GPU information on host
- [ ] `docker run --rm ... mthreads-gmi` shows GPU information in container
- [ ] `musaInfo` works in container
- [ ] `torch.musa.is_available()` returns True in container
- [ ] `torch.tensor([1.0], device='musa') + 1` succeeds in container
