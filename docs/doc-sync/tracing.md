# Tracing 文档

## TraceId 来源

| 入口 | TraceId |
|------|---------|
| 飞书消息 | messageId |
| 钉钉消息 | messageId |
| API/CLI | 自动生成 |

## 日志位置

| 日志 | 路径 |
|------|------|
| 工具执行 | `.claude/remote-exec.log` |
| 操作状态 | `autodeploy/operations.json` |

## 调试命令

```bash
grep "traceId.*<id>" .claude/remote-exec.log
cat autodeploy/operations.json | jq '.[] | select(.traceId == "<id>")'
```

## 主要文件

- `src/shared/trace.ts` - 追踪框架
- `src/shared/logger.ts` - 结构化日志
- `src/shared/lark-ticket.ts` - 飞书票据