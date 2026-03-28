---
version: 1
name: prepare_dependency_repo
description: |
  Clone, update, or verify code repositories and dependency sources.
  Supports git checkout, local copy, and basic dependency preparation.

category: assets
kind: atomic
exposure: user
risk_level: idempotent
execution_mode: remote

owners:
  - assets-team

triggers:
  - clone repository
  - prepare code
  - setup repo
  - 准备代码仓库
  - 克隆仓库

# Keep scope concise
scope:
  includes:
    - Git repository clone/update
    - Local directory discovery (with find fallback)
    - Basic dependency verification
  excludes:
    - Environment setup (use env skills)
    - Package installation (use appropriate installers)
    - Complex dependency resolution
---

# Prepare Dependency Repo

This atomic skill prepares code repositories and dependency sources for AI workloads. Phase 1 scope: repo checkout and basic preparation.

## Invocation

- **Exposure**: user
- **Top-level intent**: `prepare_dependency_repo`
- **Callable from orchestration**: Yes

### Invocation Example

```
musa_dispatch(intent="prepare_dependency_repo", context={
  "REPO_URL": "https://github.com/user/repo.git",
  "REPO_BRANCH": "main"
})
```

## When To Use This Skill

- Before running training/inference workloads
- When setting up project code
- When preparing custom model implementations
- As part of workload preparation pipeline

## When Not To Use This Skill

- For system package installation (use `ensure_system_dependencies`)
- For Python package installation (handled by workload environment)
- For complex multi-repo orchestration (future enhancement)

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `REPO_URL` | Git repository URL | Yes | - |
| `REPO_BRANCH` | Branch, tag, or commit | No | `main` |
| `REPO_PATH` | Local target directory | No | `/workspace/<repo_name>` |
| `REPO_DEPTH` | Clone depth for shallow clone | No | full |

## Privileges Required

- **Sudo**: No
- **Remote access**: Yes
- **Docker access**: No
- **Network access**: Yes

## Execution Mode

Remote execution on MT-GPU machine via SSH.

## Idempotency

- **Idempotent**: Yes
- **Re-run behavior**: Updates existing repository or skips if already correct

## State Persistence

- **State file**: Not persisted
- **Resume supported**: No
- **Rationale**: Git operations are inherently resumable; partial clones can be continued

## Workflow

### Step 1: Determine Target Path

**Action**:
```bash
# Extract repo name from URL (safe - basename only)
REPO_NAME=$(basename "$REPO_URL" .git)

# Sanitize repo name for directory use
REPO_DIR_NAME=$(echo "$REPO_NAME" | sed 's#[/:@]#-#g')

# Determine target directory
if [ -n "$REPO_PATH" ]; then
    TARGET_DIR="$REPO_PATH"
else
    TARGET_DIR="/workspace/${REPO_DIR_NAME}"
fi

echo "Target directory: $TARGET_DIR"
echo "Repository name: $REPO_NAME"
```

**Verification**:
- Target path determined

---

### Step 2: Check Existing Repository

**Action**:
```bash
# Initialize status
STATUS=""
FOUND_LOCAL=false

# 1. Check specified path or standard path
if [ -d "$TARGET_DIR/.git" ]; then
    echo "Repository already exists at: $TARGET_DIR"

    # Check current branch
    CURRENT_BRANCH=$(cd "$TARGET_DIR" && git branch --show-current 2>/dev/null || echo "detached")
    CURRENT_COMMIT=$(cd "$TARGET_DIR" && git rev-parse HEAD 2>/dev/null || echo "unknown")

    echo "  Current branch: $CURRENT_BRANCH"
    echo "  Current commit: ${CURRENT_COMMIT:0:8}"

    # Check if it matches target
    TARGET_REF="${REPO_BRANCH:-main}"
    if [ "$CURRENT_BRANCH" = "$TARGET_REF" ] || \
       git -C "$TARGET_DIR" rev-parse "$TARGET_REF" >/dev/null 2>&1 && \
       [ "$(git -C "$TARGET_DIR" rev-parse "$TARGET_REF" 2>/dev/null)" = "$CURRENT_COMMIT" ]; then
        echo "Repository is at target state"
        RESOLVED_PATH="$TARGET_DIR"
        FOUND_LOCAL=true
        STATUS="existing"
    else
        echo "Branch/ref mismatch. Will update in next step."
    fi
fi

# 2. Fallback: search for repo by name in common locations
if [ -z "$RESOLVED_PATH" ]; then
    SEARCH_BASES=(
        "/workspace"
        "$HOME/workspace"
        "/data/repos"
        "./repos"
    )

    for base in "${SEARCH_BASES[@]}"; do
        if [ -d "$base" ]; then
            # Find directories with .git containing matching remote
            FOUND_DIR=$(find "$base" -maxdepth 3 -name ".git" -type d -exec dirname {} \; 2>/dev/null | while read dir; do
                REMOTE=$(git -C "$dir" remote get-url origin 2>/dev/null)
                if [ -n "$REMOTE" ] && echo "$REMOTE" | grep -q "$REPO_NAME"; then
                    echo "$dir"
                    break
                fi
            done)

            if [ -n "$FOUND_DIR" ] && [ -d "$FOUND_DIR" ]; then
                RESOLVED_PATH="$FOUND_DIR"
                FOUND_LOCAL=true
                STATUS="existing"
                echo "Found existing repository via search: $RESOLVED_PATH"
                break
            fi
        fi
    done
fi
```

**Verification**:
- Determine repository state

---

### Step 3: Clone or Update Repository

**Action**:
```bash
if [ -z "$STATUS" ]; then
    CLONE_ERROR=""

    if [ -d "$TARGET_DIR/.git" ]; then
        # Update existing repository
        echo "Updating existing repository..."

        cd "$TARGET_DIR" || {
            CLONE_ERROR="Cannot access directory: $TARGET_DIR"
        }

        if [ -z "$CLONE_ERROR" ]; then
            # Fetch latest
            if ! git fetch origin 2>&1; then
                CLONE_ERROR="git fetch failed"
            fi
        fi

        if [ -z "$CLONE_ERROR" ] && [ -n "$REPO_BRANCH" ]; then
            # Checkout target branch/commit
            if ! git checkout "$REPO_BRANCH" 2>/dev/null; then
                # Try creating local branch from remote
                if ! git checkout -b "$REPO_BRANCH" "origin/$REPO_BRANCH" 2>/dev/null; then
                    CLONE_ERROR="Failed to checkout branch: $REPO_BRANCH"
                fi
            fi
        fi

        if [ -z "$CLONE_ERROR" ]; then
            # Pull latest (if on a branch, not detached HEAD)
            BRANCH=$(git branch --show-current 2>/dev/null)
            if [ -n "$BRANCH" ] && [ -z "$(git status --porcelain 2>/dev/null)" ]; then
                git pull origin "$BRANCH" 2>/dev/null || true
            fi
            STATUS="updated"
        fi

    else
        # Clone fresh
        echo "Cloning repository: $REPO_URL"

        # Remove incomplete directory if exists
        if [ -d "$TARGET_DIR" ]; then
            echo "Removing incomplete directory: $TARGET_DIR"
            rm -rf "$TARGET_DIR"
        fi

        # Build clone command
        CLONE_ARGS=()
        if [ -n "$REPO_DEPTH" ] && [ "$REPO_DEPTH" != "full" ]; then
            CLONE_ARGS+=(--depth "$REPO_DEPTH")
        fi
        if [ -n "$REPO_BRANCH" ]; then
            CLONE_ARGS+=(--branch "$REPO_BRANCH")
        fi

        # Execute clone
        if git clone "${CLONE_ARGS[@]}" "$REPO_URL" "$TARGET_DIR" 2>&1; then
            STATUS="cloned"
        else
            CLONE_ERROR="git clone failed"
        fi
    fi

    # Handle errors
    if [ -n "$CLONE_ERROR" ]; then
        echo "ERROR: $CLONE_ERROR"
        STATUS="failed"
        RESOLVED_PATH="$TARGET_DIR"
    else
        RESOLVED_PATH="$TARGET_DIR"
    fi
fi
```

**Verification**:
- Repository cloned or updated
- Check for errors

---

### Step 4: Verify Repository

**Action**:
```bash
if [ "$STATUS" != "failed" ]; then
    cd "$RESOLVED_PATH" || {
        echo "Cannot access repository: $RESOLVED_PATH"
        STATUS="failed"
    }
fi

if [ "$STATUS" != "failed" ]; then
    # Verify it's a valid git repository
    if [ ! -d ".git" ]; then
        echo "Not a valid git repository"
        STATUS="failed"
    fi
fi

if [ "$STATUS" != "failed" ]; then
    # Get current state
    BRANCH=$(git branch --show-current 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || "unknown")
    COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
    COMMIT_MSG=$(git log -1 --pretty=%s 2>/dev/null || echo "")

    # Check for uncommitted changes
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
        HAS_CHANGES=true
        echo "Warning: Repository has uncommitted changes"
    else
        HAS_CHANGES=false
    fi

    # Check for requirements.txt or setup.py
    HAS_REQUIREMENTS=false
    if [ -f "requirements.txt" ] || [ -f "setup.py" ] || [ -f "pyproject.toml" ]; then
        HAS_REQUIREMENTS=true
        echo "Found dependency files"
    fi

    # Check remote URL
    REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")

    echo ""
    echo "Repository ready:"
    echo "  Path: $RESOLVED_PATH"
    echo "  Branch: $BRANCH"
    echo "  Commit: ${COMMIT:0:8}"
    echo "  Message: $COMMIT_MSG"
fi
```

**Verification**:
- Repository in expected state

## Success Criteria

- Repository exists at target path
- Correct branch/commit checked out
- No clone errors

### Example Checks

- `test -d $RESOLVED_PATH/.git`
- `git -C $RESOLVED_PATH rev-parse HEAD`

## Outputs

### Output Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | `cloned` \| `updated` \| `existing` \| `missing` \| `failed` |
| `resolvedPath` | string | Yes | Path to repository |
| `branch` | string | No | Current branch |
| `commit` | string | No | Current commit SHA |
| `hasChanges` | boolean | No | Whether uncommitted changes exist |
| `hasRequirements` | boolean | No | Whether dependency files exist |
| `error` | string | No | Error message (if status=failed) |

### Status Values

| Status | Meaning |
|--------|---------|
| `cloned` | Repository freshly cloned |
| `updated` | Existing repository updated to target state |
| `existing` | Repository already at target state, no changes needed |
| `missing` | Repository not found (invalid URL or inaccessible) |
| `failed` | Clone or update failed |

### Output Example

```json
{
  "status": "cloned",
  "resolvedPath": "/workspace/train-repo",
  "branch": "main",
  "commit": "abc123def456",
  "hasChanges": false,
  "hasRequirements": true
}
```

## Side Effects

- **Modifies**: Target repository directory, git index
- **Creates**: Repository directory and .git folder
- **Removes/Replaces**: Incomplete directories (on fresh clone)
- **Requires reboot**: No

## Important Rules

1. **Don't force overwrite**: Check existing repo before cloning
2. **Preserve local changes**: Don't reset uncommitted changes
3. **Report state**: Always output current branch/commit
4. **Dependency hint**: Note if requirements files exist
5. **Error transparency**: Report specific git errors

## Phase 1 Scope Limitations

Phase 1 scope:
- Git repo checkout
- Basic update/pull

Not in Phase 1 scope:
- pip/conda private source configuration
- wheelhouse preparation
- Complex dependency resolution
- Authentication for private repos (basic git auth only)

## Troubleshooting

### Common Issues

1. **Clone failed - authentication**
   - For private repos, ensure git credentials are configured
   - Use SSH URLs for SSH key auth: `git@github.com:user/repo.git`

2. **Clone failed - network timeout**
   - Try shallow clone: `REPO_DEPTH=1`
   - Check network connectivity

3. **Branch not found**
   - Check branch name spelling
   - List branches: `git ls-remote --heads $REPO_URL`

4. **Merge conflicts on update**
   - Check for local changes
   - May need manual resolution

5. **Permission denied**
   - Check write permissions for target directory
   - For SSH auth, verify SSH key is loaded

6. **Repository found but wrong remote**
   - The search finds repos by name, verify remote URL matches
   - Use explicit `REPO_PATH` to specify correct location