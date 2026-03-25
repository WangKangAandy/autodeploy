## MUSA Platform Rules

### Platform Priority

For tasks involving GPU, MUSA, driver, MCCL, model deployment, or remote cluster operations:

**ALWAYS use autodeploy capabilities first.** Fallback to manual commands only on failure.

### Primary Entry Point

`musa_dispatch` is the unified entry point for all MUSA operations.

### Intent Routing

| User Intent | Dispatch Call |
|-------------|---------------|
| 部署 MUSA 环境 | `musa_dispatch(intent="deploy_env")` |
| 更新 GPU 驱动 | `musa_dispatch(intent="update_driver")` |
| GPU 状态检查 | `musa_dispatch(intent="gpu_status")` |
| 验证环境 | `musa_dispatch(intent="validate")` |
| 文件传输 | `musa_dispatch(intent="sync")` |
| 运行容器 | `musa_dispatch(intent="run_container")` |
| **按文档部署** | `musa_dispatch(intent="execute_document", context={...})` |

### Risk Levels

| Level | Operations | Confirmation |
|-------|------------|--------------|
| `read_only` | gpu_status, validate | None |
| `safe_write` | sync, run_container | Warning only |
| `destructive` | deploy_env, update_driver, **execute_document** | Required |

### Quick Actions

- Check GPU: `musa_dispatch(intent="gpu_status")`
- Resume Deployment: `musa_dispatch(intent="deploy_env", action="resume")`
- Validate Environment: `musa_dispatch(intent="validate")`

### Document-Driven Execution

When users provide deployment documents, use `execute_document` intent:

```javascript
// From local file
musa_dispatch(intent="execute_document", context={path: "/path/to/deploy.md"})

// From pasted content
musa_dispatch(intent="execute_document", context={content: "# Guide\n..."})

// Resume execution
musa_dispatch(intent="execute_document", action="resume", context={operationId: "op_xxx"})
```

**Parameter Rules:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `path` | One of path/content | Local document file path |
| `content` | One of path/content | Pasted document content |
| `operationId` | Required for resume | Operation ID to resume |

- `path` and `content` are **mutually exclusive** - provide exactly one
- If both provided, `path` takes priority
- If neither provided, returns error

**Risk Handling:**
- Entry level: treated as `destructive`, requires user confirmation
- Step level: each step's risk level shown separately in Plan Review (read_only / safe_write / destructive)

**Supported Sources (Stage 1A):**
- Local files (`path` parameter)
- Pasted content (`content` parameter)

**Trigger Patterns (Conservative):**
- "按文档部署" / "execute from document"
- "执行文档" / "execute document"
- "根据文档部署" / "deploy from document"

**Execution Flow:**
1. **Load** → Load document
2. **Parse** → Extract phases and steps
3. **Plan** → Generate execution plan
4. **Safety** → Validate against safety rules
5. **Review** → User confirmation (awaiting_input)
6. **Execute** → Execute steps

**Internal Dispatch Mode:**

When a step requires calling existing skills (e.g., `deploy_env`), internal dispatch is used:
- Does NOT re-trigger top-level permission gate / plan review / operation creation
- Still performs necessary prechecks and validation
- Reuses parent operation context

**Note:** Feishu/Dingding document sources are Stage 1B (not currently supported).

**Details:** See `references/document-driven-execution.md`

### Fallback Behavior

If `musa_dispatch` fails:
1. Try direct tool calls: `musa_exec`, `musa_docker`, `musa_sync`
2. Execute manual commands as last resort
