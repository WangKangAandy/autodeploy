---

version: 1  
name: prepare_musa_package  
description: Download and verify MUSA packages (driver, container_toolkit, etc).

category: assets
kind: atomic
exposure: user
risk_level: safe
execution_mode: remote

owners:

- assets-team

## triggers:

- download driver
- download container toolkit
- prepare MUSA package

# Prepare MUSA Package

Downloads MUSA packages, checking local existence first.

**Package Types:**

- `driver` — MUSA GPU driver (musa_*.deb)
- `container_toolkit` — MT Container Toolkit (mt-container-toolkit-*.zip)

## MOSS Credentials

Priority: `MOSS_ACCESS_KEY`/`MOSS_SECRET_KEY` → `MT_MOSS_`* → guest defaults.

## Inputs


| Variable           | Description                                                    | Required | Note                                                                    |
| ------------------ | -------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| `PACKAGE_TYPE`     | `driver` or `container_toolkit`                                | Yes      | -                                                                       |
| `VERSION`          | e.g. `3.3.5` (driver deb), `2.0.0` (toolkit zip)               | Yes      | -                                                                       |
| `SOURCE`           | `driver` only: `moss` or `local`. `container_toolkit`: ignored | No       | Default `moss` for driver; `local` = reuse file under `./musa_packages` |
| `MUSA_SDK_VERSION` | SDK segment in MOSS path when `driver` + `moss`                | No*      | Required when `PACKAGE_TYPE` is `driver` and `SOURCE` is `moss`         |


**Note on SOURCE:**

- `driver`: honors `SOURCE` (`moss` / `local`).
- `container_toolkit` (mt-container-toolkit zip): URL from `skills/config/env/container_toolkit.yml` (`yq` in Step 2); transfer in Step 3.

## Workflow

If you only need the download method (URL or example command), read **Step 2** only.

### Step 1: Check local copy

**Materialize.** If a matching file already exists under `./musa_packages`, set `PACKAGE_PATH` and **skip Steps 2–3**; still run **Step 4** to verify.

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

### Step 2: Resolve source

**Always the place that “gets the URL / MOSS object”.** Link-only flows stop after this block (use the echoed `TOOLKIT_URL` or `RESOLVED_MC_SOURCE` / example `mc cp` line).

```bash
unset RESOLVED_MC_SOURCE TOOLKIT_URL

case "$PACKAGE_TYPE" in
    driver)
        MOSS_AK="${MOSS_ACCESS_KEY:-${MT_MOSS_ACCESS_KEY:-sw-guest-mt-sw}}"
        MOSS_SK="${MOSS_SECRET_KEY:-${MT_MOSS_SECRET_KEY:-sw-guest123}}"

        mc alias set sh-moss https://sh-moss.mthreads.com "$MOSS_AK" "$MOSS_SK"

        BASE="sh-moss/sw-release/musa/external/${MUSA_SDK_VERSION}/deb"

        if mc ls "${BASE}/musa_${VERSION}-server_amd64.deb" >/dev/null 2>&1; then
            RESOLVED_MC_SOURCE="${BASE}/musa_${VERSION}-server_amd64.deb"
        else
            RESOLVED_MC_SOURCE=$(mc find "sh-moss/sw-release/musa/external" \
                --name "musa_${VERSION}*amd64.deb" | head -n 1)
        fi

        echo "RESOLVED_MC_SOURCE=${RESOLVED_MC_SOURCE}"
        echo "Example fetch: mc cp \"${RESOLVED_MC_SOURCE}\" ./musa_packages/"
        ;;

    container_toolkit)
        TOOLKIT_CONFIG="skills/config/env/container_toolkit.yml"
        TOOLKIT_URL=$(yq '.[] | select(.version == "'${VERSION}'") | .url' "$TOOLKIT_CONFIG" | head -n 1)
        echo "TOOLKIT_URL=${TOOLKIT_URL}"
        echo "Example fetch: wget -O ./musa_packages/mt-container-toolkit-${VERSION}.zip \"${TOOLKIT_URL}\""
        ;;
esac
```

---

### Step 3: Download (transfer)

**Materialize only.** Run only if `PACKAGE_PATH` is still empty after Step 1. Uses variables from **Step 2**.

```bash
if [ -z "$PACKAGE_PATH" ]; then
    case "$PACKAGE_TYPE" in
        driver)
            [ -n "$RESOLVED_MC_SOURCE" ] || exit 1
            mc cp "$RESOLVED_MC_SOURCE" ./musa_packages/
            PACKAGE_PATH="./musa_packages/$(basename "${RESOLVED_MC_SOURCE}")"
            ;;

        container_toolkit)
            [ -n "$TOOLKIT_URL" ] || exit 1
            wget -O "./musa_packages/mt-container-toolkit-${VERSION}.zip" "$TOOLKIT_URL"
            PACKAGE_PATH="./musa_packages/mt-container-toolkit-${VERSION}.zip"
            ;;
    esac
fi

[ -z "$PACKAGE_PATH" ] && exit 1
```

---

### Step 4: Verify

**Materialize only.**

```bash
[ ! -s "$PACKAGE_PATH" ] && exit 1

CHECKSUM=$(sha256sum "$PACKAGE_PATH" | awk '{print $1}')
echo "Package ready: $PACKAGE_PATH (SHA256: $CHECKSUM)"
```

## Success Criteria

- **Resolve-only:** Step 2 produced a usable `TOOLKIT_URL` or `RESOLVED_MC_SOURCE` (and optional example command).
- **Materialize:** `PACKAGE_PATH` on disk and Step 4 SHA256 OK.

## Outputs


| Field          | When                                                      |
| -------------- | --------------------------------------------------------- |
| `resolvedPath` | After **Materialize**: local path (Steps 1 or 3).         |
| `integrity`    | After Step 4 when materialized; omitted for resolve-only. |


Integrations that cannot attach the file should return Step 2 outputs (`TOOLKIT_URL` / `RESOLVED_MC_SOURCE` and example lines), plus optional YAML `md5` for toolkit.

## Troubleshooting

1. **Package not found on MOSS** — Search: `mc find sh-moss/sw-release/musa/external --name "*${VERSION}*"`
2. **mc not found** — Install MinIO Client: `references/moss-download-guide.md`
3. **Auth failed** — Check `MOSS_ACCESS_KEY`/`MOSS_SECRET_KEY`

