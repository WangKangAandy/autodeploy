# State Manager 文档

## 职责

`src/core/state-manager.ts` 提供部署操作的持久化管理。

## 状态域

| 状态域 | 文件 | 内容 |
|--------|------|------|
| Hosts | `hosts.json` | 主机配置 |
| Operations | `operations.json` | 操作记录 |
| Jobs | `jobs.json` | 任务进度 |
| Deployment | `state.json` | 部署进度 |

## Operation 生命周期

```
pending → running → completed / failed / cancelled
              ↓
         awaiting_input
```

## 持久化位置

所有状态文件存储在 `autodeploy/` 目录。