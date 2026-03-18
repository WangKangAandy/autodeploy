# 多平台 Claude 桥接系统

将多个聊天平台（飞书、钉钉等）与 Claude AI 连接的桥接系统，支持直接调用 Claude API 和远程 GPU 工具。

## 架构特性

- **多平台支持**: 飞书、钉钉，可扩展更多平台
- **插件化架构**: 新平台只需实现适配器接口
- **配置驱动**: 通过环境变量启用/禁用平台
- **统一消息处理**: 所有平台使用统一的消息格式
- **长连接支持**: 飞书支持 WebSocket 长连接模式，无需公网域名

## 快速开始

### 1. 安装依赖

```bash
cd feishu-claude-bridge
npm install
```

### 2. 配置环境变量

```bash
cp config/.env.example config/.env
# 编辑 config/.env 填入平台和 Claude API 配置
```

### 3. 启动服务

```bash
npm run dev
```

系统会自动启动：
- 多平台 Webhook 接收服务器（端口 3000）
- Claude API 集成（自动处理消息）
- 远程工具支持（GPU 操作）

## 支持的平台

### 飞书 (Feishu/Lark)

飞书支持两种连接模式：

#### 模式一：Webhook 模式（需要公网域名）

```bash
# 飞书 Webhook 模式配置
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxx
FEISHU_VERIFICATION_TOKEN=xxxxxxxxxxxxxxx
FEISHU_ENCRYPT_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FEISHU_CONNECTION_MODE=webhook  # 默认值
```

**Webhook 路径**: `/webhook/feishu`

**要求**:
- 需要公网域名
- 需要配置加密策略
- 需要在飞书开放平台配置事件订阅 URL

#### 模式二：长连接模式（无需公网域名）

```bash
# 飞书长连接模式配置（推荐内网环境使用）
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxx
FEISHU_CONNECTION_MODE=long-connection
```

**飞书开放平台配置步骤**:

1. 进入开发者后台 → 你的应用 → 事件与回调
2. 在「订阅方式」中选择「使用长连接接收事件」
3. 添加事件订阅（如 `im.message.receive_v1`）
4. 发布应用版本

**优势**:
- 无需公网域名
- 无需配置加密策略
- 仅需使用官方 SDK 启动长连接客户端
- 适合内网部署环境

**限制**:
- 仅支持企业自建应用
- 每个应用最多 50 个连接
- 需要确保网络能访问飞书服务器

### 钉钉 (DingTalk)

```bash
# 钉钉配置
DINGTALK_APP_KEY=xxxxxxxxxxxxxxxx
DINGTALK_APP_SECRET=xxxxxxxxxxxxxxxx
DINGTALK_AGENT_ID=xxxxxxxxxxxxxxxx
DINGTALK_ENCODING_AES_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DINGTALK_ENABLED=true
```

**Webhook 路径**: `/webhook/dingtalk`

## 配置说明

### 完整环境变量

```bash
# 服务器配置
PORT=3000
NODE_ENV=development

# Claude API 配置
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
CLAUDE_MODEL=claude-sonnet-4-20250514

# 飞书配置
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxx
# 连接模式: webhook (需要公网域名) 或 long-connection (无需公网域名)
FEISHU_CONNECTION_MODE=long-connection
# Webhook 模式需要以下配置
FEISHU_VERIFICATION_TOKEN=xxxxxxxxxxxxxxx
FEISHU_ENCRYPT_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 钉钉配置（可选）
DINGTALK_APP_KEY=xxxxxxxxxxxxxxxx
DINGTALK_APP_SECRET=xxxxxxxxxxxxxxxx
DINGTALK_AGENT_ID=xxxxxxxxxxxxxxxx
DINGTALK_ENCODING_AES_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DINGTALK_ENABLED=true

# 远程 GPU 配置（用于 agent-tools）
GPU_HOST=192.168.x.x
GPU_USER=username
GPU_SSH_PASSWD=password
MY_SUDO_PASSWD=sudo_password
TORCH_MUSA_DOCKER_IMAGE=registry.mthreads.com/...

# 消息队列配置
MESSAGE_QUEUE_DIR=./messages
RESPONSE_QUEUE_DIR=./responses
```

### 多平台配置 (JSON 格式)

也可以使用 `PLATFORMS` 环境变量配置多个平台：

```bash
PLATFORMS='[
  {"type": "feishu", "enabled": true, "connectionMode": "long-connection", "appId": "cli_xxx", "appSecret": "xxx"},
  {"type": "dingtalk", "enabled": true, "appKey": "xxx", "appSecret": "xxx", "agentId": "xxx", "encodingAESKey": "xxx"}
]'
```

## 项目结构

```
feishu-claude-bridge/
├── src/
│   ├── index.ts                    # 入口
│   ├── server.ts                   # 多平台服务器
│   ├── claude-client.ts            # Claude API 客户端
│   │
│   ├── core/                       # 核心抽象层
│   │   ├── types.ts                # 统一接口定义
│   │   ├── registry.ts             # 平台注册中心
│   │   ├── message-bus.ts          # 消息总线
│   │   └── handler.ts              # 统一消息处理器
│   │
│   ├── platforms/                  # 平台适配器
│   │   ├── base.ts                 # 适配器基类
│   │   ├── feishu/                 # 飞书适配器
│   │   │   ├── adapter.ts          # 适配器主类
│   │   │   ├── api.ts              # HTTP API 客户端
│   │   │   ├── webhook.ts          # Webhook 处理器
│   │   │   ├── long-connection.ts  # 长连接客户端 (WebSocket)
│   │   │   ├── formatter.ts        # 消息格式化
│   │   │   └── types.ts            # 类型定义
│   │   └── dingtalk/               # 钉钉适配器
│   │       ├── adapter.ts
│   │       ├── api.ts
│   │       ├── webhook.ts
│   │       ├── formatter.ts
│   │       └── types.ts
│   │
│   ├── config/                     # 配置管理
│   └── utils/                      # 工具函数
│
├── tests/                          # 测试文件
└── messages/                       # 消息队列目录
```

## 添加新平台

添加新平台只需 3 步：

### 1. 创建适配器目录

```bash
mkdir -p src/platforms/wecom
```

### 2. 实现适配器

```typescript
// src/platforms/wecom/adapter.ts
import { BaseAdapter } from "../base.js"
import type { SendOptions, MessageResult } from "../../core/types.js"

export class WecomAdapter extends BaseAdapter {
  readonly id = "wecom"
  readonly name = "企业微信"

  protected async onInitialize(): Promise<void> {
    // 初始化逻辑
  }

  getWebhookPath(): string {
    return "wecom"
  }

  async handleWebhook(req, res): Promise<void> {
    // 处理 webhook
  }

  async sendMessage(targetId: string, content: string, options?: SendOptions): Promise<MessageResult> {
    // 发送消息
  }
}
```

### 3. 注册适配器

```typescript
// src/platforms/wecom/index.ts
import { registry } from "../../core/registry.js"
import { WecomAdapter } from "./adapter.js"

registry.register("wecom", WecomAdapter)
```

**无需修改任何核心代码！**

## API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/health` | GET | 健康检查，返回已启用的平台列表和连接状态 |
| `/platforms` | GET | 查看所有注册的平台、连接模式和 webhook 路径 |
| `/webhook/feishu` | POST | 飞书 Webhook（仅 webhook 模式） |
| `/webhook/dingtalk` | POST | 钉钉 Webhook |

**注意**: 飞书使用长连接模式时，不会注册 `/webhook/feishu` 路由。

## 与 agent-tools 集成

系统集成了 `agent-tools` 的远程执行能力：

### 可用工具

| 工具 | 功能 |
|------|------|
| `remote_exec` | 执行远程 shell 命令 |
| `remote_docker` | 在 Docker 容器中执行命令 |
| `get_gpu_status` | 获取 GPU 状态 |
| `check_musa_status` | 检查 MUSA 环境状态 |

### 使用示例

在聊天中发送消息，Claude 会自动调用工具：

```
用户: 帮我查看 GPU 状态
主机: 192.168.1.100
用户名: root
密码: xxxxxx
```

## 开发命令

```bash
npm run dev          # 开发模式
npm run build        # 构建
npm run start        # 生产模式
npm run type-check   # 类型检查
npm run test         # 运行测试
npm run test:watch   # 测试监听模式
```

## 测试

```bash
npm run test            # 运行所有测试
npm run test:watch      # 监听模式
npm run test:coverage   # 生成覆盖率报告
```

### 测试结构

```
tests/
├── core/
│   ├── registry.test.ts      # 平台注册中心测试
│   └── message-bus.test.ts   # 消息总线测试
├── platforms/
│   └── feishu/
│       └── formatter.test.ts # 飞书格式化测试
├── credential-parser.test.ts # 凭据解析测试
└── tool-client.test.ts       # 工具客户端测试
```

## 故障排查

### 飞书长连接模式

**长连接无法建立**
1. 确认已在飞书开放平台配置：开发者后台 → 事件与回调 → 订阅方式 → 使用长连接接收事件
2. 检查网络能否访问飞书服务器（需要访问 `open.feishu.cn`）
3. 确认 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 配置正确
4. 查看日志中是否有 `[飞书长连接] WebSocket connection established successfully`

**收不到消息**
1. 确认长连接已建立（日志显示 `ws client ready`）
2. 检查飞书应用是否订阅了 `im.message.receive_v1` 事件
3. 确认应用有 `im:message` 权限

### 飞书 Webhook 模式

**收不到消息**
1. 检查平台应用权限（`im:message`, `im:chat`）
2. 检查事件订阅配置（`im.message.receive_v1`）
3. 确认 Webhook 地址正确且可从公网访问
4. 检查 `FEISHU_ENCRYPT_KEY` 配置是否正确

### Claude 响应失败
1. 检查 `ANTHROPIC_API_KEY` 是否正确
2. 查看服务器日志

### 平台初始化失败
1. 检查平台配置是否完整
2. 查看启动日志中的错误信息

## 许可证

MIT License