# 飞书开放平台配置指南

## 目录

1. [创建飞书应用](#1-创建飞书应用)
2. [配置机器人能力](#2-配置机器人能力)
3. [获取应用凭证](#3-获取应用凭证)
4. [配置权限](#4-配置权限)
5. [配置内网穿透](#5-配置内网穿透)
6. [配置 Webhook](#6-配置-webhook)
7. [配置环境变量](#7-配置环境变量)
8. [启动服务](#8-启动服务)
9. [测试验证](#9-测试验证)

---

## 1. 创建飞书应用

### 步骤

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 登录你的飞书账号
3. 点击 **「开发者后台」**
4. 点击 **「创建企业自建应用」**
5. 填写应用信息：
   - **应用名称**: 例如 "Claude AI 助手"
   - **应用描述**: 例如 "智能对话机器人"
   - **应用图标**: 上传一个图标
6. 点击 **「创建」**

### 截图位置

```
开发者后台
  └─ 创建企业自建应用
       ├─ 应用名称: Claude AI 助手
       ├─ 应用描述: 智能对话机器人
       └─ 应用图标: [上传图标]
```

---

## 2. 配置机器人能力

### 步骤

1. 进入应用详情页
2. 点击左侧菜单 **「应用功能」**
3. 点击 **「机器人」**
4. 开启 **「启用机器人」** 开关
5. 配置机器人信息：
   - **机器人名称**: Claude AI 助手
   - **机器人描述**: 智能对话机器人，可以回答问题、提供建议
   - **机器人头像**: 上传头像

### 重要配置

**消息卡片能力**: 可选，建议开启

### 截图位置

```
应用详情
  └─ 应用功能
       └─ 机器人
            ├─ 启用机器人: [开启]
            ├─ 机器人名称: Claude AI 助手
            ├─ 机器人描述: 智能对话机器人
            └─ 机器人头像: [上传头像]
```

---

## 3. 获取应用凭证

### 步骤

1. 在应用详情页，点击左侧菜单 **「凭证与基础信息」**
2. 记录以下信息：
   - **App ID**: 例如 `cli_a1b2c3d4e5f6g7h8`
   - **App Secret**: 例如 `aBcDeFgHiJkLmNoPqRsTuVwXyZ123456`

### 重要提示

⚠️ **App Secret 只显示一次，请立即复制保存！**

### 截图位置

```
应用详情
  └─ 凭证与基础信息
       ├─ App ID: cli_a1b2c3d4e5f6g7h8
       └─ App Secret: aBcDeFgHiJkLmNoPqRsTuVwXyZ123456
```

---

## 4. 配置权限

### 步骤

1. 点击左侧菜单 **「权限管理」**
2. 在 **「权限配置」** 标签页
3. 搜索并开通以下权限：

#### 必需权限

| 权限名称 | 权限标识 | 用途 |
|---------|---------|------|
| 获取与发送单聊、群聊消息 | `im:message` | 接收和发送消息 |
| 获取群组信息 | `im:chat` | 获取群聊信息 |
| 以应用身份读取群消息 | `im:message.group_msg` | 读取群消息 |

#### 可选权限

| 权限名称 | 权限标识 | 用途 |
|---------|---------|------|
| 获取用户信息 | `contact:user.base` | 获取用户基本信息 |
| 上传文件 | `drive:file` | 上传文件到云文档 |

### 开通方式

- 点击权限右侧的 **「开通权限」** 按钮
- 有些权限需要 **「申请发布」** 后才生效

### 截图位置

```
应用详情
  └─ 权限管理
       └─ 权限配置
            ├─ im:message [开通权限]
            ├─ im:chat [开通权限]
            └─ im:message.group_msg [开通权限]
```

---

## 5. 配置内网穿透

由于飞书 Webhook 需要公网可访问的地址，你需要使用内网穿透工具。

### 选项 1: 使用 ngrok（推荐用于开发）

#### 安装 ngrok

```bash
# Ubuntu/Debian
sudo snap install ngrok

# 或下载安装包
# https://ngrok.com/download
```

#### 启动 ngrok

```bash
# 基础用法（随机域名）
ngrok http 3000

# 使用自定义域名（需要付费）
ngrok http --domain=your-domain.ngrok-free.app 3000
```

#### 获取公网地址

启动后会显示：

```
Session Status                online
Forwarding                    https://abc123.ngrok-free.app -> http://localhost:3000
```

**Webhook 地址**: `https://abc123.ngrok-free.app/webhook/feishu`

### 选项 2: 使用其他内网穿透工具

- **frp**: 自建内网穿透服务
- **cloudflare tunnel**: Cloudflare 提供
- **natapp**: 国内服务商

### 重要提示

⚠️ **每次重启 ngrok，地址会变化，需要更新飞书 Webhook 配置！**

---

## 6. 配置 Webhook

### 步骤

1. 点击左侧菜单 **「事件订阅」**
2. 开启 **「启用事件订阅」** 开关
3. 配置 **「请求网址配置」**：

   **请求网址**: `https://你的ngrok地址/webhook/feishu`

   例如：`https://abc123.ngrok-free.app/webhook/feishu`

4. 点击 **「添加事件」**，订阅以下事件：

   | 事件名称 | 事件标识 | 用途 |
   |---------|---------|------|
   | 接收消息 | `im.message.receive_v1` | 接收用户发送的消息 |

5. 点击 **「保存」**

### 验证 Webhook

飞书会向你的地址发送验证请求：

```json
{
  "type": "url_verification",
  "challenge": "xxx",
  "token": "your_verification_token"
}
```

你的服务器需要返回：

```json
{
  "challenge": "xxx"
}
```

### 获取加密密钥

1. 在 **「事件订阅」** 页面
2. 找到 **「加密策略」**
3. 记录以下信息：
   - **Verification Token**: 用于验证请求来源
   - **Encrypt Key**: 用于解密消息内容

### 截图位置

```
应用详情
  └─ 事件订阅
       ├─ 启用事件订阅: [开启]
       ├─ 请求网址: https://abc123.ngrok-free.app/webhook/feishu
       ├─ 添加事件: im.message.receive_v1
       ├─ Verification Token: xxx
       └─ Encrypt Key: xxx
```

---

## 7. 配置环境变量

### 创建配置文件

```bash
cd /home/wangkang/桌面/repo/autodeploy/feishu-claude-bridge
cp config/.env.example config/.env
```

### 编辑配置文件

```bash
nano config/.env
# 或使用你喜欢的编辑器
```

### 填写配置

```bash
# 服务器配置
PORT=3000
NODE_ENV=development

# 飞书应用配置（从飞书开放平台获取）
FEISHU_APP_ID=cli_a1b2c3d4e5f6g7h8
FEISHU_APP_SECRET=aBcDeFgHiJkLmNoPqRsTuVwXyZ123456
FEISHU_VERIFICATION_TOKEN=your_verification_token_here
FEISHU_ENCRYPT_KEY=your_encrypt_key_here

# 飞书 API 地址（默认即可）
FEISHU_BASE_URL=https://open.feishu.cn

# 消息队列目录（默认即可）
MESSAGE_QUEUE_DIR=./messages
RESPONSE_QUEUE_DIR=./responses
```

### 配置项说明

| 配置项 | 说明 | 从哪里获取 |
|-------|------|-----------|
| FEISHU_APP_ID | 应用 ID | 凭证与基础信息 |
| FEISHU_APP_SECRET | 应用密钥 | 凭证与基础信息 |
| FEISHU_VERIFICATION_TOKEN | 验证令牌 | 事件订阅 |
| FEISHU_ENCRYPT_KEY | 加密密钥 | 事件订阅 |

---

## 8. 启动服务

### 安装依赖

```bash
cd /home/wangkang/桌面/repo/autodeploy/feishu-claude-bridge
npm install
```

### 构建项目

```bash
npm run build
```

### 启动 ngrok（新终端）

```bash
ngrok http 3000
```

记录生成的公网地址，例如：`https://abc123.ngrok-free.app`

### 更新飞书 Webhook 地址

如果 ngrok 地址变化，需要：

1. 回到飞书开放平台
2. 进入 **「事件订阅」**
3. 更新 **「请求网址」** 为新的 ngrok 地址
4. 点击 **「保存」**

### 启动桥接服务

```bash
npm run dev
```

### 检查启动日志

成功启动后应该看到：

```
[FeishuBridge] Starting Feishu Claude Bridge...
[FeishuBridge] Configuration loaded successfully
[FeishuBridge] Getting Feishu app access token...
[FeishuBridge] App access token obtained
[FeishuBridge] Bot open_id: ou_xxxxxxxxxxxxxx
[FeishuBridge] Server listening on port 3000
[FeishuBridge] Response Watcher started
[FeishuBridge] Response queue: ./responses
```

---

## 9. 测试验证

### 步骤 1: 发布应用

飞书应用需要发布才能使用：

1. 在应用详情页，点击 **「版本管理与发布」**
2. 点击 **「创建版本」**
3. 填写版本信息：
   - **版本号**: 1.0.0
   - **更新说明**: 初始版本
4. 点击 **「保存」**
5. 点击 **「申请发布」**
6. 等待审核通过（或设置为测试应用）

**测试应用模式**（开发阶段推荐）：

1. 在 **「版本管理与发布」** 页面
2. 点击 **「申请上线」** 旁边的 **「添加测试用户」**
3. 添加你的飞书账号为测试用户
4. 测试用户可以直接使用未发布的应用

### 步骤 2: 添加机器人到通讯录

1. 在飞书客户端，点击 **「通讯录」**
2. 搜索你的机器人名称
3. 点击 **「添加到通讯录」**

### 步骤 3: 发送测试消息

#### 私聊测试

1. 在飞书客户端，找到机器人
2. 点击 **「发消息」**
3. 发送：`你好`
4. 查看服务器日志，应该看到：

```
[FeishuBridge] Processing private chat message from ou_xxx: 你好...
[FeishuBridge] Message queued with requestId: a1b2c3d4-e5f6
[FeishuBridge] Acknowledgment sent to user ou_xxx
```

5. 在机器人聊天界面，应该收到：`收到您的消息，正在处理中...`

#### 群聊测试

1. 创建一个测试群聊
2. 在群聊设置中，添加机器人
3. 在群聊中发送：`@Claude AI 助手 你好`
4. 查看服务器日志
5. 在群聊中应该收到确认消息

### 步骤 4: 处理消息

#### 方式 1: 交互式 CLI

```bash
npm run cli
```

选择消息，输入回复，自动发送。

#### 方式 2: 命令行

```bash
# 查看消息
npm run cli list

# 查看详情
npm run cli show a1b2c3d4-e5f6

# 发送回复
npm run cli respond a1b2c3d4-e5f6 "你好！我是 Claude AI 助手，很高兴为你服务。"
```

#### 方式 3: 直接文件操作

```bash
# 查看消息文件
cat messages/a1b2c3d4-e5f6.json

# 创建响应文件
echo '{"content":"你好！我是 Claude AI 助手。"}' > responses/a1b2c3d4-e5f6.json
```

### 步骤 5: 验证响应

在飞书客户端，应该收到你的回复！

---

## 常见问题

### Q1: Webhook 验证失败

**症状**: 飞书显示 "请求网址验证失败"

**解决方案**:

1. 确认服务已启动
2. 确认 ngrok 正在运行
3. 检查端口是否正确（默认 3000）
4. 查看服务器日志是否有错误

### Q2: 收不到消息

**症状**: 发送消息后没有反应

**检查清单**:

- [ ] 应用是否已发布或设置为测试应用
- [ ] 你是否在测试用户列表中
- [ ] 权限是否已开通
- [ ] 事件是否已订阅
- [ ] Webhook 地址是否正确
- [ ] 服务器是否正在运行
- [ ] ngrok 是否正在运行

### Q3: 消息发送失败

**症状**: 服务器日志显示 "Failed to send message"

**可能原因**:

1. App Secret 配置错误
2. App Access Token 过期（重启服务即可）
3. 权限不足

### Q4: ngrok 地址变化

**症状**: 重启 ngrok 后，Webhook 失效

**解决方案**:

1. 更新飞书开放平台的 Webhook 地址
2. 或使用付费版 ngrok 获得固定域名

### Q5: 端口被占用

**症状**: 服务启动失败，显示端口已被使用

**解决方案**:

系统会自动尝试下一个端口（3001, 3002...），无需手动处理。

---

## 完整流程图

```
┌─────────────────────────────────────────────────────────┐
│  飞书开放平台配置                                         │
└─────────────────────────────────────────────────────────┘
                          │
                          ├─ 1. 创建应用
                          │    └─ 获取 App ID & App Secret
                          │
                          ├─ 2. 开启机器人能力
                          │    └─ 配置机器人信息
                          │
                          ├─ 3. 配置权限
                          │    └─ im:message, im:chat
                          │
                          ├─ 4. 配置内网穿透
                          │    └─ 启动 ngrok
                          │
                          ├─ 5. 配置 Webhook
                          │    ├─ 设置请求网址
                          │    ├─ 订阅事件
                          │    └─ 获取 Token & Key
                          │
                          └─ 6. 发布应用
                               └─ 添加测试用户

┌─────────────────────────────────────────────────────────┐
│  本地服务配置                                             │
└─────────────────────────────────────────────────────────┘
                          │
                          ├─ 1. 安装依赖
                          │    └─ npm install
                          │
                          ├─ 2. 配置环境变量
                          │    └─ 编辑 config/.env
                          │
                          ├─ 3. 构建项目
                          │    └─ npm run build
                          │
                          ├─ 4. 启动服务
                          │    ├─ npm run dev
                          │    └─ 查看 Bot Open ID
                          │
                          └─ 5. 测试
                               ├─ 私聊测试
                               ├─ 群聊测试
                               └─ CLI 处理消息
```

---

## 快速检查清单

### 飞书开放平台

- [ ] 创建应用
- [ ] 开启机器人能力
- [ ] 获取 App ID
- [ ] 获取 App Secret
- [ ] 开通权限 (im:message, im:chat)
- [ ] 订阅事件 (im.message.receive_v1)
- [ ] 配置 Webhook 地址
- [ ] 获取 Verification Token
- [ ] 获取 Encrypt Key
- [ ] 发布应用或添加测试用户

### 本地环境

- [ ] 安装 Node.js (>= 16)
- [ ] 安装项目依赖 (npm install)
- [ ] 创建配置文件 (config/.env)
- [ ] 填写所有必需的环境变量
- [ ] 安装并启动 ngrok
- [ ] 构建项目 (npm run build)
- [ ] 启动服务 (npm run dev)

### 测试验证

- [ ] 私聊发送消息
- [ ] 查看服务器日志
- [ ] 使用 CLI 查看消息
- [ ] 使用 CLI 发送响应
- [ ] 在飞书收到回复

---

## 下一步

配置完成后，你可以：

1. **集成 Claude API**: 在 CLI 或脚本中调用 Claude API 自动处理消息
2. **添加更多功能**: 图片处理、文件分析等
3. **部署到生产**: 使用域名 + HTTPS 替代 ngrok
4. **监控和日志**: 添加日志分析和监控

祝你使用愉快！🎉