# Claude Remote MT-GPU Tools - Usage Examples

This document provides comprehensive examples for using the Claude Remote MT-GPU tools.

## Table of Contents

- [Remote Exec Examples](#remote-exec-examples)
- [Remote Docker Examples](#remote-docker-examples)
- [Remote Sync Examples](#remote-sync-examples)
- [MUSA Deployment Examples](#musa-deployment-examples)
- [Troubleshooting Examples](#troubleshooting-examples)

## Remote Exec Examples

### Basic Commands

```bash
# Check hostname
remote-exec "hostname"

# Check system info
remote-exec "uname -a"

# Check current directory
remote-exec "pwd"

# List files
remote-exec "ls -la"
```

### System Management

```bash
# Check disk usage
remote-exec "df -h"

# Check memory usage
remote-exec "free -h"

# Check CPU usage
remote-exec "top -bn1 | head -20"
```

### Package Management

```bash
# Update package list
remote-exec "apt update" --sudo

# Install a package
remote-exec "apt install -y curl" --sudo

# Check installed packages
remote-exec "dpkg -l | grep musa"

# Remove a package
remote-exec "apt remove -y package-name" --sudo
```

### MUSA Driver Management

```bash
# Check GPU driver status
remote-exec "mthreads-gmi"

# Check loaded modules
remote-exec "lsmod | grep mtgpu"

# Load MTGPU module
remote-exec "modprobe mtgpu" --sudo

# Reload MTGPU module
remote-exec "modprobe -rv mtgpu" --sudo
remote-exec "modprobe mtgpu" --sudo
```

### Docker Management

```bash
# Check Docker status
remote-exec "systemctl status docker"

# List Docker containers
remote-exec "docker ps -a"

# List Docker images
remote-exec "docker images"

# Restart Docker
remote-exec "systemctl restart docker" --sudo
```

### Working Directory Examples

```bash
# Run command in specific directory
remote-exec "pwd" --workdir "/tmp"

# Run command in home directory
remote-exec "pwd" --workdir "~"

# Run command in workspace
remote-exec "pwd" --workdir "~/workspace/project"

# Run command in absolute path
remote-exec "pwd" --workdir "/opt/musa"
```

### Timeout Examples

```bash
# Short timeout (30 seconds)
remote-exec "long_running_command" --timeout 30

# Long timeout (10 minutes)
remote-exec "backup_command" --timeout 600

# Default timeout (120 seconds)
remote-exec "normal_command"
```

## Remote Docker Examples

### Docker Exec (Existing Container)

```bash
# Check Python version in container
remote-docker "python --version" --name torch_musa_test

# Run a command in container
remote-docker "ls -la /workspace" --name torch_musa_test

# Install package in container
remote-docker "pip install numpy" --name torch_musa_test

# Check MUSA in container
remote-docker "musaInfo" --name torch_musa_test
```

### Docker Run (New Container)

```bash
# Run simple command in new container
remote-docker "echo 'hello world'" --image "ubuntu:20.04"

# Run Python in new container
remote-docker "python -c 'print(\"Hello from Docker!\")'" --image "python:3.10"

# Run with custom workdir
remote-docker "pwd" --image "ubuntu:20.04" --workdir "/tmp"
```

### MUSA Container Operations

```bash
# Check MUSA availability
remote-docker "musaInfo" --name torch_musa_test

# Check PyTorch MUSA
remote-docker "python -c 'import torch; print(torch.musa.is_available())'" --name torch_musa_test

# Test tensor operation on GPU
remote-docker "python -c 'import torch; print(torch.tensor([1.0], device=\"musa\") + 1)'" --name torch_musa_test

# Check GPU in container
remote-docker "nvidia-smi" --name torch_musa_test
```

### Advanced Docker Options

```bash
# Run with custom shared memory
remote-docker "python script.py" --image "ubuntu:20.04" --shm_size "32G"

# Run with specific GPU devices
remote-docker "python script.py" --image "ubuntu:20.04" --visible_devices "0,1"

# Run with custom environment variables
remote-docker "python script.py" --image "ubuntu:20.04" --env_vars '["CUDA_VISIBLE_DEVICES=0", "FORCE_MUSA=1"]'

# Run with volume mounts
remote-docker "python /data/train.py" --image "python:3.10" --volumes '["/data:/data", "/models:/models"]'

# Run with sudo
remote-docker "docker ps" --name torch_musa_test --sudo
```

### Complete Docker Example

```bash
remote-docker \
  "python /workspace/train.py --epochs 10 --batch_size 32" \
  --image "registry.mthreads.com/public/musa-train:rc4.3.1-kuae2.1-20251014-juleng" \
  --workdir "/workspace/project" \
  --shm_size "80G" \
  --visible_devices "all" \
  --volumes '["/data:/data", "/models:/models", "/workspace:/workspace"]' \
  --env_vars '["CUDA_VISIBLE_DEVICES=0", "FORCE_MUSA=1", "DEBUG=0"]' \
  --timeout 3600
```

## Remote Sync Examples

### File Operations

```bash
# Push single file
remote-sync --local_path "config.yaml" --remote_path "~/workspace/config.yaml" --direction push

# Pull single file
remote-sync --local_path "results.json" --remote_path "~/workspace/results.json" --direction pull

# Push directory
remote-sync --local_path "./project" --remote_path "~/workspace/project" --direction push

# Pull directory
remote-sync --local_path "./logs" --remote_path "~/workspace/logs" --direction pull
```

### Advanced Sync Options

```bash
# Push with exclusions
remote-sync \
  --local_path "./project" \
  --remote_path "~/workspace/project" \
  --direction push \
  --exclude '["*.tmp", ".git", "__pycache__", "*.pyc"]'

# Pull with deletion (dangerous!)
remote-sync \
  --local_path "./backup" \
  --remote_path "~/workspace/results" \
  --direction pull \
  --delete

# Push with multiple exclusions
remote-sync \
  --local_path "./project" \
  --remote_path "~/workspace/project" \
  --direction push \
  --exclude '["node_modules", ".git", "*.log", "tmp/*"]'
```

### Workspace Management

```bash
# Push entire project to remote workspace
remote-sync \
  --local_path "./" \
  --remote_path "~/workspace/myproject" \
  --direction push

# Pull results from remote workspace
remote-sync \
  --local_path "./results" \
  --remote_path "~/workspace/myproject/results" \
  --direction pull

# Sync specific subdirectory
remote-sync \
  --local_path "./src/models" \
  --remote_path "~/workspace/myproject/src/models" \
  --direction push
```

## MUSA Deployment Examples

### Complete Deployment Workflow

```bash
# 1. Check system
remote-exec "uname -a"
remote-exec "free -h"
remote-exec "df -h"

# 2. Install dependencies
remote-exec "apt update" --sudo
remote-exec "apt install -y wget curl jq dkms libgbm1 libglapi-mesa linux-headers-$(uname -r)" --sudo

# 3. Download and install driver
remote-exec "wget -O /tmp/musa.deb https://download-url/musa_3.3.1-server_amd64.deb"
remote-exec "dpkg -i /tmp/musa.deb" --sudo
remote-exec "modprobe mtgpu" --sudo

# 4. Verify driver
remote-exec "mthreads-gmi"

# 5. Install container toolkit
remote-exec "wget -O /tmp/toolkit.zip https://download-url/container_toolkit.zip"
remote-exec "unzip /tmp/toolkit.zip -d /tmp/"
remote-exec "dpkg -i /tmp/mt-container-toolkit-*.deb" --sudo
remote-exec "(cd /usr/bin/musa && ./docker setup \$PWD)" --sudo

# 6. Verify container toolkit
remote-exec "docker run --rm --env MTHREADS_VISIBLE_DEVICES=all registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi"

# 7. Pull MUSA image
remote-docker "docker pull registry.mthreads.com/public/musa-train:rc4.3.1-kuae2.1-20251014-juleng" --image "registry.mthreads.com/public/musa-train:rc4.3.1-kuae2.1-20251014-juleng"

# 8. Start test container
remote-exec "docker run -itd --name torch_musa_test --env MTHREADS_VISIBLE_DEVICES=all --shm-size=80g --network=host --privileged --pid=host -v /data:/data registry.mthreads.com/public/musa-train:rc4.3.1-kuae2.1-20251014-juleng bash"

# 9. Validate MUSA
remote-docker "musaInfo" --name torch_musa_test
remote-docker "python -c 'import torch; print(torch.musa.is_available())'" --name torch_musa_test
remote-docker "python -c 'import torch; print(torch.tensor([1.0], device=\"musa\") + 1)'" --name torch_musa_test

# 10. Cleanup test container
remote-exec "docker stop torch_musa_test"
remote-exec "docker rm torch_musa_test"
```

### Driver Update Workflow

```bash
# 1. Check current driver
remote-exec "dpkg -s musa | grep Version"
remote-exec "mthreads-gmi"

# 2. Download new driver
remote-exec "wget -O /tmp/musa_new.deb https://download-url/musa_3.3.2-server_amd64.deb"

# 3. Remove old driver
remote-exec "dpkg -P musa" --sudo
remote-exec "modprobe -rv mtgpu" --sudo

# 4. Install new driver
remote-exec "dpkg -i /tmp/musa_new.deb" --sudo
remote-exec "modprobe mtgpu" --sudo

# 5. Verify new driver
remote-exec "mthreads-gmi"
```

### Development Workflow

```bash
# 1. Push code to remote
remote-sync --local_path "./myproject" --remote_path "~/workspace/myproject" --direction push

# 2. Install dependencies in container
remote-docker "pip install -r requirements.txt" --name torch_musa_test

# 3. Run tests
remote-docker "pytest tests/" --name torch_musa_test

# 4. Run training
remote-docker "python train.py --config config.yaml" --name torch_musa_test

# 5. Pull results back
remote-sync --local_path "./results" --remote_path "~/workspace/myproject/results" --direction pull

# 6. Pull logs
remote-sync --local_path "./logs" --remote_path "~/workspace/myproject/logs" --direction pull
```

## Troubleshooting Examples

### Connection Issues

```bash
# Test basic connectivity
remote-exec "echo 'connection works'"

# Check if SSH is accessible
remote-exec "whoami"

# Check system load
remote-exec "uptime"
```

### Permission Issues

```bash
# Test sudo without password prompt
remote-exec "whoami" --sudo

# Check Docker permissions
remote-exec "docker ps" --sudo

# Check file permissions
remote-exec "ls -la /workspace"
```

### Docker Issues

```bash
# Check Docker daemon
remote-exec "systemctl status docker"

# Check Docker version
remote-exec "docker version"

# Check container status
remote-exec "docker ps -a"

# Check container logs
remote-exec "docker logs torch_musa_test"

# Check Docker runtime
remote-exec "docker info | grep -i runtime"
```

### MUSA Issues

```bash
# Check driver status
remote-exec "mthreads-gmi"

# Check loaded modules
remote-exec "lsmod | grep mtgpu"

# Check MUSA in container
remote-docker "musaInfo" --name torch_musa_test

# Check PyTorch MUSA
remote-docker "python -c 'import torch; print(torch.musa.is_available()); print(torch.__version__)'" --name torch_musa_test

# Check GPU visibility
remote-docker "python -c 'import torch; print(torch.musa.device_count())'" --name torch_musa_test
```

### File Sync Issues

```bash
# Test basic file sync
echo "test" > test.txt
remote-sync --local_path "test.txt" --remote_path "~/test.txt" --direction push

# Verify file on remote
remote-exec "cat ~/test.txt"

# Test directory sync
mkdir -p test_dir
echo "content" > test_dir/file.txt
remote-sync --local_path "test_dir" --remote_path "~/test_dir" --direction push

# Verify directory on remote
remote-exec "ls -la ~/test_dir"
```

## Best Practices

1. **Always test basic connectivity first**:
   ```bash
   remote-exec "hostname"
   ```

2. **Use appropriate timeouts** for long-running commands:
   ```bash
   remote-exec "long_command" --timeout 600
   ```

3. **Check container status before operations**:
   ```bash
   remote-exec "docker ps"
   ```

4. **Use exclusions for large projects**:
   ```bash
   remote-sync --local_path "./project" --remote_path "~/workspace/project" --exclude '["node_modules", ".git"]' --direction push
   ```

5. **Validate after each major step**:
   ```bash
   remote-exec "mthreads-gmi"
   remote-docker "musaInfo" --name torch_musa_test
   ```

6. **Use workdir for organized commands**:
   ```bash
   remote-exec "make build" --workdir "~/workspace/project"
   ```

7. **Pull results regularly**:
   ```bash
   remote-sync --local_path "./results" --remote_path "~/workspace/project/results" --direction pull
   ```

## Additional Resources

- [Main Documentation](README.md)
- [Configuration Guide](config/README_CONFIG.md)
- [Migration Guide](MIGRATION.md)
- [Original OpenCode Skills](../skills/)