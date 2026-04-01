---
version: 1
name: prepare_musa_package
description: Download and verify MUSA packages (driver, container_toolkit).

category: assets
kind: atomic
exposure: user
risk_level: safe
execution_mode: remote

owners:
  - assets-team

triggers:
  - download driver
  - download container toolkit
  - prepare MUSA package
  - 准备驱动包
  - 下载容器工具包
---

# Prepare MUSA Package

Downloads MUSA packages, checking local existence first.

**Package Types:**
- `driver` — MUSA GPU driver (musa_*.deb)
- `container_toolkit` — MT Container Toolkit (mt-container-toolkit-*.zip)

## MOSS Credentials

Priority: `MOSS_ACCESS_KEY`/`MOSS_SECRET_KEY` → `MT_MOSS_*` → guest defaults.

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PACKAGE_TYPE` | Package type: `driver` \| `container_toolkit` | Yes | - |
| `VERSION` | Version number (e.g., `3.3.5-server` for driver, `2.0.0` for container_toolkit) | Yes | - |
| `SOURCE` | Download source: `moss` \| `local` \| `mirror` | No | `moss` |
| `MUSA_SDK_VERSION` | SDK version for MOSS path construction | No* | - |

*Required if PACKAGE_TYPE is `driver` and SOURCE is `moss`.

**Note on SOURCE**:
- `driver`: Uses SOURCE parameter (moss/local/mirror)
- `container_toolkit`: Ignores SOURCE, always downloads from configured HTTP URL

## Workflow

### Step 1: Check Local

```bash
mkdir -p ./musa_packages

case "$PACKAGE_TYPE" in
    driver)
        for name in "musa_${VERSION}_amd64.deb" "musa_${VERSION}-server_amd64.deb"; do
            if [ -f "./musa_packages/$name" ]; then
                PACKAGE_PATH="./musa_packages/$name"
                echo "Found: $PACKAGE_PATH"
                break
            fi
        done
        ;;
    container_toolkit)
        for name in "mt-container-toolkit-${VERSION}.zip" "container_toolkit_${VERSION}.zip"; do
            if [ -f "./musa_packages/$name" ]; then
                PACKAGE_PATH="./musa_packages/$name"
                echo "Found: $PACKAGE_PATH"
                break
            fi
        done
        ;;
esac
```

---

### Step 2: Download

Skip if found locally.

```bash
if [ -z "$PACKAGE_PATH" ]; then
    case "$PACKAGE_TYPE" in
        driver)
            MOSS_AK="${MOSS_ACCESS_KEY:-${MT_MOSS_ACCESS_KEY:-sw-guest-mt-sw}}"
            MOSS_SK="${MOSS_SECRET_KEY:-${MT_MOSS_SECRET_KEY:-sw-guest123}}"

            mc alias set sh-moss https://sh-moss.mthreads.com "$MOSS_AK" "$MOSS_SK"

            BASE="sh-moss/sw-release/musa/external/${MUSA_SDK_VERSION}/deb"

            if mc ls "${BASE}/musa_${VERSION}-server_amd64.deb" >/dev/null 2>&1; then
                mc cp "${BASE}/musa_${VERSION}-server_amd64.deb" ./musa_packages/
                PACKAGE_PATH="./musa_packages/musa_${VERSION}-server_amd64.deb"
            else
                REMOTE_PACKAGE=$(mc find "sh-moss/sw-release/musa/external" \
                    --name "musa_${VERSION}*amd64.deb" | head -n 1)
                [ -n "$REMOTE_PACKAGE" ] && mc cp "$REMOTE_PACKAGE" ./musa_packages/
            fi
            ;;

        container_toolkit)
            TOOLKIT_CONFIG="skills/config/env/container_toolkit.yml"
            TOOLKIT_URL=$(yq '.[] | select(.version == "'${VERSION}'") | .url' "$TOOLKIT_CONFIG" | head -n 1)
            wget -O ./musa_packages/mt-container-toolkit-${VERSION}.zip "$TOOLKIT_URL"
            PACKAGE_PATH="./musa_packages/mt-container-toolkit-${VERSION}.zip"
            ;;
    esac
fi

[ -z "$PACKAGE_PATH" ] && exit 1
```

---

### Step 3: Verify

```bash
[ ! -s "$PACKAGE_PATH" ] && exit 1

CHECKSUM=$(sha256sum "$PACKAGE_PATH" | awk '{print $1}')
echo "Package ready: $PACKAGE_PATH (SHA256: $CHECKSUM)"
```

## Success Criteria

- Package exists with valid checksum

## Outputs

| Field | Description |
|-------|-------------|
| `resolvedPath` | Path to package file |
| `integrity` | SHA256 checksum |

## Troubleshooting

1. **Package not found on MOSS** — Search: `mc find sh-moss/sw-release/musa/external --name "*${VERSION}*"`
2. **mc not found** — Install MinIO Client: `references/moss-download-guide.md`
3. **Auth failed** — Check `MOSS_ACCESS_KEY`/`MOSS_SECRET_KEY`