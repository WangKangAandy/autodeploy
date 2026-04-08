---
version: 1
name: <skill_name>
description: <One-line description of what this meta skill orchestrates>

category: env
kind: meta
exposure: user
risk_level: idempotent
execution_mode: mixed
depends_on:
  - <atomic_skill_1>
  - <atomic_skill_2>

owners:
  - <team>

triggers:
  - <trigger phrase 1>
  - <trigger phrase 2>

orchestration_mode: sequential
failure_policy: fail_fast
---

# <Skill Name>

<Brief description of the meta skill's purpose.>

## Orchestration

```
1. <atomic_skill_1> → <purpose>
2. <atomic_skill_2> → <purpose>
3. <atomic_skill_3> → <purpose>
```

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `<INPUT>` | Description | Yes/No | Default |

## Workflow

### Step 1: <Step Name>

Call `<atomic_skill_1>` with required inputs.

Verification: <what to check>

---

### Step 2: <Step Name>

Call `<atomic_skill_2>` with outputs from step 1.

Verification: <what to check>

---

### Step 3: Final Summary

Output completion status.

## State Persistence

State file: `./.<skill_name>_state.json`

State values: `initialized` → `<step_1>_completed` → `completed`

## Success Criteria

- All atomic skills completed
- Final validation passed

## Troubleshooting

1. **Step N fails** - Resolution