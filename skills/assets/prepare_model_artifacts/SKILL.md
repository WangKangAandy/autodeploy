---

version: 1  
name: prepare_model_artifacts  
description: Download and verify model files from ModelScope or HuggingFace.

category: assets
kind: atomic
exposure: user
risk_level: idempotent
execution_mode: remote

owners:

- assets-team

## triggers:  
  - download model  
  - prepare model

# Prepare Model Artifacts

Downloads model files, checking local directories first.

## Inputs


| Variable       | Description                              | Required | Default      |
| -------------- | ---------------------------------------- | -------- | ------------ |
| `MODEL_NAME`   | Model identifier (e.g., `Qwen/Qwen2-7B`) | Yes      | -            |
| `MODEL_PATH`   | Local directory hint                     | No       | /data/models |
| `MODEL_SOURCE` | `modelscope` `or huggingface`            | No       | `modelscope` |
| `HF_TOKEN`     | HuggingFace token for gated models       | No       | -            |


## Workflow

### Step 1: Check Local

```bash
MODEL_DIR_NAME=$(echo "$MODEL_NAME" | sed 's#[/:@]#-#g')

# Check priority paths
for base in "/data/models" "$HOME/models" "./models"; do
    for name in "$MODEL_DIR_NAME" "$MODEL_NAME"; do
        if [ -d "$base/$name" ] && [ -f "$base/$name/config.json" ]; then
            RESOLVED_PATH="$base/$name"
            echo "Found: $RESOLVED_PATH"
            exit 0
        fi
    done
done
```

---

### Step 2: Download

**Before download:** Check disk on the target volume (`df -h /data`, or parent of `TARGET_DIR`).
Ensure CLI is on PATH (`command -v huggingface-cli` or `modelscope` per `MODEL_SOURCE`; install `huggingface_hub` / `modelscope` if missing).

```bash
TARGET_DIR="${MODEL_PATH:-/data/models/${MODEL_NAME}}"
mkdir -p "$TARGET_DIR"

case "$MODEL_SOURCE" in
    huggingface)
        huggingface-cli download "$MODEL_NAME" --local-dir "$TARGET_DIR" ${HF_TOKEN:+--token "$HF_TOKEN"}
        ;;
    modelscope)
        modelscope download --model "$MODEL_NAME" --local_dir "$TARGET_DIR"
        ;;
esac
```

---

### Step 3: Verify

```bash
[ -f "$TARGET_DIR/config.json" ] || [ -f "$TARGET_DIR/model_index.json" ]
```

## Success Criteria

- Model directory exists with config file
- Weight files present (warning only if missing)
- Download exit code 0; CLI output shows completion with no error or incomplete-transfer messages

## Troubleshooting

1. **403 Forbidden** — Set `HF_TOKEN` for gated models
