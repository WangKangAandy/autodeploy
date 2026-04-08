# Tracing 文档

## TraceId 来源

| 入口 | TraceId |
|------|---------|
| 飞书消息 | messageId |
| 钉钉消息 | messageId |
| API/CLI | 无 |

## 日志位置

| 日志 | 路径 |
|------|------|
| 工具执行 | plugin logs |
| 工具记录 | `autodeploy/tool-executions.json` |

## 调试命令

```bash
# 查看最近 5 次工具执行
cat autodeploy/tool-executions.json | jq '.[-5:]'

# 搜索日志中的 traceId
grep "\[TRACE:<id>\]" ~/.openclaw/logs/plugin.log
```

## 主要文件

- `src/index.ts` - getLarkTicket(), formatTracePrefix()