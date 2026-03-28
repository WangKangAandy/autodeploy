---
version: 1
name: <skill_name>
description: |
  <Brief description of what this skill does>

# Registry metadata (aligned with skills/index.yml)
category: env | assets | workload | benchmark | migration
kind: atomic
exposure: user | internal
risk_level: safe | idempotent | destructive
execution_mode: local | remote | container | mixed
depends_on:
  - <skill_id_1>  # Optional: skills that must run before this one

owners:
  - <team_or_person>

triggers:
  - <trigger phrase 1>
  - <trigger phrase 2>

# Keep scope concise - list only what this skill handles/doesn't handle
scope:
  includes:
    - <what this skill handles>
  excludes:
    - <what this skill does NOT handle>
---

# <Skill Name>

<One-line summary of the skill's purpose>

## Invocation

- **Exposure**: user | internal
- **Top-level intent**: `<intent>` or `none`
- **Callable from orchestration**: Yes/No

### Invocation Example

```
musa_dispatch(intent="<intent>", context={
  "<INPUT_1>": "<value>",
  "<INPUT_2>": "<value>"
})
```

## When To Use This Skill

- <Use case 1>
- <Use case 2>

## When Not To Use This Skill

- <Case where this skill is not appropriate>

## Source Of Truth

- <Reference documents or config files>

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `<INPUT_1>` | <description> | Yes/No | <default_value> |

## Privileges Required

- **Sudo**: Yes/No
- **Remote access**: Yes/No
- **Docker access**: Yes/No
- **Network access**: Yes/No

## Execution Mode

<when each mode applies - brief description>

| Mode | Behavior |
|------|----------|
| `local` | Execute directly on host |
| `remote` | Execute via SSH on remote host |
| `container` | Execute inside Docker container |
| `mixed` | Combination of above |

## State Persistence

State file: `./.<skill_name>_state.json`

### State Values

- `initialized` - <meaning>
- `<state_2>` - <meaning>
- `completed` - All steps completed

## Idempotency

- **Idempotent**: Yes/No/Partial
- **Re-run behavior**: <what happens if called again>

## Resume Behavior

- **Resume supported**: Yes/No
- **Resume from states**:
  - `<state_1>` → skip to step X
  - `<state_2>` → continue from step Y

## Workflow

### Step 1: <Step Name>

**Action**:
```bash
# Commands or instructions
```

**Save state**: `<state_value>`

**Verification**:
- <how to verify this step succeeded>

---

### Step 2: <Step Name>

**Action**:
```bash
# Commands or instructions
```

**Save state**: `<state_value>`

**Verification**:
- <how to verify this step succeeded>

---

## Success Criteria

- <criterion 1>
- <criterion 2>

### Example Checks

- Command exits with code 0
- Expected file/path exists
- Validation command passes

## Outputs

### Output Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | Execution status: `completed` / `failed` |
| `<field_1>` | <type> | Yes/No | <description> |
| `<field_2>` | <type> | No | <description> |

### Output Example

```json
{
  "status": "completed",
  "<field_1>": "<value>",
  "<field_2>": "<value>"
}
```

## Side Effects

<!-- Required for destructive skills, optional for safe/idempotent -->

- **Modifies**: <files/services/packages>
- **Creates**: <directories/files>
- **Removes/Replaces**: <packages/modules>
- **Requires reboot**: Yes/No

## Important Rules

1. <Rule 1>
2. <Rule 2>

## Troubleshooting

### Common Issues

1. **<Issue>** - <Resolution>