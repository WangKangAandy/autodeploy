## MUSA Platform Rules

### Platform Identity

You are operating within the **openclaw-musa** platform runtime layer. This plugin provides:

1. **Unified Dispatcher** — `musa_dispatch` is the single entry point for all MUSA operations
2. **Skill Catalog** — Pre-built automation skills for environment, assets, and workloads
3. **State Persistence** — Deployment progress saved to `autodeploy/` for recovery
4. **Full-Chain Tracing** — Every operation has a `traceId` for debugging

### Decision Priority

When user requests involve GPU, MUSA, model/dataset download, or remote operations:

```
1. Use musa_dispatch with appropriate intent → 2. Use musa_* tools directly → 3. Manual commands
```

**ALWAYS start with `musa_dispatch`.** Direct tools and manual commands are fallbacks only.

### Intent Routing (Complete)

| User Intent | Dispatch Call |
|-------------|---------------|
| 部署 MUSA 环境 / deploy MUSA | `musa_dispatch(intent="deploy_env")` |
| 更新 GPU 驱动 / update driver | `musa_dispatch(intent="update_driver")` |
| GPU 状态检查 | `musa_dispatch(intent="gpu_status")` |
| 验证环境 | `musa_dispatch(intent="validate")` |
| **下载模型 / download model** | `musa_dispatch(intent="prepare_model", context={MODEL_NAME: "..."})` |
| **下载数据集 / download dataset** | `musa_dispatch(intent="prepare_dataset", context={DATASET_NAME: "..."})` |
| **准备安装包** | `musa_dispatch(intent="prepare_package", context={PACKAGE_TYPE: "driver", VERSION: "..."})` |
| **克隆仓库** | `musa_dispatch(intent="prepare_repo", context={REPO_URL: "..."})` |
| 文件传输 | `musa_dispatch(intent="sync")` |
| 运行容器 | `musa_dispatch(intent="run_container")` |
| 按文档部署 | `musa_dispatch(intent="execute_document", context={path: "..."})` |

### Risk Levels

| Level | Operations | Confirmation |
|-------|------------|--------------|
| `read_only` | gpu_status, validate | None |
| `safe_write` | sync, run_container, prepare_* | Warning only |
| `destructive` | deploy_env, update_driver, execute_document | Required |

### Quick Actions

```javascript
// Check GPU status
musa_dispatch(intent="gpu_status")

// Download model (supports HuggingFace and ModelScope)
musa_dispatch(intent="prepare_model", context={MODEL_NAME: "Qwen/Qwen2-7B", MODEL_SOURCE: "modelscope"})

// Resume interrupted deployment
musa_dispatch(intent="deploy_env", action="resume")

// Execute from deployment document
musa_dispatch(intent="execute_document", context={path: "/path/to/deploy.md"})
```

### Debugging with TraceId

When investigating issues from Feishu/Dingding:

```bash
# 1. Get messageId from Feishu message URL

# 2. Search logs by traceId (= messageId)
grep "traceId.*<messageId>" .claude/remote-exec.log
cat autodeploy/operations.json | jq '.[] | select(.traceId == "<messageId>")'
```

Log locations:
- Tool execution: `.claude/remote-exec.log`
- State persistence: `autodeploy/operations.json`, `autodeploy/jobs.json`

### Document-Driven Execution

```javascript
// From local file
musa_dispatch(intent="execute_document", context={path: "/path/to/deploy.md"})

// From pasted content
musa_dispatch(intent="execute_document", context={content: "# Guide\n..."})

// Resume execution
musa_dispatch(intent="execute_document", action="resume", context={operationId: "op_xxx"})
```

**Execution Flow:** Load → Parse → Plan → Safety → Review → Execute

### Fallback Behavior

If `musa_dispatch` fails:
1. Try direct tool calls: `musa_exec`, `musa_docker`, `musa_sync`
2. Execute manual commands as last resort