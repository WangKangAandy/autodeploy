# OpenClaw 插件开发指南

本文档介绍如何构建和注册一个 OpenClaw 插件，以 `openclaw-musa` 为例。

## 目录

1. [插件结构](#插件结构)
2. [核心文件](#核心文件)
3. [开发步骤](#开发步骤)
4. [安装和调试](#安装和调试)
5. [常见问题](#常见问题)

---

## 插件结构

```
your-plugin/
├── index.js                 # 插件入口（必需）
├── openclaw.plugin.json     # 插件清单（必需）
├── package.json             # npm 包配置（必需）
├── src/
│   ├── tools/              # 工具定义
│   │   ├── index.js        # 工具注册入口
│   │   └── your-tool.js    # 具体工具实现
│   └── core/               # 核心逻辑
├── skills/                  # 技能定义（可选）
│   └── your-skill/
│       └── SKILL.md
└── references/              # 参考文档（可选）
```

---

## 核心文件

### 1. package.json

**必需字段**：

```json
{
  "name": "your-plugin-name",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    // 你的依赖
  },
  "openclaw": {
    "extensions": ["./index.js"]
  }
}
```

**关键字段说明**：

| 字段 | 说明 |
|------|------|
| `name` | 插件名称，建议使用 `openclaw-` 前缀 |
| `main` | 入口文件，必须是 `index.js` |
| `openclaw.extensions` | **必需**，指定插件入口文件路径 |

### 2. openclaw.plugin.json

```json
{
  "id": "your-plugin-id",
  "name": "Your Plugin Display Name",
  "description": "Plugin description",
  "skills": ["./skills"],
  "configSchema": {
    "type": "object",
    "properties": {}
  }
}
```

**字段说明**：

| 字段 | 说明 |
|------|------|
| `id` | 插件唯一标识，与 package.json 的 name 保持一致 |
| `skills` | 技能目录路径，相对于插件根目录 |
| `configSchema` | 配置 Schema，用户配置时会验证 |

### 3. index.js（插件入口）

```javascript
"use strict";

const { registerYourTools } = require("./src/tools");

const plugin = {
  id: "your-plugin-id",
  name: "Your Plugin Name",
  description: "Plugin description",
  configSchema: {
    type: "object",
    properties: {},
  },
  register(api) {
    const log = (msg) => api.logger.info?.(`[your-plugin] ${msg}`);

    log("Registering tools...");

    // 注册工具
    registerYourTools(api);

    log("Plugin loaded successfully");

    // 工具调用日志（可选）
    api.on("before_tool_call", (event) => {
      if (event.toolName.startsWith("your_prefix_")) {
        log(`tool call: ${event.toolName}`);
      }
    });

    api.on("after_tool_call", (event) => {
      if (event.toolName.startsWith("your_prefix_")) {
        if (event.error) {
          api.logger.error?.(`[your-plugin] tool fail: ${event.toolName}`);
        } else {
          log(`tool done: ${event.toolName}`);
        }
      }
    });
  },
};

// 两种导出方式都要支持
module.exports = plugin;
module.exports.default = plugin;
```

**关键点**：
- 使用 `api.logger.info?.()` 打印日志（`?.` 确保可选链安全）
- 同时导出 `module.exports` 和 `module.exports.default`
- 使用 `api.on("before_tool_call")` 监听工具调用

### 4. 工具注册（src/tools/index.js）

```javascript
"use strict";

const { registerYourTool } = require("./your-tool");

function registerYourTools(api) {
  registerYourTool(api);
}

module.exports = { registerYourTools };
```

### 5. 工具实现（src/tools/your-tool.js）

```javascript
"use strict";

/**
 * 注册工具
 */
function registerYourTool(api) {
  api.registerTool({
    name: "your_tool_name",
    description: "Tool description",
    parameters: {
      type: "object",
      properties: {
        param1: {
          type: "string",
          description: "Parameter description",
        },
        param2: {
          type: "number",
          default: 100,
          description: "Optional parameter with default",
        },
      },
      required: ["param1"],
    },
    async execute(_toolCallId, params) {
      try {
        // 工具逻辑
        const result = await doSomething(params);

        // 返回格式
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          details: result,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: err.message }, null, 2),
            },
          ],
          details: { error: err.message },
        };
      }
    },
  });
}

module.exports = { registerYourTool };
```

---

## 开发步骤

### Step 1: 创建项目结构

```bash
mkdir -p your-plugin/src/{tools,core}
cd your-plugin
npm init -y
```

### Step 2: 创建必需文件

```bash
touch index.js openclaw.plugin.json
touch src/tools/index.js src/tools/your-tool.js
```

### Step 3: 更新 package.json

添加 `openclaw.extensions` 字段：

```json
{
  "openclaw": {
    "extensions": ["./index.js"]
  }
}
```

### Step 4: 实现插件逻辑

1. 编写 `index.js` 插件入口
2. 编写 `src/tools/*.js` 工具实现
3. 编写 `src/core/*.js` 核心逻辑（如需要）

### Step 5: 添加技能（可选）

在 `skills/` 目录下创建技能：

```
skills/
└── your-skill/
    └── SKILL.md
```

SKILL.md 格式：

```yaml
---
name: your-skill
description: Skill description
triggers:
  - trigger keyword 1
  - trigger keyword 2
---

# Skill Title

Skill implementation guide...
```

---

## 安装和调试

### 本地安装

```bash
# 方式 1: 通过 openclaw CLI 安装
openclaw plugins install /path/to/your-plugin

# 方式 2: 手动复制
cp -r /path/to/your-plugin ~/.openclaw/extensions/
cd ~/.openclaw/extensions/your-plugin
npm install --production
```

### 启用插件

```bash
openclaw plugins enable your-plugin-id
```

### 重启 Gateway

```bash
openclaw gateway restart
```

### 验证安装

```bash
# 查看插件列表
openclaw plugins list

# 查看插件详情
openclaw plugins info your-plugin-id

# 查看技能列表
openclaw skills list

# 查看 gateway 日志
journalctl --user -u openclaw-gateway.service -f
```

---

## 常见问题

### 1. 插件不加载

**症状**：`openclaw plugins list` 显示插件，但 gateway 日志没有相关输出

**原因**：
- `package.json` 缺少 `openclaw.extensions` 字段
- `index.js` 导出方式不正确

**解决**：
```json
// package.json
{
  "openclaw": {
    "extensions": ["./index.js"]
  }
}
```

```javascript
// index.js
module.exports = plugin;
module.exports.default = plugin;  // 两种导出都要支持
```

### 2. 安全警告

**症状**：安装时出现 `WARNING: Plugin contains dangerous code patterns`

**原因**：OpenClaw 扫描到了敏感代码模式（如 `child_process`、环境变量访问等）

**解决**：这是正常的警告，不影响功能。如果代码是合法的，可以忽略。

### 3. 工具未注册

**症状**：`openclaw plugins info` 不显示工具列表

**原因**：`api.registerTool()` 调用失败或参数错误

**解决**：检查工具定义是否符合 Schema：
```javascript
api.registerTool({
  name: "tool_name",           // 必需
  description: "description",   // 必需
  parameters: { ... },          // 必需
  async execute(_toolCallId, params) { ... }  // 必需
});
```

### 4. 配置持久化

**症状**：重启后插件配置丢失

**解决**：确保 `openclaw.json` 中有正确的配置：

```json
{
  "plugins": {
    "allow": ["your-plugin-id"],
    "entries": {
      "your-plugin-id": {
        "enabled": true
      }
    },
    "installs": {
      "your-plugin-id": {
        "source": "path",
        "sourcePath": "/path/to/your-plugin",
        "installPath": "~/.openclaw/extensions/your-plugin-id",
        "version": "1.0.0"
      }
    }
  }
}
```

---

## 最佳实践

1. **日志规范**：使用统一的日志前缀 `[plugin-name]`
2. **工具命名**：使用统一前缀（如 `musa_`）避免冲突
3. **错误处理**：工具 execute 方法要 try-catch，返回标准错误格式
4. **参数验证**：使用 `parameters.required` 声明必填参数
5. **技能隔离**：每个技能独立目录，包含 SKILL.md 和配置文件

---

## 示例：openclaw-musa

完整的插件示例参考当前仓库：

- 插件入口：`/index.js`
- 插件清单：`/openclaw.plugin.json`
- 工具定义：`/src/tools/`
- 技能定义：`/skills/`
- 参考文档：`/references/`