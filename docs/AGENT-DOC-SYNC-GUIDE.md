# AI Agent 自主开发场景下的文档同步指南

## 1. 问题定义

### 1.1 传统开发流程 vs Agent 自主开发

| 维度 | 传统开发 | Agent 自主开发 |
|------|----------|----------------|
| 执行者 | 人类开发者 | AI Agent |
| 审查流程 | PR Review + 人工检查 | Agent 自主决策 |
| 文档责任 | 作者自觉 + Reviewer 提醒 | 无明确责任方 |
| 漏文档后果 | Reviewer 打回 | 可能直接合并 |

### 1.2 为什么 Agent 更容易漏文档

1. **缺乏上下文感知**：Agent 专注于代码变更，对"文档影响范围"缺乏直觉判断
2. **没有"作者自觉"机制**：传统流程依赖人类开发者填写 PR 模板，Agent 模式下这个环节缺失
3. **优化目标单一**：Agent 通常以"代码通过测试"为目标，文档不在优化目标内
4. **缺乏长期责任约束**：Agent 缺乏稳定的长期责任约束机制，无法像人类开发者那样通过历史反馈逐步形成文档同步习惯

---

## 2. 传统方案为何失效

### 2.1 PR 模板的局限

传统 PR 模板长这样：

```markdown
## Documentation Impact
- [ ] 已检查文档是否需要更新
- [ ] 文档已更新 / 无需更新
```

问题：
- **依赖自觉**：人类可能顺手勾选，Agent 更不可能主动填写
- **缺乏判定标准**：什么叫"需要更新"？没有明确规则
- **没有强制执行**：勾选后不更新，也没有自动拦截

### 2.2 CODEOWNERS 的局限

CODEOWNERS 可以要求特定人 review 文档变更，但：
- 只能针对文件路径，不能针对"行为变化"
- 无法判断"代码变更是否影响文档"
- 依赖人工 review，无法自动化

### 2.3 "作者自觉"依赖的脆弱性

传统流程的隐含假设：

```
作者改代码 → 作者意识到文档影响 → 作者更新文档 → Reviewer 检查
```

Agent 模式下这个链条断裂：

```
Agent 改代码 → ??? → ??? → ???
```

---

## 3. 解决方案：主 Agent + 文档守门 Subagent

### 3.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      主 Agent                                │
│  职责：开发代码、跑测试、生成变更摘要                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   文档守门 Subagent                          │
│  职责：检查文档影响、判定是否需要更新、输出裁决结果            │
│                                                              │
│  输入：                                                      │
│  - 变更文件列表                                              │
│  - 变更摘要                                                  │
│  - DOC-MAP.yml（映射表）                                     │
│  - UPDATE-RULES.md（判定规则）                               │
│                                                              │
│  输出：                                                      │
│  - matched_rules: 命中的规则                                  │
│  - impacted_docs: 受影响的文档                                │
│  - verdict: PASS / WARN / BLOCK                              │
│  - rationale: 裁决理由                                       │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 流程设计

```
1. 主 Agent 完成开发
   ├── 改代码
   ├── 跑测试
   └── 生成变更摘要

2. 自动触发文档守门 Subagent
   └── 不负责写代码，只回答 3 个问题：
       ├── 这次改动命中了 DOC-MAP.yml 哪些规则？
       ├── 对应文档是否需要更新？
       └── 如果主 Agent 说"不需要更新"，这个理由是否成立？

3. Subagent 输出结构化结果
   ├── verdict: PASS / WARN / BLOCK
   └── 主 Agent 必须处理这个裁决

4. 裁决处理
   ├── PASS → 继续
   ├── WARN → 主 Agent 补充说明或显式确认
   └── BLOCK → 主 Agent 必须更新文档后才能继续
```

### 3.3 与传统方案的对比

| 维度 | 传统方案 | Agent + Subagent 方案 |
|------|----------|----------------------|
| 责任方 | 作者自觉 | 专职 Subagent |
| 判定依据 | 模糊的自觉 | 明确的规则文件 |
| 执行时机 | PR 阶段 | 开发完成后立即 |
| 强制力 | 依赖 Reviewer | 可配置 BLOCK |

---

## 4. 核心机制

### 4.1 DOC-MAP.yml - 机器可读映射

定义代码与文档的关联关系：

```yaml
# 文档-代码映射表
mappings:
  - name: state-manager-docs
    code:
      - "src/core/state-manager.ts"
    docs:
      - "docs/state-manager.md"
    check: "状态字段、持久化逻辑、生命周期变化时更新"
    severity: "high"
    examples:
      must_update:
        - "新增或删除状态字段"
        - "修改持久化文件格式"
      usually_no_update:
        - "重构内部辅助方法"

  - name: api-docs
    code:
      - "src/api/**/*.ts"
    docs:
      - "docs/api.md"
    check: "接口签名、参数、返回值变化时更新"
    severity: "high"
    examples:
      must_update:
        - "新增或删除 API 端点"
        - "修改请求/响应参数"
      usually_no_update:
        - "修改内部实现细节"
```

**关键字段说明：**

| 字段 | 说明 |
|------|------|
| `name` | 规则名称 |
| `code` | 代码路径模式（支持 glob） |
| `docs` | 对应的文档路径 |
| `check` | 何时需要更新的自然语言描述 |
| `severity` | high / medium / low |
| `examples.must_update` | 必须更新的典型场景 |
| `examples.usually_no_update` | 通常无需更新的场景 |

### 4.2 UPDATE-RULES.md - 判定标准 + Verdict 规则

定义如何判定是否需要更新文档，以及裁决输出：

```markdown
# 文档更新判定规则

## 无需更新文档的情况

- 仅重命名局部变量或内部函数
- 仅调整内部实现，且外部行为不变
- 仅修改测试文件
- 仅修改注释或示例（不改变行为）

## 必须更新文档的情况

| 变更类型 | 说明 |
|----------|------|
| 接口/函数签名变化 | 外部可见的行为变化 |
| 配置项增删改 | 影响用户配置 |
| 状态字段变化 | 影响数据持久化 |
| 核心流程变化 | 影响系统行为 |

## Gate Verdict Rules

### PASS
- 未命中任何 DOC-MAP 规则
- 命中规则且相关文档已正确更新
- 命中规则但依据本文件可明确判定无需更新

### WARN
- 命中 medium/low severity 规则，文档未更新，但影响较小
- 存在合理不确定性

### BLOCK
**默认 BLOCK 条件（三者同时满足）：**
1. high severity
2. 且发生外部可见行为变化
3. 且相关文档未更新或"不更新理由"不成立

**也可 BLOCK 的异常情况：**
- 命中高风险规则但缺少必要说明
- 文档路径明显错误或缺失
- 更新文档与命中规则不匹配
```

### 4.3 GATE-RUNBOOK.md - Subagent 执行手册

定义 Subagent 的执行流程：

```markdown
# Doc Sync Gate Runbook

## 输入
- changed_files: 变更的文件列表
- git_diff_summary: 变更摘要
- DOC-MAP.yml: 映射表
- UPDATE-RULES.md: 判定规则

## 执行步骤
1. Match    → 将 changed_files 与 DOC-MAP.yml 匹配
2. Collect  → 收集 impacted_docs 和 severity
3. Evaluate → 判断是否发生外部可见行为变化
4. Apply    → 应用 UPDATE-RULES.md 判定
5. Decide   → 输出 PASS / WARN / BLOCK

## 输出格式
{
  "matched_rules": ["state-manager-docs"],
  "impacted_docs": ["docs/state-manager.md"],
  "severity": "high",
  "behavior_changed": true,
  "docs_updated": false,
  "verdict": "BLOCK",
  "rationale": "状态字段新增 is_active，属于外部可见变化，文档未更新"
}

## 不确定时的处理
如果无法确定 verdict：
1. 返回 verdict: "WARN"
2. 返回 needs_manual_decision: true
3. 给出 uncertainty_rationale
```

---

## 5. Verdict 决策模型

### 5.1 PASS / WARN / BLOCK 条件

| Verdict | 条件 | 后续动作 |
|---------|------|----------|
| **PASS** | 未命中规则，或已更新文档，或明确无需更新 | 继续 |
| **WARN** | medium/low + 不确定，或需人工确认 | 补充说明或显式确认 |
| **BLOCK** | high + 行为变化 + 文档未更新，或异常情况 | 必须更新文档 |

### 5.2 Severity 分级

| Severity | 典型场景 | 默认行为 |
|----------|----------|----------|
| **high** | 状态管理、API 接口、核心配置 | 行为变化 → BLOCK |
| **medium** | 业务逻辑、流程变更 | 行为变化 → WARN |
| **low** | 辅助文档、规则摘要 | 行为变化 → WARN |

### 5.3 Examples 字段的作用

为 Subagent 提供具体的判断依据：

```yaml
examples:
  must_update:
    - "新增或删除状态字段"      # 正例
    - "修改持久化文件格式"
  usually_no_update:
    - "重构内部辅助方法"        # 负例
    - "修改日志文案但字段不变"
```

当 Subagent 看到这些示例时，可以更准确地判断当前变更属于哪种情况。

---

## 6. 实施建议

### 6.1 最小可维护版本原则

不要一开始就追求全覆盖。建议：

**第一版只覆盖：**
- 2-3 个核心模块（如状态管理、API、核心流程）
- 每个模块只写摘要文档
- 判定规则保持简单

**后续扩展：**
- 观察实际运行情况
- 收集误判案例
- 逐步调整 severity 和 examples

### 6.2 渐进式落地路径

```
Phase 1: 建立机制
├── 创建 DOC-MAP.yml（只覆盖核心模块）
├── 创建 UPDATE-RULES.md（基础规则）
└── 创建 GATE-RUNBOOK.md

Phase 2: 观察
├── 运行 2-3 周
├── 统计 PASS/WARN/BLOCK 分布
└── 收集误判案例

Phase 3: 优化
├── 调整 severity
├── 补充 examples
└── 扩展覆盖范围
```

### 6.3 避免的坑

1. **不要追求大全**：试图一次性补齐所有文档债，最后谁都不想推
2. **不要过度细分**：severity 分 5 级以上会增加复杂度，3 级足够
3. **不要依赖人**：机制设计时要假设"没有人会主动填模板"
4. **不要过度 BLOCK**：高频 BLOCK 会导致开发者绕过机制

---

## 7. 适用边界

### 7.1 本方案尤其适用于

- Agent 能自主修改代码并提交结果
- 多轮自动迭代容易导致文档漂移
- 项目已有基础模块文档，但缺少同步机制
- 希望逐步引入自动化门禁，而不是一开始重度 CI 阻断

### 7.2 不太适用于

- 纯一次性原型项目
- 没有稳定目录结构和模块边界的仓库
- 团队尚未沉淀任何基础文档的场景

---

## 8. 后续扩展方向

### 8.1 CI 集成

将文档守门机制集成到 CI 流程：

```yaml
# .github/workflows/doc-check.yml
- name: Doc Sync Gate
  run: |
    # 获取变更文件
    changed_files=$(git diff --name-only origin/main...HEAD)

    # 调用文档守门 Subagent
    verdict=$(doc-gate-agent "$changed_files")

    # 处理裁决
    if [ "$verdict" = "BLOCK" ]; then
      echo "Documentation update required"
      exit 1
    fi
```

### 8.2 自动生成文档更新建议

Subagent 不仅判断是否需要更新，还可以：
- 分析代码变更内容
- 生成文档更新的具体建议
- 甚至自动生成文档草稿

### 8.3 统计与监控

- 文档更新率
- WARN/BLOCK 分布
- 高频漏更模块

---

## 附录：文件结构参考

```
docs/
├── doc-sync/
│   ├── DOC-MAP.yml          # 代码-文档映射表
│   ├── UPDATE-RULES.md      # 判定规则 + Verdict 规则
│   └── GATE-RUNBOOK.md      # Subagent 执行手册
│
├── state-manager.md          # 具体文档（摘要版）
├── api.md
└── ...

.github/
└── pull_request_template.md  # 可选：PR 模板
```

---

## 总结

| 问题 | 传统方案 | 本方案 |
|------|----------|--------|
| 责任不明确 | 依赖作者自觉 | 专职 Subagent |
| 判定不清晰 | 模糊的自觉 | 明确的规则文件 |
| 执行不强制 | 依赖 Reviewer | 可配置 BLOCK |
| 覆盖不全面 | 人工维护 | 机器可读映射 |

核心思路：**将"文档同步"从依赖自觉的软约束，转变为可自动执行的硬机制。**