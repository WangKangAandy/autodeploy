---
version: 1
name: prepare_dependency_repo
description: Clone or update code repositories.

category: assets
kind: atomic
exposure: user
risk_level: idempotent
execution_mode: remote

owners:
  - assets-team

triggers:
  - clone repository
  - prepare repo
  - 克隆仓库
---

# Prepare Dependency Repo

Clones or updates code repositories for AI workloads.

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `REPO_URL` | Git repository URL | Yes | - |
| `REPO_PATH` | Local directory path | No | Auto from URL |
| `BRANCH` | Branch to checkout | No | `main` |
| `DEPTH` | Clone depth | No | 1 |

## Workflow

### Step 1: Check Local

```bash
REPO_NAME=$(basename "$REPO_URL" .git)
for base in "/workspace" "$HOME/workspace" "./repos"; do
    if [ -d "$base/$REPO_NAME/.git" ]; then
        RESOLVED_PATH="$base/$REPO_NAME"
        echo "Found: $RESOLVED_PATH"
        cd "$RESOLVED_PATH"
        git fetch origin && git checkout "$BRANCH"
        exit 0
    fi
done
```

---

### Step 2: Clone

```bash
TARGET_DIR="${REPO_PATH:-/workspace/$REPO_NAME}"

if [ -n "$DEPTH" ]; then
    git clone --depth "$DEPTH" --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
else
    git clone --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
fi
```

---

### Step 3: Verify

```bash
[ -d "$TARGET_DIR/.git" ]
```

## Success Criteria

- Repository cloned/updated
- `.git` directory exists

## Troubleshooting

1. **Auth failed** - Use SSH URL or configure credentials
2. **Branch not found** - Check available branches: `git ls-remote "$REPO_URL"`
3. **Network timeout** - Increase timeout or use mirror