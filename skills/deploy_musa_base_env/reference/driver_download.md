# Sudo Password Handling and Driver Package Download

This reference document outlines the procedures for downloading MUSA driver packages.


## Driver Package Download

### MOSS Storage Access
MUSA driver packages are stored in MOSS (MinIO Object Storage Service). Access requires MinIO Client configuration:

**Important: `mc` Command Confusion**
The `mc` command could refer to two different tools:
1. **MinIO Client** (required): Object storage client for accessing MOSS
2. **Midnight Commander**: A graphical file manager that may conflict

**Verify you have the correct MinIO Client:**
```bash
# Check which mc is available
which mc

# Verify it's MinIO Client (not Midnight Commander)
mc --version
# MinIO Client should show: "mc version RELEASE.2025-XX-XXTXX-XX-XXZ"
# Midnight Commander would show different output

# If you have Midnight Commander installed:
# Option 1: Use full path to MinIO Client (e.g., /usr/local/bin/mc)
# Option 2: Install MinIO Client with alias:
#   curl -O https://dl.min.io/client/mc/release/linux-amd64/mc
#   chmod +x mc
#   sudo mv mc /usr/local/bin/minio-client
#   alias mc="/usr/local/bin/minio-client"
```

```bash
# Configure MinIO client alias for MOSS
mc alias set sh-moss https://sh-moss.mthreads.com sw-guest-mt-sw sw-guest123

# Verify connection
mc ls sh-moss/sw-release/musa/external/
```

### Package Path Structure
Driver packages follow this path pattern:
```
sh-moss/sw-release/musa/external/{SDK_VERSION}/deb/musa_{DRIVER_VERSION}-server_amd64.deb
```

Example for SDK 4.3.1 with driver 3.3.1:
```
sh-moss/sw-release/musa/external/4.3.1/deb/musa_3.3.1-server_amd64.deb
```

### Download Procedure

**Note:** Ensure `mc` command refers to MinIO Client, not Midnight Commander. Verify with `mc --version`.

```bash
# Create download directory
mkdir -p ./musa_packages

# Set base path
BASE="sh-moss/sw-release/musa/external/${MUSA_SDK_VERSION}/deb"

# Download driver package
mc cp "${BASE}/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb" ./musa_packages/

# Verify download
if [ -f "./musa_packages/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb" ]; then
    echo "Driver package downloaded successfully"
    ls -lh "./musa_packages/musa_${MT_GPU_DRIVER_VERSION}-server_amd64.deb"
else
    echo "Failed to download driver package"
    exit 1
fi
```

### Alternative Download Methods
If MinIO Client is not available, driver packages can also be downloaded via:

1. **Direct HTTP download** (if URLs are known)
2. **From developer portal**: https://developer.mthreads.com/sdk/download/musa
3. **From documentation links**: Refer to installation guides

### Version Compatibility Checking
Before downloading, verify version compatibility:

```bash
# List available driver versions for SDK
mc ls "sh-moss/sw-release/musa/external/${MUSA_SDK_VERSION}/deb/" | grep musa_

# Expected output example:
# [2024-01-01 12:00:00 CST] 100MB musa_3.3.1-server_amd64.deb
# [2024-01-01 12:00:00 CST] 100MB musa_3.3.0-server_amd64.deb
```

### Handling Download Failures

1. **Network issues**: Check connectivity to `sh-moss.mthreads.com`
2. **Authentication issues**: Verify MinIO credentials
3. **Package not found**: Check SDK and driver version compatibility
4. **Permission denied**: Ensure user has read access to MOSS bucket




