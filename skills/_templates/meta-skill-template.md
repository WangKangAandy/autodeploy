---
version: 1
name: <skill_name>
description: |
  <Brief description of what this meta skill orchestrates>

# Registry metadata (aligned with skills/index.yml)
category: env | assets | workload | benchmark | migration
kind: meta
exposure: user | internal
risk_level: safe | idempotent | destructive
execution_mode: local | remote | container | mixed
depends_on:
  - <atomic_skill_1>
  - <atomic_skill_2>

owners:
  - <team_or_person>

triggers:
  - <trigger phrase 1>
  - <trigger phrase 2>

scope:
  includes:
    - <what this skill handles>
  excludes:
    - <what this skill does NOT handle>

orchestration_mode: sequential | parallel | conditional | fan_out
failure_policy: fail_fast | best_effort | continue_on_safe_failure
---

# <Skill Name> (Meta Skill)

<One-line summary of the meta skill's purpose>

This is a **meta skill** that orchestrates atomic skills. It does not execute commands directly, but coordinates atomic skills in sequence.

## Orchestration

Step sequence and purpose only. Detailed execution logic is in Workflow section.

```
1. <atomic_skill_1> → <one-line purpose>
2. <atomic_skill_2> → <one-line purpose>
3. <atomic_skill_3> → <one-line purpose>
```

## Invocation

- **Exposure**: user | internal
- **Top-level intent**: `<intent>`
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
- <When to use a different skill instead>

## Source Of Truth

- <Reference documents or config files>
- <SDK/driver compatibility mapping>

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `<INPUT_1>` | <description> | Yes/No | <default_value> |

## Input / Output Mapping

This section defines how outputs from one atomic skill become inputs to the next. This is the core of orchestration wiring.

| From | To | Description |
|------|----|-------------|
| `<atomic_skill_1>.output.<field>` | `<atomic_skill_2>.input.<field>` | <what this mapping does> |
| `<atomic_skill_2>.output.<field>` | `<atomic_skill_3>.input.<field>` | <what this mapping does> |
| `context.<field>` | `<atomic_skill_1>.input.<field>` | Initial context injection |

### Example

```
ensure_musa_driver.output.driverVersion → validate_musa_container_environment.input.driverVersion
context.DOCKER_IMAGE → prepare_runtime_image.input.DOCKER_IMAGE
prepare_runtime_image.output.imageId → validate_musa_container_environment.input.imageId
```

## Execution Mode

<when each mode applies - brief description>

| Mode | Behavior |
|------|----------|
| `local` | Execute all atomic skills directly on host |
| `remote` | Execute all atomic skills via SSH on remote host |
| `container` | Execute atomic skills inside Docker container |
| `mixed` | Different atomic skills may use different modes |

## State Persistence

State file: `./.<skill_name>_state.json`

### State Values

- `initialized` - Skill started, variables collected
- `<step_1>_completed` - <atomic_skill_1> completed
- `<step_2>_completed` - <atomic_skill_2> completed
- `completed` - All steps completed successfully
- `failed_at_<step_1>` - <atomic_skill_1> failed
- `failed_at_<step_2>` - <atomic_skill_2> failed

## Resume Behavior

- **Resume supported**: Yes/No
- **Resume from states**:
  - `<step_1>_completed` → continue from step 2
  - `<step_2>_completed` → continue from step 3

## Workflow

### Step 1: Collect Inputs

**Action**:
```bash
# Read from config or prompt user
```

**Save state**: `initialized`

**Verification**:
- All required inputs collected

---

### Step 2: Execute <atomic_skill_1>

**Action**:
```
Call <atomic_skill_1>
  → Input: <inputs>
  → Output: <expected outputs>
```

**Save state**: `<step_1>_completed`

**Verification**:
- <atomic_skill_1> returned status `completed`
- Expected outputs present

---

### Step 3: Execute <atomic_skill_2>

**Action**:
```
Call <atomic_skill_2>
  → Input: <inputs + outputs from step 1>
  → Output: <expected outputs>
```

**Save state**: `<step_2>_completed`

**Verification**:
- <atomic_skill_2> returned status `completed`
- Expected outputs present

---

### Step 4: Final Summary

**Action**:
```bash
# Output final summary
```

**Save state**: `completed`

**Verification**:
- All steps completed successfully

## Error Handling

System behavior when atomic skill fails (per `failure_policy`):

1. Save checkpoint to state file with `failed_at_<step>`
2. Report which skill failed and error details
3. Retry semantics: <automatic retry / manual retry / abort>

```
Error in step 2 (<atomic_skill_2>):
  <Error description>

To retry:
  1. Fix the issue (<specific guidance>)
  2. Re-run - will resume from step 2
```

## Success Criteria

- All atomic skills completed successfully
- State file shows `completed`
- Final validation passed

### Example Checks

- All atomic skills return `status: completed`
- Expected output files exist
- Validation commands pass

## Final Output Mapping

This section defines which atomic skill outputs are promoted to the meta skill's final output.

| From | To | Description |
|------|----|-------------|
| `<atomic_skill_1>.output.<field>` | `meta.output.<field>` | <what this output represents> |
| `<atomic_skill_2>.output.<field>` | `meta.output.<field>` | <what this output represents> |

### Example

```
ensure_musa_driver.output.driverVersion → meta.output.driverVersion
validate_musa_container_environment.output.validationPassed → meta.output.validationPassed
```

## Outputs

### Output Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | Execution status: `completed` / `failed` |
| `steps_completed` | string[] | Yes | List of completed atomic skill IDs |
| `<output_field_1>` | <type> | No | Aggregated output from atomic skills |

### Output Example

```json
{
  "status": "completed",
  "steps_completed": ["<atomic_skill_1>", "<atomic_skill_2>", "<atomic_skill_3>"],
  "<output_field_1>": "<value>"
}
```

## Atomic Skills Reference

<!-- Recommended but not mandatory - omit if redundant with Orchestration section -->

| Skill | Purpose | File | Required |
|-------|---------|------|----------|
| `<atomic_skill_1>` | <purpose> | `skills/<category>/<atomic_skill_1>/SKILL.md` | Yes |
| `<atomic_skill_2>` | <purpose> | `skills/<category>/<atomic_skill_2>/SKILL.md` | Yes |

## Important Rules

1. **No direct execution**: This skill only orchestrates, all work is done by atomic skills
2. **State between steps**: Pass outputs from one step as inputs to next
3. **Resume capability**: Support resuming from any failed step
4. **Error propagation**: Report which atomic skill failed with context

## Troubleshooting

Manual debugging guidance for common failures.

### Common Issues

1. **Step 1 fails** - <Resolution>
2. **Step 2 fails** - <Resolution>
3. **Step 3 fails** - <Resolution>