# Dispatcher 文档

## 职责

`musa_dispatch` 是所有 MUSA 操作的统一入口，负责：
- Intent 解析
- 路由决策
- 权限检查
- 操作编排

## 调度流程

```
User Request → Intent Parser → Router → Pre-check → Permission Gate → Handler
```

## 主要文件

| 文件 | 职责 |
|------|------|
| `src/dispatcher/index.ts` | 主入口 |
| `src/dispatcher/intent-parser.ts` | Intent 解析 |
| `src/dispatcher/router.ts` | 路由逻辑 |
| `src/dispatcher/permission-gate.ts` | 权限检查 |
| `src/dispatcher/orchestrator.ts` | 编排执行 |

---

> 完整设计见 `docs/platform-evolution-roadmap.md`。