---
version: 1
name: <skill_name>
description: <One-line description>

category: <env|assets>
kind: atomic
exposure: <user|internal>
risk_level: <safe|idempotent|destructive>
execution_mode: remote

owners:
  - <team>

triggers:
  - <trigger phrase 1>
  - <trigger phrase 2>
---

# <Skill Name>

<Brief description of what this skill does.>

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `<VAR>` | Description | Yes/No | Default |

## Workflow

### Step 1: <Step Name>

```bash
# Bash commands
```

Verification: <what to check>

---

### Step 2: <Step Name>

...

## Success Criteria

- <Criterion 1>
- <Criterion 2>

## Troubleshooting

1. **Issue** - Solution