## MUSA Platform Rules

### Runtime platform

This workspace runs on the **openclaw-musa** plugin runtime (not your self-intro Name — use `IDENTITY.md` Name/Role for that). This plugin provides:

1. **Skill Catalog** — Pre-built automation skills for environment, assets, and workloads
2. **State Persistence** — Deployment progress saved to `autodeploy/` for recovery
3. **Full-Chain Tracing** — Every operation has a `traceId` for debugging

### Decision Priority

When user requests involve GPU, MUSA, model/dataset download, or remote operations:

```
1. Use musa_* tools → 2. Manual commands
```

### Tool Routing

| Target | Tool |
|--------|------|
| Get/set deployment mode | `musa_mode` |
| Host commands (dpkg, systemctl, driver checks) | `musa_exec` |
| Docker exec/run | `musa_docker` |
| File transfer local ↔ remote | `musa_sync` |

### Execution Contract (for document-driven deployment)

When executing deployment documents, follow these rules:

**Execution Rules (MUST follow)**

1. **No early exit**: Execute ALL steps in the document. Do NOT stop at the first failure.
2. **Fix before giving up**: If a step fails (file not found, command error, path mismatch):
   - Search for alternatives (e.g., `find /data -name "ModelName*" -maxdepth 3`)
   - Try common path variations
   - Check environment variables
   - Only report as blocked if 3+ attempts fail on the same step
3. **Verify each step**: After each command, check the output matches expectations.
4. **Adapt paths**: Document paths may not match the actual filesystem. Always verify and adapt.
5. **Report progress**: After completing each major section, briefly state what was done.
6. 

**Stop conditions (ONLY these allow stopping)**

- Remote machine is unreachable (SSH connection failed)
- User explicitly says "stop" or "cancel"
- A step requires credentials/permissions you don't have (after asking user)

### Shell Execution Rule

SKILL.md bash snippets are **multi-line script fragments**. When executing via `musa_exec`:

- Pass the entire step as a multi-line script string
- **Never** join `if/fi`, `case/esac`, or loops with `&&` on a single line
- Control structures require newlines or semicolons between clauses


### Tool Calling Workflow
After calling any tool and receiving results, immediately synthesize the information and fully answer the user's original question. Do not stop and wait for the user to prompt again.
**Rule**: Calling a tool is always an intermediate step — finish the answer before expecting user input.



### Debugging with TraceId

When investigating issues from Feishu/Dingding:

```bash
# 1. Get messageId from Feishu message URL

# 2. Check tool executions for debugging
cat autodeploy/tool-executions.json | jq '.[-5:]'
```

Log locations:

- Host credentials: `autodeploy/hosts.json`
- Tool executions: `autodeploy/tool-executions.json`