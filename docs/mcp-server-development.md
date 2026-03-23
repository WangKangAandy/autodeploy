# MCP Server 开发指南

本文档介绍如何构建一个 MCP (Model Context Protocol) Server，以 `agent-tools` 为例。

## 目录

1. [MCP 概述](#mcp-概述)
2. [插件结构](#插件结构)
3. [核心文件](#核心文件)
4. [开发步骤](#开发步骤)
5. [配置和使用](#配置和使用)
6. [MCP vs OpenClaw Plugin](#mcp-vs-openclaw-plugin)
7. [常见问题](#常见问题)

---

## MCP 概述

### 什么是 MCP？

MCP (Model Context Protocol) 是 Anthropic 开发的开放协议标准，用于 AI 应用与外部工具/数据源之间的通信。

### 架构图

```
┌─────────────────┐                    ┌─────────────────┐
│   AI Client     │                    │   MCP Server    │
│  (Claude Code)  │◄── stdio/SSE ────►│   (Your Tool)   │
│                 │    JSON-RPC        │                 │
└─────────────────┘                    └─────────────────┘
```

### 核心概念

| 概念 | 说明 |
|------|------|
| **Server** | MCP 服务器，提供工具/资源 |
| **Transport** | 通信层，支持 stdio 和 SSE |
| **Tool** | 可被 AI 调用的函数 |
| **Resource** | 可被 AI 访问的数据源 |
| **Prompt** | 预定义的提示模板 |

---

## 插件结构

```
your-mcp-server/
├── src/
│   ├── server.ts           # MCP Server 入口
│   ├── tools/
│   │   ├── index.ts        # 工具导出
│   │   └── your-tool.ts    # 工具实现
│   ├── core/
│   │   └── executor.ts     # 核心执行逻辑
│   └── shared/
│       └── utils.ts        # 工具函数
├── package.json
├── tsconfig.json
└── README.md
```

---

## 核心文件

### 1. package.json

```json
{
  "name": "your-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/server.js",
  "bin": {
    "your-mcp-server": "dist/server.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

**关键字段**：

| 字段 | 说明 |
|------|------|
| `type` | 必须是 `"module"` (ESM) |
| `bin` | CLI 入口，允许 `npx your-mcp-server` 运行 |
| `dependencies` | 必须包含 `@modelcontextprotocol/sdk` |

### 2. server.ts（MCP Server 入口）

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { YourTool } from "./tools/your-tool.js";

/**
 * MCP Server 类
 */
class YourMCPServer {
  private server: Server;

  constructor() {
    // 创建 Server 实例
    this.server = new Server(
      {
        name: "your-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},  // 声明支持 tools 能力
          // resources: {},  // 可选：支持 resources
          // prompts: {},    // 可选：支持 prompts
        },
      }
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  /**
   * 设置工具处理器
   */
  private setupToolHandlers() {
    // 1. 注册工具列表
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          YourTool,
          // 更多工具...
        ],
      };
    });

    // 2. 处理工具调用
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "your-tool-name":
            return await YourTool.execute(args);

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error executing ${name}: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * 设置错误处理
   */
  private setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error("[MCP Server Error]", error);
    };

    process.on("uncaughtException", (error) => {
      console.error("[Uncaught Exception]", error);
    });

    process.on("unhandledRejection", (reason) => {
      console.error("[Unhandled Rejection]", reason);
    });
  }

  /**
   * 启动服务器
   */
  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("[MCP Server] Started successfully");
  }

  /**
   * 停止服务器
   */
  async stop() {
    await this.server.close();
    console.error("[MCP Server] Stopped");
  }
}

// 启动服务器
const server = new YourMCPServer();

// 优雅关闭
process.on("SIGINT", async () => {
  await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.stop();
  process.exit(0);
});

server.start().catch((error) => {
  console.error("[MCP Server] Failed to start:", error);
  process.exit(1);
});
```

### 3. 工具定义（tools/your-tool.ts）

```typescript
import type { ToolResponse } from "../core/types.js";
import { executeSomething } from "../core/executor.js";

/**
 * 工具定义
 */
export const YourTool = {
  // 工具名称（唯一标识）
  name: "your-tool-name",

  // 工具描述（AI 会根据此描述决定是否使用）
  description: `Execute something on somewhere.
Use this for specific operations like X, Y, Z.
Requires ENV_VAR environment variables.`,

  // 输入 Schema（JSON Schema 格式）
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to execute",
      },
      timeout: {
        type: "number",
        description: "Timeout in seconds",
        default: 120,
      },
      verbose: {
        type: "boolean",
        description: "Enable verbose output",
        default: false,
      },
    },
    required: ["command"],
  },

  /**
   * 执行工具
   * @param args - 用户提供的参数
   * @returns ToolResponse
   */
  async execute(args: any): Promise<ToolResponse> {
    try {
      // 1. 获取配置（从环境变量）
      const config = getEnvConfig();

      // 2. 执行核心逻辑
      const result = await executeSomething(config, args);

      // 3. 返回结果
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: false,
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Tool execution failed: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};
```

### 4. 类型定义（core/types.ts）

```typescript
/**
 * 工具响应类型
 */
export interface ToolResponse {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/**
 * 执行结果类型
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

---

## 开发步骤

### Step 1: 初始化项目

```bash
mkdir your-mcp-server
cd your-mcp-server
npm init -y
npm install @modelcontextprotocol/sdk
npm install -D typescript @types/node
```

### Step 2: 配置 TypeScript

创建 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

### Step 3: 创建目录结构

```bash
mkdir -p src/tools src/core src/shared
```

### Step 4: 实现核心逻辑

在 `src/core/` 中实现核心功能：

```typescript
// src/core/executor.ts
export async function executeSomething(config: Config, args: any) {
  // 实现你的核心逻辑
  return { result: "success" };
}
```

### Step 5: 定义工具

在 `src/tools/` 中定义工具：

```typescript
// src/tools/index.ts
export { YourTool } from "./your-tool.js";
```

### Step 6: 创建 Server 入口

创建 `src/server.ts`，参考上面的模板。

### Step 7: 构建和测试

```bash
npm run build
node dist/server.js
```

---

## 配置和使用

### Claude Code 配置

在 Claude Code 的配置文件中添加 MCP Server：

**macOS/Linux**: `~/.config/claude-code/mcp.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "your-mcp-server": {
      "command": "node",
      "args": ["/path/to/your-mcp-server/dist/server.js"],
      "env": {
        "ENV_VAR_1": "value1",
        "ENV_VAR_2": "value2"
      }
    }
  }
}
```

### 使用 npx

如果发布到 npm：

```json
{
  "mcpServers": {
    "your-mcp-server": {
      "command": "npx",
      "args": ["-y", "your-mcp-server"],
      "env": {
        "ENV_VAR": "value"
      }
    }
  }
}
```

### 环境变量配置

创建 `.env` 文件或直接在配置中设置：

```bash
# MCP Server 环境变量
GPU_HOST=192.168.1.100
GPU_USER=gpuuser
GPU_SSH_PASSWD=secretpass
```

---

## MCP vs OpenClaw Plugin

| 维度 | MCP Server | OpenClaw Plugin |
|------|------------|-----------------|
| **通信方式** | stdio/SSE（进程间） | 函数调用（进程内） |
| **跨平台** | ✅ 所有 MCP 客户端 | ❌ 仅 OpenClaw |
| **隔离性** | ✅ 独立进程 | ❌ 同进程 |
| **性能** | 较低（序列化开销） | 较高（直接调用） |
| **开发复杂度** | 较高（协议实现） | 较低（直接 JS） |
| **调试** | 较复杂（进程分离） | 简单（同进程） |

### 选择建议

| 场景 | 推荐 |
|------|------|
| 需要跨多个 AI 客户端 | MCP Server |
| 仅 Claude Code / OpenClaw | 两者皆可 |
| 需要进程隔离（安全/稳定） | MCP Server |
| 追求性能和简单集成 | OpenClaw Plugin |

### 双轨模式示例

当前 `autodeploy` 仓库支持双轨：

```
autodeploy/
├── agent-tools/              # MCP Server
│   ├── src/server.ts         # MCP 入口
│   └── src/tools/            # MCP 工具定义
├── index.js                  # OpenClaw 插件入口
├── openclaw.plugin.json      # OpenClaw 插件清单
└── src/tools/                # OpenClaw 工具定义
```

**核心逻辑复用**：

```
src/core/
├── executor.js    # 统一执行逻辑
├── ssh-client.js  # SSH 客户端
└── utils.js       # 工具函数

         ↓ 复用

┌─────────────────────┐    ┌─────────────────────┐
│    MCP Server       │    │  OpenClaw Plugin    │
│  (agent-tools/)     │    │  (index.js)         │
│                     │    │                     │
│  TypeScript         │    │  JavaScript         │
│  inputSchema        │    │  parameters         │
│  Tool.execute()     │    │  api.registerTool() │
└─────────────────────┘    └─────────────────────┘
```

---

## 常见问题

### 1. Server 启动后立即退出

**症状**：`node dist/server.js` 执行后无输出退出

**原因**：未正确连接 transport

**解决**：确保调用 `await server.connect(transport)`

### 2. 工具调用无响应

**症状**：AI 调用工具后一直等待

**原因**：
- 工具 `execute` 方法未返回
- 抛出了未捕获的异常

**解决**：
```typescript
async execute(args: any): Promise<ToolResponse> {
  try {
    // ... 逻辑
    return { content: [...], isError: false };
  } catch (error: any) {
    return { content: [...], isError: true };  // 必须返回
  }
}
```

### 3. ESM 导入错误

**症状**：`Warning: To load an ES module, set "type": "module"`

**解决**：
- `package.json` 添加 `"type": "module"`
- 使用 `.js` 扩展名导入：`import { X } from "./file.js"`

### 4. 环境变量未读取

**症状**：工具执行时配置为空

**解决**：MCP Server 的环境变量需要在配置文件中设置：
```json
{
  "mcpServers": {
    "your-server": {
      "env": {
        "YOUR_ENV_VAR": "value"
      }
    }
  }
}
```

---

## 最佳实践

1. **错误处理**：所有工具 execute 方法都要 try-catch
2. **日志输出**：使用 `console.error()` 打印日志（stdout 用于通信）
3. **超时控制**：长时间操作设置超时
4. **输出限制**：大输出要截断，避免超出上下文限制
5. **类型安全**：使用 TypeScript 定义严格的类型

---

## 参考资料

- [MCP 官方文档](https://modelcontextprotocol.io/)
- [MCP SDK (TypeScript)](https://github.com/modelcontextprotocol/typescript-sdk)
- [Claude Code MCP 配置](https://docs.anthropic.com/claude-code/mcp)