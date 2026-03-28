---
version: 1
name: prepare_dataset_artifacts
description: |
  Discover, download, and verify dataset files for AI workloads.
  Checks local directories first, supports HuggingFace and other sources.

category: assets
kind: atomic
exposure: user
risk_level: idempotent
execution_mode: remote

owners:
  - assets-team

triggers:
  - download dataset
  - prepare dataset
  - get dataset files
  - 准备数据集
  - 下载数据集

# Keep scope concise
scope:
  includes:
    - Local dataset directory discovery (with find fallback)
    - HuggingFace datasets download
    - Dataset file verification
  excludes:
    - Dataset preprocessing (tokenization, cleaning)
    - Dataset loading (use workload skills)
---

# Prepare Dataset Artifacts

This atomic skill discovers, downloads, and verifies dataset files for AI workloads. It prioritizes local existence.

## Invocation

- **Exposure**: user
- **Top-level intent**: `prepare_dataset_artifacts`
- **Callable from orchestration**: Yes

### Invocation Example

```
musa_dispatch(intent="prepare_dataset_artifacts", context={
  "DATASET_NAME": "alpaca",
  "DATASET_SOURCE": "huggingface"
})
```

## When To Use This Skill

- Before running training workloads
- Before running fine-tuning workloads
- When preparing data for experiments
- As part of workload preparation pipeline

## When Not To Use This Skill

- For dataset preprocessing (tokenization, cleaning)
- For dataset format conversion
- For model preparation (use `prepare_model_artifacts`)

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DATASET_NAME` | Dataset name or identifier (e.g., `alpaca`, `openai/gsm8k`) | Yes | - |
| `DATASET_PATH` | Local directory path (optional hint) | No | - |
| `DATASET_SOURCE` | Download source: `huggingface` \| `local` | No | `huggingface` |
| `DATASET_SPLIT` | Specific split to download (e.g., `train`, `validation`) | No | - |

## Privileges Required

- **Sudo**: No
- **Remote access**: Yes
- **Docker access**: No
- **Network access**: Yes

## Execution Mode

Remote execution on MT-GPU machine via SSH.

## Idempotency

- **Idempotent**: Yes
- **Re-run behavior**: Uses existing dataset if found locally

## State Persistence

- **State file**: Not persisted
- **Resume supported**: No
- **Rationale**: Dataset download is handled by huggingface datasets library which has its own caching

## Workflow

### Step 1: Check Local Existence

**Action**:
```bash
# Sanitize DATASET_NAME for directory path (replace / : @ with -)
DATASET_DIR_NAME=$(echo "$DATASET_NAME" | sed 's#[/:@]#-#g')

# 1. Try exact DATASET_PATH if provided
if [ -n "$DATASET_PATH" ] && [ -d "$DATASET_PATH" ]; then
    # Check for dataset files
    if ls "$DATASET_PATH"/*.json 2>/dev/null || \
       ls "$DATASET_PATH"/*.jsonl 2>/dev/null || \
       ls "$DATASET_PATH"/*.parquet 2>/dev/null || \
       [ -f "$DATASET_PATH/dataset_info.json" ]; then
        RESOLVED_PATH="$DATASET_PATH"
        FOUND_LOCAL=true
        echo "Found dataset at specified path: $RESOLVED_PATH"
    fi
fi

# 2. Try standard paths with sanitized name
if [ -z "$RESOLVED_PATH" ]; then
    SEARCH_BASES=(
        "/data/datasets"
        "$HOME/datasets"
        "./datasets"
        "/workspace/datasets"
    )

    for base in "${SEARCH_BASES[@]}"; do
        if [ -d "$base" ]; then
            # Try both sanitized name and original name
            for name in "$DATASET_DIR_NAME" "$DATASET_NAME"; do
                candidate="$base/$name"
                if [ -d "$candidate" ]; then
                    # Check for dataset files
                    if ls "$candidate"/*.json 2>/dev/null || \
                       ls "$candidate"/*.jsonl 2>/dev/null || \
                       ls "$candidate"/*.parquet 2>/dev/null || \
                       [ -f "$candidate/dataset_info.json" ]; then
                        RESOLVED_PATH="$candidate"
                        FOUND_LOCAL=true
                        echo "Found existing dataset at: $RESOLVED_PATH"
                        break 2
                    fi
                fi
            done
        fi
    done
fi

# 3. Fallback: use find to search for dataset files
if [ -z "$RESOLVED_PATH" ]; then
    echo "Searching for dataset in known directories..."

    for base in "/data/datasets" "$HOME/datasets" "/workspace/datasets"; do
        if [ -d "$base" ]; then
            # Find directories containing dataset files
            FOUND_DIR=$(find "$base" -maxdepth 3 \( -name "*.jsonl" -o -name "*.parquet" -o -name "dataset_info.json" \) -exec dirname {} \; 2>/dev/null | head -1)

            if [ -n "$FOUND_DIR" ]; then
                # Verify it matches dataset name (partial match)
                DATASET_BASENAME=$(echo "$DATASET_NAME" | sed 's#[/:@]#-#g')
                if echo "$FOUND_DIR" | grep -qi "$DATASET_BASENAME"; then
                    RESOLVED_PATH="$FOUND_DIR"
                    FOUND_LOCAL=true
                    echo "Found dataset via search: $RESOLVED_PATH"
                    break
                fi
            fi
        fi
    done
fi

if [ -n "$RESOLVED_PATH" ]; then
    echo "Using local dataset, skipping download"
fi
```

**Verification**:
- Determine if dataset exists locally

---

### Step 2: Download Dataset

**Action**:
If dataset not found locally:

```bash
if [ -z "$RESOLVED_PATH" ]; then
    # Determine target directory with sanitized name
    TARGET_DIR="${DATASET_PATH:-/data/datasets/${DATASET_DIR_NAME}}"

    DOWNLOAD_STATUS="failed"

    case "${DATASET_SOURCE:-huggingface}" in
        huggingface)
            echo "Downloading from HuggingFace Datasets: ${DATASET_NAME}"

            # Check if datasets library is available
            if ! python3 -c "import datasets" 2>/dev/null; then
                echo "ERROR: datasets library not found"
                echo "Install with: pip install datasets"
                DOWNLOAD_STATUS="failed"
            else
                mkdir -p "$TARGET_DIR"

                # Download using Python
                python3 << 'PYEOF'
import sys
from datasets import load_dataset
import os

dataset_name = os.environ.get("DATASET_NAME", "")
target_dir = os.environ.get("TARGET_DIR", "")
split = os.environ.get("DATASET_SPLIT", "")

try:
    if split and split != "None":
        ds = load_dataset(dataset_name, split=split)
    else:
        ds = load_dataset(dataset_name)

    if hasattr(ds, 'save_to_disk'):
        ds.save_to_disk(target_dir)
    else:
        os.makedirs(target_dir, exist_ok=True)
        for split_name, split_ds in ds.items():
            split_path = os.path.join(target_dir, split_name)
            split_ds.save_to_disk(split_path)

    print(f"SUCCESS: Dataset saved to {target_dir}")
    sys.exit(0)
except Exception as e:
    print(f"FAILED: {e}")
    sys.exit(1)
PYEOF

                if [ $? -eq 0 ]; then
                    DOWNLOAD_STATUS="downloaded"
                else
                    echo "Failed to download dataset from HuggingFace"
                fi
            fi
            ;;

        local)
            echo "Local source specified but dataset not found"
            DOWNLOAD_STATUS="missing"
            # Do NOT create directory for local source - dataset must exist
            ;;
    esac

    # Only set RESOLVED_PATH if we actually created/used the target
    if [ "$DOWNLOAD_STATUS" != "missing" ]; then
        RESOLVED_PATH="$TARGET_DIR"
    fi
fi
```

**Verification**:
- Dataset downloaded successfully
- Target directory exists

---

### Step 3: Verify Dataset Files

**Action**:
```bash
VERIFICATION_STATUS="passed"
ERRORS=()

# Check for dataset files
HAS_DATA=false

for pattern in "*.json" "*.jsonl" "*.parquet" "*.csv"; do
    if ls "$RESOLVED_PATH"/$pattern 2>/dev/null | grep -q .; then
        HAS_DATA=true
        break
    fi
done

# Also check for saved dataset format (datasets library)
if [ -f "$RESOLVED_PATH/dataset_info.json" ] || \
   [ -d "$RESOLVED_PATH/train" ] || \
   [ -d "$RESOLVED_PATH/validation" ]; then
    HAS_DATA=true
fi

if [ "$HAS_DATA" = false ]; then
    ERRORS+=("No dataset files found in: $RESOLVED_PATH")
    VERIFICATION_STATUS="failed"
fi

# Calculate total size
TOTAL_SIZE=$(du -sb "$RESOLVED_PATH" 2>/dev/null | cut -f1 || echo "0")
if [ "$TOTAL_SIZE" -gt 0 ]; then
    echo "Dataset directory size: $(echo "scale=2; $TOTAL_SIZE / 1024 / 1024 / 1024" | bc) GB"
fi

# Count files
FILE_COUNT=$(find "$RESOLVED_PATH" -type f 2>/dev/null | wc -l || echo "0")
echo "Total files: $FILE_COUNT"

if [ "$VERIFICATION_STATUS" = "failed" ]; then
    echo "Verification failed: ${ERRORS[*]}"
    # Continue to Step 4 for status output
fi
```

**Verification**:
- Dataset files present

---

### Step 4: Output Result

**Action**:
```bash
# Determine status
if [ -n "$FOUND_LOCAL" ]; then
    RESULT_STATUS="found"
    RESULT_SOURCE="existing"
elif [ "$DOWNLOAD_STATUS" = "missing" ]; then
    RESULT_STATUS="missing"
    RESULT_SOURCE="local"
elif [ "$DOWNLOAD_STATUS" = "failed" ] || [ "$VERIFICATION_STATUS" = "failed" ]; then
    RESULT_STATUS="failed"
    RESULT_SOURCE="${DATASET_SOURCE:-huggingface}"
else
    RESULT_STATUS="downloaded"
    RESULT_SOURCE="${DATASET_SOURCE:-huggingface}"
fi
```

## Success Criteria

- Dataset directory exists
- At least one dataset file present (json, jsonl, parquet, csv, or dataset_info.json)

### Example Checks

- `test -d $RESOLVED_PATH`
- `ls $RESOLVED_PATH/*.jsonl || ls $RESOLVED_PATH/*.parquet`

## Outputs

### Output Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | `found` \| `downloaded` \| `missing` \| `failed` |
| `resolvedPath` | string | No | Path to dataset directory (absent when status=missing) |
| `source` | string | No | `existing` \| `huggingface` \| `local` |
| `size` | integer | No | Total size in bytes |
| `fileCount` | integer | No | Number of files |
| `errors` | string[] | No | List of errors (if status=failed) |

### Status Values

| Status | Meaning |
|--------|---------|
| `found` | Dataset found locally, no download needed |
| `downloaded` | Dataset successfully downloaded |
| `missing` | Dataset not found and could not be downloaded |
| `failed` | Download or verification failed |

### Output Example

```json
{
  "status": "found",
  "resolvedPath": "/data/datasets/alpaca",
  "source": "existing",
  "size": 2147483648,
  "fileCount": 3
}
```

## Side Effects

- **Modifies**: Target dataset directory, HuggingFace cache (if used)
- **Creates**: Dataset directory and files
- **Removes/Replaces**: None
- **Requires reboot**: No

## Important Rules

1. **Local first**: Always check local directories before downloading
2. **Sanitize dataset names**: Replace `/`, `:`, `@` with `-` for directory paths
3. **Multiple file formats**: Support json, jsonl, parquet, csv
4. **Split handling**: Handle datasets with multiple splits
5. **Size reporting**: Report total size for planning
6. **find fallback**: Use find for flexible discovery when standard paths fail

## Troubleshooting

### Common Issues

1. **Dataset not found on HuggingFace**
   - Check dataset name format (use `org/dataset` format)
   - Verify dataset exists on huggingface.co/datasets

2. **Authentication required**
   - Some datasets require login
   - Run `huggingface-cli login` first

3. **Python datasets library not installed**
   - Install: `pip install datasets`

4. **Large dataset download**
   - Use specific split to reduce download size: `DATASET_SPLIT=train`
   - Check disk space before downloading

5. **Disk space insufficient**
   - Check available space: `df -h /data`
   - Clean up old datasets

6. **Download interrupted**
   - Re-run the skill - it will attempt to resume
   - Check partial download in target directory