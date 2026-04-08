---
version: 1
name: ensure_mt_container_toolkit
description: Install MT Container Toolkit and bind to Docker for GPU container access.

category: env
kind: atomic
exposure: internal
risk_level: idempotent
execution_mode: remote

owners:
  - env-team

triggers:
  - install container toolkit
  - ensure container toolkit
  - 配置容器工具包
---

# Ensure MT Container Toolkit

Installs MT Container Toolkit and binds MUSA runtime to Docker.

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `TOOLKIT_VERSION` | Target toolkit version | No | latest |

## Workflow

### Step 1: Check Current State

```bash
TOOLKIT_INSTALLED=false
RUNTIME_BOUND=false

if dpkg -s mt-container-toolkit &>/dev/null; then
    TOOLKIT_INSTALLED=true
    TOOLKIT_VERSION=$(dpkg -s mt-container-toolkit | awk -F': ' '/^Version:/{print $2}')
    echo "Toolkit ${TOOLKIT_VERSION} installed"
fi

if docker info 2>/dev/null | grep -q "mthreads"; then
    RUNTIME_BOUND=true
    echo "MUSA runtime bound to Docker"
fi
```

Verification: Current state determined

---

### Step 2: Quick Validation

Skip installation if already working:

```bash
VALIDATION_IMAGE="registry.mthreads.com/cloud-mirror/ubuntu:20.04"

if docker run --rm --env MTHREADS_VISIBLE_DEVICES=all "$VALIDATION_IMAGE" mthreads-gmi 2>/dev/null; then
    echo "Container runtime working. Skipping installation."
    exit 0
fi
```

---

### Step 3: Install or Bind

**Case A: Toolkit installed but not bound**

```bash
if [ "$TOOLKIT_INSTALLED" = true ] && [ "$RUNTIME_BOUND" = false ]; then
    (cd /usr/bin/musa && echo "$SUDO_PASSWORD" | sudo -S ./docker setup $PWD)
    echo "$SUDO_PASSWORD" | sudo -S systemctl restart docker
fi
```

**Case B: Full Installation**

```bash
if [ "$TOOLKIT_INSTALLED" = false ]; then
    # Download toolkit (URL from config)
    TOOLKIT_URL="https://example.com/container_toolkit.zip"
    mkdir -p ./musa_packages
    wget -O ./musa_packages/container_toolkit.zip "$TOOLKIT_URL"
    unzip -o ./musa_packages/container_toolkit.zip -d ./musa_packages/
    cd ./musa_packages/mt-container-toolkit-*

    export DEBIAN_FRONTEND=noninteractive

    # Handle partial install
    if dpkg -s mt-container-toolkit 2>/dev/null | grep -q "reinstreq"; then
        echo "$SUDO_PASSWORD" | sudo -S dpkg --remove --force-remove-reinstreq mt-container-toolkit || true
    fi

    # Install components
    echo "$SUDO_PASSWORD" | sudo -S apt install -y ./*sgpu-dkms*.deb 2>/dev/null || true
    echo "$SUDO_PASSWORD" | sudo -S apt install -y ./*mtml*.deb 2>/dev/null || true
    echo "$SUDO_PASSWORD" | sudo -S apt install -y ./*mt-container-toolkit*.deb

    # Bind to Docker
    (cd /usr/bin/musa && echo "$SUDO_PASSWORD" | sudo -S ./docker setup $PWD)
    echo "$SUDO_PASSWORD" | sudo -S systemctl restart docker
fi
```

Verification: Toolkit installed, Docker has mthreads runtime

---

### Step 4: Validate

```bash
if ! docker run --rm --env MTHREADS_VISIBLE_DEVICES=all \
    registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi; then
    echo "Container validation failed"
    exit 1
fi

echo "MT Container Toolkit ready"
```

## Success Criteria

- Toolkit installed
- Docker has mthreads runtime
- Container can access GPU

## Troubleshooting

1. **"mthreads-container-runtime not found"** - Create symlinks:
   ```bash
   sudo ln -sf /usr/bin/musa/mthreads-container-runtime /usr/bin/mthreads-container-runtime
   sudo systemctl restart docker
   ```
2. **Docker binding fails** - Ensure Docker running: `systemctl status docker`
3. **Container validation fails** - See `references/container-validation-runbook.md`