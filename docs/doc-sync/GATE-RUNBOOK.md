# Doc Sync Gate Runbook

本文档定义文档守门 subagent 的执行流程。

## 输入

- changed_files: 变更的文件列表
- git_diff_summary: 变更摘要
- docs/doc-sync/DOC-MAP.yml: 映射表
- docs/doc-sync/UPDATE-RULES.md: 判定规则

## 执行步骤

```
1. Match    → 将 changed_files 与 DOC-MAP.yml 匹配
2. Collect  → 收集 impacted_docs 和 severity
3. Evaluate → 判断行为/配置/状态/trace 是否变化
4. Apply    → 应用 UPDATE-RULES.md 判定
5. Decide   → 输出 PASS / WARN / BLOCK
```

## 输出格式

```json
{
  "matched_rules": ["state-manager-docs"],
  "impacted_docs": ["docs/doc-sync/state-manager.md"],
  "severity": "high",
  "behavior_changed": true,
  "docs_updated": false,
  "no_update_reason": null,
  "verdict": "BLOCK",
  "rationale": "状态字段新增 is_active，属于外部可见变化，文档未更新"
}
```

## 不确定时的处理

如果 subagent 无法确定 verdict：

1. 返回 `verdict: "WARN"`
2. 返回 `needs_manual_decision: true`
3. 返回 `uncertainty_rationale` 说明不确定原因
4. 主 agent 必须补充说明、补文档或显式 override

示例：

```json
{
  "matched_rules": ["state-manager-docs"],
  "impacted_docs": ["docs/doc-sync/state-manager.md"],
  "severity": "high",
  "behavior_changed": null,
  "docs_updated": false,
  "no_update_reason": "内部实现调整",
  "verdict": "WARN",
  "needs_manual_decision": true,
  "uncertainty_rationale": "无法确定状态字段变化是否影响外部行为，需人工确认"
}
```

## Verdict 决策树

```
命中规则？
├── 否 → PASS
└── 是
    ├── severity = high？
    │   ├── 行为变化 + 文档未更新/理由不成立 → BLOCK
    │   ├── 缺少必要说明 → BLOCK
    │   └── 其他 → WARN 或 PASS
    ├── severity = medium？
    │   ├── 行为变化 + 文档未更新 → WARN
    │   └── 其他 → PASS
    └── severity = low？
        ├── 行为变化 + 文档未更新 → WARN
        └── 其他 → PASS
```