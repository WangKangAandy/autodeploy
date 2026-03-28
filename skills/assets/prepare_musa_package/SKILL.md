---
version: 1
name: prepare_musa_package
description: |
  Discover, download, and verify MUSA packages (driver, toolkit, SDK).
  Checks local existence before downloading from MOSS or mirror.

category: assets
kind: atomic
exposure: user
risk_level: safe
execution_mode: remote

owners:
  - assets-team

triggers:
  - download driver
  - prepare MUSA package
  - get MUSA toolkit
  - 准备驱动包
  - 下载 MUSA 包

# Keep scope concise
scope:
  includes:
    - Local package discovery
    - MOSS download
    - Mirror fallback
    - Integrity verification
  excludes:
    - Package installation (use ensure_* skills)
    - System configuration
---

# Prepare MUSA Package

This atomic skill discovers, downloads, and verifies MUSA software packages. It prioritizes local existence before downloading.

## Invocation

- **Exposure**: user
- **Top-level intent**: `prepare_musa_package`
- **Callable from orchestration**: Yes

### Invocation Example

```
musa_dispatch(intent="prepare_musa_package", context={
  "PACKAGE_TYPE": "driver",
  "VERSION": "3.3.5-server",
  "MUSA_SDK_VERSION": "4.3.5"
})
```

## When To Use This Skill

- Before driver installation (prepare driver package)
- Before toolkit installation (prepare toolkit package)
- When you need MUSA packages but don't want to install yet
- As part of `ensure_musa_driver` or `ensure_mt_container_toolkit`

## When Not To Use This Skill

- When you want to install the package (use `ensure_*` skills directly)
- For application-level dependencies (use other prepare skills)

## Source Of Truth

- MOSS configuration: `references/moss-download-guide.md`
- SDK compatibility: `skills/config/env/sdk_compatibility.yml`
- Container toolkit: `skills/config/env/container_toolkit.yml`

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
| `PACKAGE_TYPE` | Package type: `driver` \| `toolkit` \| `sdk` | Yes | - |
| `VERSION` | Version number (e.g., `3.3.5-server` for driver) | Yes | - |
| `SOURCE` | Download source: `moss` \| `local` \| `mirror` | No | `moss` |
| `MUSA_SDK_VERSION` | SDK version for path construction | No* | - |

*Required if PACKAGE_TYPE is `driver` and SOURCE is `moss`.

## Privileges Required

- **Sudo**: No
- **Remote access**: Yes
- **Docker access**: No
- **Network access**: Yes

## Execution Mode

Remote execution on MT-GPU machine via SSH.

| Mode | Behavior |
|------|----------|
| `local` | Execute directly on host |
| `remote` | Execute via SSH on remote host |
| `container` | Execute inside Docker container |
| `mixed` | Combination of above |

## Idempotency

- **Idempotent**: Yes
- **Re-run behavior**: Uses existing package if already downloaded

## Workflow

### Step 1: Check Local Existence

**Action**:
```bash
mkdir -p ./musa_packages

# Determine package filename based on type
case "$PACKAGE_TYPE" in
    driver)
        # Try common naming variants
        for name in "musa_${VERSION}_amd64.deb" "musa_${VERSION}-server_amd64.deb"; do
            if [ -f "./musa_packages/$name" ]; then
                PACKAGE_PATH="./musa_packages/$name"
                echo "Found existing package: $PACKAGE_PATH"
                break
            fi
        done
        ;;
    toolkit)
        for name in "mt-container-toolkit-${VERSION}.zip" "container_toolkit_${VERSION}.zip"; do
            if [ -f "./musa_packages/$name" ]; then
                PACKAGE_PATH="./musa_packages/$name"
                echo "Found existing package: $PACKAGE_PATH"
                break
            fi
        done
        ;;
    sdk)
        if [ -f "./musa_packages/musa-sdk_${VERSION}_amd64.deb" ]; then
            PACKAGE_PATH="./musa_packages/musa-sdk_${VERSION}_amd64.deb"
        fi
        ;;
esac

if [ -n "$PACKAGE_PATH" ]; then
    FOUND_LOCAL=true
    echo "Package already exists locally"
    # Skip to validation
fi
```

**Verification**:
- Determine if package exists locally

---

### Step 2: Download from Source

**Action**:
If package not found locally:

```bash
if [ -z "$PACKAGE_PATH" ]; then
    case "$SOURCE" in
        moss)
            # Get MOSS credentials from environment
            MOSS_AK="${MOSS_ACCESS_KEY:-${MT_MOSS_ACCESS_KEY:-sw-guest-mt-sw}}"
            MOSS_SK="${MOSS_SECRET_KEY:-${MT_MOSS_SECRET_KEY:-sw-guest123}}"

            # Setup MinIO client
            mc alias set sh-moss https://sh-moss.mthreads.com "$MOSS_AK" "$MOSS_SK"

            case "$PACKAGE_TYPE" in
                driver)
                    # Try SDK-specific path first
                    BASE="sh-moss/sw-release/musa/external/${MUSA_SDK_VERSION}/deb"

                    if mc ls "${BASE}/musa_${VERSION}-server_amd64.deb" >/dev/null 2>&1; then
                        mc cp "${BASE}/musa_${VERSION}-server_amd64.deb" ./musa_packages/
                        PACKAGE_PATH="./musa_packages/musa_${VERSION}-server_amd64.deb"
                    elif mc ls "${BASE}/musa_${VERSION}_amd64.deb" >/dev/null 2>&1; then
                        mc cp "${BASE}/musa_${VERSION}_amd64.deb" ./musa_packages/
                        PACKAGE_PATH="./musa_packages/musa_${VERSION}_amd64.deb"
                    else
                        # Search broader path
                        REMOTE_PACKAGE=$(mc find "sh-moss/sw-release/musa/external" \
                            --name "musa_${VERSION}*amd64.deb" | head -n 1)
                        if [ -n "$REMOTE_PACKAGE" ]; then
                            mc cp "$REMOTE_PACKAGE" ./musa_packages/
                            PACKAGE_PATH="./musa_packages/$(basename "$REMOTE_PACKAGE")"
                        fi
                    fi
                    ;;

                toolkit)
                    # Download toolkit from configured URL or MOSS
                    TOOLKIT_CONFIG="${PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || echo '.')}/skills/config/env/container_toolkit.yml"
                    TOOLKIT_URL=$(yq '.toolkits[] | select(.version == "'${VERSION}'") | .url' "$TOOLKIT_CONFIG")
                    if [ -n "$TOOLKIT_URL" ]; then
                        wget -O ./musa_packages/container_toolkit.zip "$TOOLKIT_URL"
                        PACKAGE_PATH="./musa_packages/container_toolkit.zip"
                    fi
                    ;;
            esac
            ;;

        mirror)
            echo "Mirror download not yet implemented"
            ;;

        local)
            echo "No local package specified"
            ;;
    esac
fi

if [ -z "$PACKAGE_PATH" ]; then
    echo "Failed to prepare package: ${PACKAGE_TYPE} ${VERSION}"
    echo '{"status": "failed", "error": "Package not found or download failed"}'
    exit 1
fi
```

**Verification**:
- Package downloaded

---

### Step 3: Verify Integrity

**Action**:
```bash
# Check file exists and has content
if [ ! -f "$PACKAGE_PATH" ] || [ ! -s "$PACKAGE_PATH" ]; then
    echo "Package file is missing or empty: $PACKAGE_PATH"
    echo '{"status": "failed", "error": "Package file missing or empty"}'
    exit 1
fi

# Calculate checksum
CHECKSUM=$(sha256sum "$PACKAGE_PATH" | awk '{print $1}')
SIZE=$(stat -c%s "$PACKAGE_PATH")

echo "Package ready: $PACKAGE_PATH"
echo "  Size: $(echo "scale=2; $SIZE / 1024 / 1024" | bc) MB"
echo "  SHA256: $CHECKSUM"
```

**Verification**:
- File exists and has valid checksum

---

### Step 4: Output Result

**Action**:
```bash
# Determine source
if [ -n "$FOUND_LOCAL" ]; then
    RESULT_SOURCE="existing"
else
    RESULT_SOURCE="${SOURCE:-moss}"
fi
```

## Success Criteria

- Package exists at resolved path
- Package has valid checksum

### Example Checks

- File exists: test -f $PACKAGE_PATH
- File has content: test -s $PACKAGE_PATH

## Outputs

### Output Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | `found` \| `downloaded` \| `missing` \| `failed` |
| `resolvedPath` | string | Yes | Path to package file |
| `source` | string | No | `existing` \| `moss` \| `mirror` |
| `integrity` | string | No | SHA256 checksum |
| `size` | integer | No | File size in bytes |

### Output Example

```json
{
  "status": "found",
  "resolvedPath": "./musa_packages/musa_3.3.5-server_amd64.deb",
  "source": "existing",
  "integrity": "sha256:abc123...",
  "size": 12345678
}
```

### Failure Example

```json
{
  "status": "failed",
  "error": "Package not found or download failed"
}
```

## Side Effects

- **Modifies**: None
- **Creates**: `./musa_packages/` directory, package file within it
- **Removes/Replaces**: None
- **Requires reboot**: No

## Important Rules

1. **Local first**: Always check local existence before downloading
2. **Multiple naming variants**: Handle different package naming conventions
3. **Graceful fallback**: Search broader paths if not found in expected location
4. **Integrity check**: Verify file exists and calculate checksum

## Troubleshooting

### Common Issues

1. **Package not found on MOSS**
   - Check version string format
   - Search broader path: `mc find sh-moss/sw-release/musa/external --name "*${VERSION}*"`
   - Check MOSS connectivity

2. **mc command not found**
   - Install MinIO Client: see `references/moss-download-guide.md`

3. **Permission denied**
   - Check write permissions in `./musa_packages/`

4. **MOSS authentication failed**
   - Check credentials: `MOSS_ACCESS_KEY` and `MOSS_SECRET_KEY`
   - Test with: `mc alias set sh-moss https://sh-moss.mthreads.com $AK $SK && mc ls sh-moss`