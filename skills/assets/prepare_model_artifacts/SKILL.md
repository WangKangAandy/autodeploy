---
version: 1
name: prepare_model_artifacts
description: |
  Discover, download, and verify model files for AI workloads.
  Checks local directories first, supports HuggingFace and ModelScope sources.

category: assets
kind: atomic
exposure: user
risk_level: idempotent
execution_mode: remote

owners:
  - assets-team

triggers:
  - download model
  - prepare model
  - get model files
  - 准备模型
  - 下载模型

# Keep scope concise
scope:
  includes:
    - Local model directory discovery (with find fallback)
    - HuggingFace download (huggingface-cli preferred)
    - ModelScope mirror
    - Model file verification
  excludes:
    - Model loading/inference (use workload skills)
    - Model conversion/quantization
---

# Prepare Model Artifacts

This atomic skill discovers, downloads, and verifies model files for AI workloads. It prioritizes local existence and supports multiple sources.

## Invocation

- **Exposure**: user
- **Top-level intent**: `prepare_model_artifacts`
- **Callable from orchestration**: Yes

### Invocation Example

```
musa_dispatch(intent="prepare_model_artifacts", context={
  "MODEL_NAME": "Qwen/Qwen2-7B",
  "MODEL_SOURCE": "huggingface"
})
```

## When To Use This Skill

- Before running inference workloads
- Before running training workloads
- When setting up model serving
- As part of workload preparation pipeline

## When Not To Use This Skill

- For model inference/serving (use `run_inference_workload`)
- For model conversion (separate skill)
- For dataset preparation (use `prepare_dataset_artifacts`)

## Source Of Truth

- HuggingFace/ModelScope download docs; local convention: `/data/models/<sanitized-model-name>/`

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `MODEL_NAME` | Model name or identifier (e.g., `llama-7b`, `Qwen/Qwen2-7B`) | Yes | - |
| `MODEL_PATH` | Local directory path (optional hint) | No | - |
| `MODEL_SOURCE` | Download source: `huggingface` \| `modelscope` \| `local` | No | `huggingface` |
| `MODEL_REVISION` | Branch/tag/commit for version control | No | - |
| `HF_TOKEN` | HuggingFace token for gated models | No | - |

## Privileges Required

- **Sudo**: No
- **Remote access**: Yes
- **Docker access**: No
- **Network access**: Yes

## Tool Requirements

- **huggingface-cli**: Required for HuggingFace downloads (`pip install huggingface_hub`)
- **modelscope**: Required for ModelScope downloads (`pip install modelscope`)
- **git + git-lfs**: Optional fallback for HuggingFace (not recommended for large models)
- **jq**: Required for JSON array output (or use `tr '\n' ','` for comma-separated fallback)

## Prerequisites

- **Writable target directory**: The default target directory `/data/models/` must be writable by the executing user. If not writable, either:
  - Set `MODEL_PATH` to a writable directory, or
  - Ensure upstream environment preparation fixes permissions

## Execution Mode

Remote execution on MT-GPU machine via SSH.

## Idempotency

- **Idempotent**: Yes
- **Re-run behavior**: Uses existing model if found locally

## State Persistence

- **State file**: Not persisted
- **Resume supported**: No
- **Rationale**: Model download is handled by huggingface-cli/ModelScope which have their own resume mechanisms

## Workflow

### Step 1: Check Local Existence

**Action**:
```bash
# Sanitize MODEL_NAME for directory path (replace / : @ with -)
MODEL_DIR_NAME=$(echo "$MODEL_NAME" | sed 's#[/:@]#-#g')
MODEL_NAME_PART=$(echo "$MODEL_NAME" | rev | cut -d'/' -f1 | rev)

# Helper: check if directory contains valid model files
has_model_files() {
    local dir="$1"
    # Strong match: config files (transformers/diffusers format)
    [ -f "$dir/config.json" ] && return 0
    [ -f "$dir/model_index.json" ] && return 0
    # Medium match: weight files
    find "$dir" -maxdepth 1 -type f \( -name "*.safetensors" -o -name "*.bin" -o -name "*.pt" \) 2>/dev/null | grep -q . && return 0
    return 1
}

# Helper: check if path is a noisy directory (cache/tmp/backup)
is_noisy_path() {
    case "$1" in
        */cache/*|*/tmp/*|*/backup/*|*/.cache/*) return 0 ;;
        *) return 1 ;;
    esac
}

# Helper: select best candidate from multiple matches
select_best_candidate() {
    local best=""
    local best_score=0
    for c in "$@"; do
        local score=0
        # Config file bonus
        [ -f "$c/config.json" ] || [ -f "$c/model_index.json" ] && score=$((score + 10))
        # Priority path bonus
        case "$c" in /data/model/*|/data/models/*) score=$((score + 5)) ;; esac
        # Noisy path penalty
        is_noisy_path "$c" && score=$((score - 8))
        if [ "$score" -gt "$best_score" ]; then
            best="$c"
            best_score="$score"
        fi
    done
    [ -n "$best" ] && echo "$best"
}

# 1. Try exact MODEL_PATH if provided
if [ -n "$MODEL_PATH" ] && [ -d "$MODEL_PATH" ] && has_model_files "$MODEL_PATH"; then
    RESOLVED_PATH="$MODEL_PATH"
    FOUND_LOCAL=true
    echo "Found model at specified path: $RESOLVED_PATH"
fi

# 2. Try priority paths (common model directories)
if [ -z "$RESOLVED_PATH" ]; then
    for base in "/data/model" "/data/models" "$HOME/models" "./models" "/workspace/models"; do
        [ -d "$base" ] || continue
        for name in "$MODEL_DIR_NAME" "$MODEL_NAME_PART" "$MODEL_NAME"; do
            candidate="$base/$name"
            if [ -d "$candidate" ] && has_model_files "$candidate"; then
                RESOLVED_PATH="$candidate"
                FOUND_LOCAL=true
                echo "Found model at: $RESOLVED_PATH"
                break 2
            fi
        done
    done
fi

# 3. Fallback: recursive search in /data
if [ -z "$RESOLVED_PATH" ]; then
    echo "Searching for model in /data..."

    CANDIDATES=$(find /data -maxdepth 4 -type d \( \
        -iname "*${MODEL_NAME_PART}*" -o \
        -iname "*${MODEL_DIR_NAME}*" \
    \) 2>/dev/null | while read -r dir; do
        has_model_files "$dir" && echo "$dir"
    done)

    count=$(echo "$CANDIDATES" | grep -c .)
    if [ "$count" -eq 1 ]; then
        RESOLVED_PATH=$(echo "$CANDIDATES" | head -1)
        FOUND_LOCAL=true
        echo "Found model via search: $RESOLVED_PATH"
    elif [ "$count" -gt 1 ]; then
        RESOLVED_PATH=$(select_best_candidate $CANDIDATES)
        if [ -n "$RESOLVED_PATH" ]; then
            FOUND_LOCAL=true
            echo "Selected best match from $count candidates: $RESOLVED_PATH"
        else
            echo "WARNING: Multiple candidates found for '$MODEL_NAME_PART':"
            echo "$CANDIDATES" | while read -r c; do printf '  - %s\n' "$c"; done
            echo "Specify MODEL_PATH to disambiguate"
        fi
    fi
fi

[ -n "$RESOLVED_PATH" ] && echo "Using local model, skipping download"
```

**Verification**:
- Determine if model exists locally

---

### Step 2: Download Model

**Action**:
If model not found locally:

```bash
if [ -z "$RESOLVED_PATH" ]; then
    # Determine target directory with sanitized name
    TARGET_DIR="${MODEL_PATH:-/data/models/${MODEL_DIR_NAME}}"

    DOWNLOAD_STATUS="failed"

    case "${MODEL_SOURCE:-huggingface}" in
        huggingface)
            echo "Downloading from HuggingFace: ${MODEL_NAME}"
            mkdir -p "$TARGET_DIR"

            # Prefer huggingface-cli (recommended, handles LFS, resume, auth)
            if command -v huggingface-cli &>/dev/null; then
                if huggingface-cli download \
                    "${MODEL_NAME}" \
                    --local-dir "$TARGET_DIR" \
                    ${HF_TOKEN:+--token "$HF_TOKEN"} \
                    ${MODEL_REVISION:+--revision "$MODEL_REVISION"}; then
                    DOWNLOAD_STATUS="downloaded"
                else
                    echo "huggingface-cli download failed"
                fi
            else
                echo "ERROR: huggingface-cli not found"
                echo "Install with: pip install huggingface_hub"
                echo ""
                echo "Fallback: git clone (may not work for large models with LFS)"

                # Last resort fallback - only for small models without LFS
                if command -v git &>/dev/null && command -v git-lfs &>/dev/null; then
                    git lfs install
                    if git clone --depth 1 ${MODEL_REVISION:+--branch "$MODEL_REVISION"} \
                        "https://huggingface.co/${MODEL_NAME}" "$TARGET_DIR" 2>/dev/null; then
                        DOWNLOAD_STATUS="downloaded"
                        echo "Warning: git clone may be incomplete for large models"
                    fi
                fi

                if [ "$DOWNLOAD_STATUS" != "downloaded" ]; then
                    echo "Failed to download model. Please install huggingface-cli:"
                    echo "  pip install huggingface_hub"
                    DOWNLOAD_STATUS="failed"
                fi
            fi
            ;;

        modelscope)
            echo "Downloading from ModelScope: ${MODEL_NAME}"
            mkdir -p "$TARGET_DIR"

            if command -v modelscope &>/dev/null; then
                if modelscope download --model "${MODEL_NAME}" --local_dir "$TARGET_DIR"; then
                    DOWNLOAD_STATUS="downloaded"
                else
                    echo "modelscope download failed"
                fi
            else
                echo "ERROR: modelscope command not found"
                echo "Install with: pip install modelscope"
                DOWNLOAD_STATUS="failed"
            fi
            ;;

        local)
            echo "Local source specified but model not found"
            DOWNLOAD_STATUS="missing"
            # Do NOT create directory for local source - model must exist
            ;;
    esac

    # Only set RESOLVED_PATH if we actually created/used the target
    if [ "$DOWNLOAD_STATUS" != "missing" ]; then
        RESOLVED_PATH="$TARGET_DIR"
    fi
fi
```

**Verification**:
- Model downloaded successfully
- Target directory exists

---

### Step 3: Verify Model Files

**Action**:
```bash
VERIFICATION_STATUS="passed"
ERRORS=()

# Check for essential model files (support multiple formats)
HAS_CONFIG=false
if [ -f "$RESOLVED_PATH/config.json" ]; then
    HAS_CONFIG=true
    echo "Found config.json (transformers format)"
elif [ -f "$RESOLVED_PATH/model_index.json" ]; then
    HAS_CONFIG=true
    echo "Found model_index.json (diffusers format)"
fi

if [ "$HAS_CONFIG" = false ]; then
    ERRORS+=("Missing required config file: config.json or model_index.json")
    VERIFICATION_STATUS="failed"
fi

# Check for model weights
HAS_WEIGHTS=false
if find "$RESOLVED_PATH" -maxdepth 1 -type f \( -name "*.safetensors" -o -name "*.bin" -o -name "*.pt" \) 2>/dev/null | grep -q .; then
    HAS_WEIGHTS=true
fi

if [ "$HAS_WEIGHTS" = false ]; then
    echo "Warning: No model weight files found"
    echo "Model may be incomplete or require separate weight download"
    # Don't fail - some models have weights elsewhere
fi

# Calculate total size
TOTAL_SIZE=$(du -sb "$RESOLVED_PATH" 2>/dev/null | cut -f1 || echo "0")
if [ "$TOTAL_SIZE" -gt 0 ]; then
    echo "Model directory size: $(echo "scale=2; $TOTAL_SIZE / 1024 / 1024 / 1024" | bc) GB"
fi

# List key files found
echo "Files found:"
ls -la "$RESOLVED_PATH"/*.json 2>/dev/null | head -5
ls -la "$RESOLVED_PATH"/*.safetensors 2>/dev/null | head -5
ls -la "$RESOLVED_PATH"/*.bin 2>/dev/null | head -5

if [ "$VERIFICATION_STATUS" = "failed" ]; then
    echo "Verification failed: ${ERRORS[*]}"
    # Continue to Step 4 for status output
fi
```

**Verification**:
- `config.json` or `model_index.json` exists (required)
- Weight files status checked (warning only)

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
    RESULT_SOURCE="${MODEL_SOURCE:-huggingface}"
else
    RESULT_STATUS="downloaded"
    RESULT_SOURCE="${MODEL_SOURCE:-huggingface}"
fi

# List files for output as JSON array (only if resolved path exists)
FILES="[]"
if [ -n "$RESOLVED_PATH" ] && [ -d "$RESOLVED_PATH" ]; then
    if command -v jq &>/dev/null; then
        FILES=$(find "$RESOLVED_PATH" -maxdepth 1 \( -name "*.json" -o -name "*.safetensors" -o -name "*.bin" \) -exec basename {} \; 2>/dev/null | jq -R . | jq -s .)
    else
        # Fallback: comma-separated string wrapped as array notation
        FILES_CSV=$(find "$RESOLVED_PATH" -maxdepth 1 \( -name "*.json" -o -name "*.safetensors" -o -name "*.bin" \) -exec basename {} \; 2>/dev/null | tr '\n' ',' | sed 's/,$//')
        FILES="[\"${FILES_CSV//,/\",\"}\"]"
    fi
fi
```

## Success Criteria

- Model directory exists (discoverable or created)
- `config.json` or `model_index.json` present (required for status=found/downloaded)
- Model artifact is discoverable
- Weight files checked, but absence is warning-only in v1

**Note**: `status=found` or `status=downloaded` indicates the model directory structure is valid, not that the model is guaranteed to be loadable for inference.

### Example Checks

- `test -f $RESOLVED_PATH/config.json || test -f $RESOLVED_PATH/model_index.json`
- `ls $RESOLVED_PATH/*.safetensors || ls $RESOLVED_PATH/*.bin` (optional)

## Outputs

### Output Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | `found` \| `downloaded` \| `missing` \| `failed` |
| `resolvedPath` | string | No | Path to model directory (absent when status=missing) |
| `source` | string | No | `existing` \| `huggingface` \| `modelscope` \| `local` |
| `size` | integer | No | Total size in bytes |
| `hasWeights` | boolean | No | Whether weight files were found |
| `files` | string[] | No | List of key model files (json, safetensors, bin) |
| `errors` | string[] | No | List of errors (if status=failed) |

### Status Values

| Status | Meaning |
|--------|---------|
| `found` | Model found locally, no download needed |
| `downloaded` | Model successfully downloaded |
| `missing` | Model not found and could not be downloaded |
| `failed` | Download or verification failed |

### Output Example

```json
{
  "status": "found",
  "resolvedPath": "/data/models/Qwen2-7B",
  "source": "existing",
  "size": 13421772800,
  "hasWeights": true,
  "files": ["config.json", "model.safetensors", "tokenizer.json"]
}
```

## Side Effects

- **Modifies**: Target model directory, HuggingFace cache (if used)
- **Creates**: Model directory and files
- **Removes/Replaces**: None
- **Requires reboot**: No

## Important Rules

1. **Local first**: Always check local directories before downloading
2. **Priority search**: `/data/model` → `/data/models` → other paths → `/data` recursive fallback
3. **Sanitize model names**: Replace `/`, `:`, `@` with `-` for directory paths
4. **huggingface-cli preferred**: More reliable than git clone for large models
5. **Multi-format support**: Accept `config.json` (transformers) or `model_index.json` (diffusers)
6. **Weight file warning**: Warn but don't fail if no weights found
7. **Candidate scoring**: Score by config file (+10), priority path (+5), noisy path (-8)
8. **Noisy path detection**: Match path segments `*/cache/*`, `*/tmp/*`, `*/backup/*` (not substrings)

## Troubleshooting

### Common Issues

1. **HuggingFace 403 Forbidden**
   - Model may be gated, set `HF_TOKEN`
   - Run `huggingface-cli login` first

2. **huggingface-cli not found**
   - Install: `pip install huggingface_hub`
   - git clone fallback may not work for large models

3. **Disk space insufficient**
   - Check available space: `df -h /data`
   - Clean up old models

4. **Network timeout**
   - Use ModelScope mirror for China region
   - Check network connectivity

5. **Large model download interrupted**
   - huggingface-cli supports resume automatically
   - git clone does NOT support resume well

6. **Model found but no weights**
   - Some models require separate weight download
   - Check model card for instructions