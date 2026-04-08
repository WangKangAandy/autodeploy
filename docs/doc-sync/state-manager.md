# State Manager 文档

## 职责

`src/core/state-manager.ts` 提供部署操作的持久化管理。

## 状态域

| 状态域 | 文件 | 内容 |
|--------|------|------|
| Hosts | `hosts.json` | 主机配置、SSH 凭据 |
| Tool Executions | `tool-executions.json` | 最近工具执行记录 |

## 主要方法

| 方法 | 用途 |
|------|------|
| `registerHost()` | 注册/更新主机 |
| `getDefaultHost()` | 获取默认主机 |
| `setDefaultHost()` | 设置默认主机 |
| `getExecutionMode()` | 获取执行模式 (local/remote) |
| `recordToolExecution()` | 记录工具执行 |
| `loadSnapshot()` | 加载上下文快照 |

## 持久化位置

所有状态文件存储在 `autodeploy/` 目录。