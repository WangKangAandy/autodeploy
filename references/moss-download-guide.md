# MOSS Download Guide

This document provides complete guidance for downloading MUSA packages from MOSS (MinIO Object Storage Service).

## MinIO Client Setup

### Tool Confusion Warning

The `mc` command could refer to two different tools:
1. **MinIO Client** (required): Object storage client for accessing MOSS
2. **Midnight Commander** (file manager): A graphical file manager that may conflict

### Installation

```bash
# Download MinIO Client
curl -O https://dl.min.io/client/mc/release/linux-amd64/mc

# Make executable and install
chmod +x mc && sudo mv mc /usr/local/bin/
```

### Verification

```bash
# Check which mc is installed
which mc

# Verify it's MinIO Client (not Midnight Commander)
mc --version
# MinIO Client should show: "mc version RELEASE.2025-XX-XXTXX-XX-XXZ"
# Midnight Commander would show different output
```

### Handling Conflicts

If Midnight Commander is installed instead:

```bash
# Option 1: Use full path to MinIO Client
/usr/local/bin/mc --version

# Option 2: Install MinIO Client with a different name
curl -O https://dl.min.io/client/mc/release/linux-amd64/mc
chmod +x mc
sudo mv mc /usr/local/bin/minio-client
alias mc="/usr/local/bin/minio-client"
```

## MOSS Configuration

### Alias Setup

```bash
mc alias set sh-moss https://sh-moss.mthreads.com sw-guest-mt-sw sw-guest123
```

### Connection Verification

```bash
# List available directories to verify connection
mc ls sh-moss/sw-release/musa/external/
```

## Driver Package Download

### Path Structure

Driver packages follow this path pattern:

```
sh-moss/sw-release/musa/external/{SDK_VERSION}/deb/musa_{DRIVER_VERSION}-server_amd64.deb
```

### Example

For SDK 4.3.1 with driver 3.3.1-server:

```
sh-moss/sw-release/musa/external/4.3.1/deb/musa_3.3.1-server_amd64.deb
```

### Download Procedure

```bash
# Create download directory
mkdir -p ./musa_packages

# Set base path
BASE="sh-moss/sw-release/musa/external/${MUSA_SDK_VERSION}/deb"

# Download driver package
mc cp "${BASE}/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb" ./musa_packages/

# Verify download
ls -lh "./musa_packages/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb"
```

### Alternative Naming Variants

Some environments use different naming conventions. Check both patterns:

```bash
# Variant 1: with "-server" suffix
musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb

# Variant 2: without "-server" suffix
musa_${MT_GPU_DRIVER_VERSION}_amd64.deb
```

### Searching for Packages

If the expected path does not contain the target driver, search the broader release tree:

```bash
# Find driver package anywhere in the external tree
REMOTE_PACKAGE=$(mc find "sh-moss/sw-release/musa/external" --name "musa_${MT_GPU_DRIVER_VERSION}*amd64.deb" | head -n 1)

if [ -n "$REMOTE_PACKAGE" ]; then
    mc cp "$REMOTE_PACKAGE" ./musa_packages/
    PACKAGE_PATH="./musa_packages/$(basename "$REMOTE_PACKAGE")"
else
    echo "Target driver package not found on MOSS"
fi
```

## Version Compatibility Checking

Before downloading, verify available versions:

```bash
# List available driver versions for a specific SDK
mc ls "sh-moss/sw-release/musa/external/${MUSA_SDK_VERSION}/deb/" | grep musa_

# Expected output example:
# [2024-01-01 12:00:00 CST] 100MB musa_3.3.1-server_amd64.deb
# [2024-01-01 12:00:00 CST] 100MB musa_3.3.0-server_amd64.deb
```

## Alternative Download Methods

If MinIO Client is not available:

1. **Direct HTTP download** (if URLs are known)
2. **Developer portal**: https://developer.mthreads.com/sdk/download/musa
3. **Documentation links**: Refer to installation guides

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Network issues | Check connectivity to `sh-moss.mthreads.com` |
| Authentication issues | Verify credentials: `sw-guest-mt-sw` / `sw-guest123` |
| Package not found | Use `mc find` to search broader tree |
| Permission denied | Ensure user has read access to MOSS bucket |
| Wrong `mc` command | Verify `mc --version` shows MinIO Client |