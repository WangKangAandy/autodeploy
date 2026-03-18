# 飞书 Claude 桥接系统

将飞书机器人与 Claude AI 连接的桥接系统，支持直接调用 Claude API 和远程 GPU 工具。

## 快速开始

### 1. 配置

```bash
cd feishu-claude-bridge
npm install
cp config/.env.example config/.env
# 编辑 config/.env 填入飞书和 Claude API 配置
```

### 2. 启动

```bash
npm run dev
```

系统会自动启动：
- 飞书 Webhook 接收服务器（端口 3000）
- Claude API 集成（自动处理消息）
- 远程工具支持（GPU 操作）

## 功能特性

- **Claude API 集成**: 直接调用 Claude API 生成响应，无需手动处理
- **远程工具支持**: 集成 agent-tools 执行远程命令和 GPU 操作
- **技能系统集成**: 自动加载仓库 skills，提供 MUSA 运维能力
- **多格式支持**: 文本、图片、文件、视频、音频、URL
- **双向通信**: 私聊和群聊 @ 提问
- **CLI 工具**: 交互式命令行处理消息

## 与 agent-tools 集成

飞书机器人集成了 `agent-tools` 的远程执行能力：

```typescript
import { ToolClient } from "./tool-client.js"

const client = ToolClient.fromEnv()

// 执行远程命令
const result = await client.execCommand("mthreads-gmi")

// 执行 Docker 命令
await client.execDocker("python train.py", { name: "torch_musa_test" })

// 获取 GPU 状态
const gpuStatus = await client.getGpuStatus()
```

### 可用工具

| 工具 | 功能 |
|------|------|
| `remote_exec` | 执行远程 shell 命令 |
| `remote_docker` | 在 Docker 容器中执行命令 |
| `get_gpu_status` | 获取 GPU 状态 |

### 技能支持

系统自动加载仓库中的 skills：
- `deploy_musa_full_env` - MUSA 环境部署
- `update_musa_driver` - 驱动更新

## 配置说明

### 环境变量

```bash
# 服务器配置
PORT=3000
NODE_ENV=development

# 飞书配置
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxx
FEISHU_VERIFICATION_TOKEN=xxxxxxxxxxxxxxx
FEISHU_ENCRYPT_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Claude API 配置
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx

# 远程 GPU 配置（用于 agent-tools）
GPU_HOST=192.168.x.x
GPU_USER=username
GPU_SSH_PASSWD=password
MY_SUDO_PASSWD=sudo_password
TORCH_MUSA_DOCKER_IMAGE=registry.mthreads.com/...
```

### 飞书应用配置

详见 [SETUP.md](./SETUP.md)

## CLI 命令

```bash
# 交互式模式（推荐）
npm run cli

# 列出待处理消息
npm run cli list

# 查看消息详情
npm run cli show <request-id>

# 发送响应
npm run cli respond <request-id> "回复内容"

# 清理所有消息
npm run cli clear
```

## 项目结构

```
feishu-claude-bridge/
├── config/
│   └── .env.example          # 环境变量模板
├── messages/                  # 消息队列目录
├── responses/                 # 响应队列目录
├── src/
│   ├── claude-client.ts       # Claude API 客户端
│   ├── tool-client.ts         # agent-tools 集成
│   ├── system-prompt.ts       # 系统提示词生成
│   ├── skill-loader.ts        # 技能加载器
│   ├── handlers/              # 消息处理器
│   ├── message/               # 消息格式化
│   └── server.ts              # HTTP 服务器
├── SETUP.md                   # 飞书配置详细指南
└── README.md                  # 本文件
```

## API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/queue` | GET | 查看消息队列 |
| `/webhook/feishu` | POST | 飞书 Webhook |

## 故障排查

### 收不到消息
1. 检查飞书应用权限 (`im:message`, `im:chat`)
2. 检查事件订阅 (`im.message.receive_v1`)
3. 确认 Webhook 地址正确

### Claude 响应失败
1. 检查 `ANTHROPIC_API_KEY` 是否正确
2. 查看服务器日志

### 远程工具失败
1. 检查 `GPU_HOST`, `GPU_USER`, `GPU_SSH_PASSWD` 配置
2. 确认远程机器可访问

## 开发命令

```bash
npm run dev          # 开发模式
npm run build        # 构建
npm run start        # 生产模式
npm run type-check   # 类型检查
npm run test         # 运行测试
npm run test:watch   # 测试监听模式
npm run test:coverage # 生成覆盖率报告
```

## 测试

```bash
npm run test            # 运行所有测试
npm run test:watch      # 监听模式
npm run test:coverage   # 生成覆盖率报告
```

### 测试文件结构

```
tests/
├── credential-parser.test.ts  # 凭据解析测试
├── tool-client.test.ts        # 工具客户端测试
└── skill-loader.test.ts       # 技能加载测试
```

## 许可证

MIT License