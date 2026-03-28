# Document-Driven Execution

## Overview

The `execute_document` intent provides document-driven orchestration capabilities:

- Parse deployment documents to extract execution plans
- Validate commands against safety rules
- Plan Review stage ensures user confirmation
- Support for checkpoint resume

## Current Support (Stage 1A)

| Source | Parameter | Example |
|--------|-----------|---------|
| Local file | `path` | `{path: "/path/to/deploy.md"}` |
| Pasted content | `content` | `{content: "# Guide\n..."}` |

**Stage 1B (Future):** Feishu/Dingding document sources

## Usage

### Parameter Rules

| Parameter | Required | Description |
|-----------|----------|-------------|
| `path` | One of path/content | Local document file path |
| `content` | One of path/content | Pasted document content |
| `operationId` | Required for resume | Operation ID to resume |

**Rules:**

- `path` and `content` are **mutually exclusive** - provide exactly one
- If both provided, `path` takes priority
- If neither provided, returns error

### Examples

**From local file:**

```javascript
musa_dispatch(intent="execute_document", context={path: "/path/to/deploy.md"})
```

**From pasted content:**

```javascript
musa_dispatch(intent="execute_document", context={content: "# Deployment Guide\n..."})
```

**Resume execution:**

```javascript
musa_dispatch(intent="execute_document", action="resume", context={operationId: "op_xxx"})
```

## Document Format

For optimal parsing, documents should include:

1. **Phase headers**: `## Phase 1: xxx` or `## 阶段1: xxx`
2. **Code blocks**: Bash/shell code blocks with language identifier
3. **Metadata tables**: SDK version, driver version, etc.

Example:

```markdown
# Deployment Guide

## Environment Info

| Item | Value |
|------|-------|
| SDK Version | 4.3.5 |
| Driver Version | 3.3.5 |

## Phase 1: Base Environment

```bash
sudo apt update
sudo apt install -y python3
```

## Phase 2: Validation

```bash
mthreads-gmi
```
```

## Execution Flow

```
Load → Parse → Plan → Safety → Review → Execute
```

| Stage | Description |
|-------|-------------|
| Load | Load document content |
| Parse | Extract phases and steps |
| Plan | Generate execution plan |
| Safety | Validate against safety rules |
| Review | User confirmation |
| Execute | Execute steps sequentially |

## Risk Handling

- **Entry level**: Treated as `destructive` - requires user confirmation
- **Step level**: Each step's risk level shown separately in Plan Review

| Risk Level | Examples |
|------------|----------|
| `read_only` | Query commands (mthreads-gmi, curl, ls) |
| `safe_write` | File operations (mkdir, cp, huggingface-cli) |
| `destructive` | System changes (apt install, dpkg, docker run) |

## Internal Dispatch

When a step requires calling existing skills:

- Does NOT re-trigger top-level permission gate / plan review / operation creation
- Still performs necessary prechecks and validation
- Reuses parent operation context

This allows `execute_document` to orchestrate `deploy_env` or `update_driver` skills without duplicating safety checks.

## State Persistence

Execution state is persisted by State Manager to the document execution state store.

**State Model:**

```
Operation (primary state machine)
    └── DocumentExecutionState (extended state)
            └── PhaseState[]
                    └── StepState[]
```

The context-builder derives runtime view from these states for display.

## Architecture Positioning

`execute_document` is an **orchestration intent**, not a skill:

- Does not add new business skills
- Orchestrates existing skills (deploy_env, update_driver) or executes commands directly
- Belongs to the dispatcher entry layer, not the skill layer

This separation ensures:
- Single source of truth for infrastructure deployment (existing skills)
- Document parsing is a meta-layer above skills
- Clear boundary between "what to do" (document) and "how to do it" (skills/tools)