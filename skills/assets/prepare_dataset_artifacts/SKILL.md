---
version: 1
name: prepare_dataset_artifacts
description: Download and verify dataset files from HuggingFace.

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
  - 下载数据集
---

# Prepare Dataset Artifacts

Downloads dataset files, checking local directories first.

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DATASET_NAME` | Dataset identifier (e.g., `alpaca`) | Yes | - |
| `DATASET_PATH` | Local directory hint | No | - |
| `DATASET_SPLIT` | Specific split (e.g., `train`) | No | - |

## Workflow

### Step 1: Check Local

```bash
DATASET_DIR_NAME=$(echo "$DATASET_NAME" | sed 's#[/:@]#-#g')

for base in "/data/datasets" "$HOME/datasets" "./datasets"; do
    if [ -d "$base/$DATASET_DIR_NAME" ]; then
        RESOLVED_PATH="$base/$DATASET_DIR_NAME"
        echo "Found: $RESOLVED_PATH"
        exit 0
    fi
done
```

---

### Step 2: Download

```bash
TARGET_DIR="${DATASET_PATH:-/data/datasets/${DATASET_DIR_NAME}}"
mkdir -p "$TARGET_DIR"

python3 << 'EOF'
from datasets import load_dataset
import os

dataset_name = os.environ["DATASET_NAME"]
target_dir = os.environ["TARGET_DIR"]
split = os.environ.get("DATASET_SPLIT")

ds = load_dataset(dataset_name, split=split) if split else load_dataset(dataset_name)
ds.save_to_disk(target_dir)
EOF
```

---

### Step 3: Verify

```bash
ls "$TARGET_DIR"/*.json 2>/dev/null || ls "$TARGET_DIR"/*.jsonl 2>/dev/null || \
    [ -f "$TARGET_DIR/dataset_info.json" ]
```

## Success Criteria

- Dataset directory exists
- At least one data file present

## Troubleshooting

1. **datasets not found** - `pip install datasets`
2. **Auth required** - Run `huggingface-cli login`