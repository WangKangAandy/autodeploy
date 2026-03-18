import type { Request, Response } from "express"

/** Platform identifier - string type for extensibility */
export type PlatformId = string

/** Chat type enumeration */
export type ChatType = "private" | "group" | "channel"

/** Message content type */
export type MessageContentType = "text" | "image" | "file" | "audio" | "video" | "mixed"

/** Send message type */
export type SendMessageType = "text" | "markdown" | "card" | "image"

/** Attachment structure */
export interface Attachment {
  type: string
  content: string
  name?: string
  size?: number
  mimeType?: string
}

/** Mention structure */
export interface Mention {
  id: string
  idType: string
  key?: string
  name?: string
}

/** Unified message structure - all platforms use this */
export interface UnifiedMessage {
  /** Unique message ID */
  id: string
  /** Platform identifier */
  platform: PlatformId
  /** Chat information */
  chat: {
    id: string
    type: ChatType
    name?: string
  }
  /** Sender information */
  sender: {
    id: string
    name?: string
    avatar?: string
  }
  /** Message content */
  content: {
    text: string
    type: MessageContentType
    attachments?: Attachment[]
    mentions?: Mention[]
  }
  /** Message timestamp (Unix milliseconds) */
  timestamp: number
  /** Original platform event for debugging */
  raw: unknown
}

/** Card button for interactive messages */
export interface CardButton {
  label: string
  action: string
  type?: "primary" | "default" | "danger"
}

/** Card content for interactive messages */
export interface CardContent {
  title?: string
  subtitle?: string
  content?: string
  buttons?: CardButton[]
  /** Platform-specific card data */
  extra?: Record<string, unknown>
}

/** Send options */
export interface SendOptions {
  /** Message type */
  type?: SendMessageType
  /** Reply to message ID */
  replyTo?: string
  /** Mention user IDs */
  mentions?: string[]
  /** Card content for interactive messages */
  card?: CardContent
}

/** Message result after sending */
export interface MessageResult {
  /** Success status */
  success: boolean
  /** Message ID if sent successfully */
  messageId?: string
  /** Error message if failed */
  error?: string
}

/** User information */
export interface UserInfo {
  id: string
  name?: string
  avatar?: string
  email?: string
}

/** Platform adapter interface - all platforms must implement this */
export interface PlatformAdapter {
  /** Platform unique identifier */
  readonly id: PlatformId

  /** Platform display name */
  readonly name: string

  /** Initialize adapter with platform-specific config */
  initialize(config: Record<string, unknown>): Promise<void>

  /** Get bot information */
  getBotInfo(): Promise<{ id: string; name: string }>

  /** Webhook route path (relative to /webhook/) */
  getWebhookPath(): string

  /** Handle webhook request */
  handleWebhook(req: Request, res: Response): Promise<void>

  /** Send message to target */
  sendMessage(targetId: string, content: string, options?: SendOptions): Promise<MessageResult>

  /** Get user information (optional) */
  getUserInfo?(userId: string): Promise<UserInfo>

  /** Get group members (optional) */
  getGroupMembers?(groupId: string): Promise<UserInfo[]>

  /** Dispose resources (optional) */
  dispose?(): Promise<void>
}

/** Adapter constructor type */
export interface PlatformAdapterConstructor {
  new (): PlatformAdapter
}

/** Platform configuration */
export interface PlatformConfig {
  /** Platform type (adapter ID) */
  type: PlatformId

  /** Whether platform is enabled */
  enabled: boolean

  /** Platform-specific configuration */
  [key: string]: unknown
}

/** Claude configuration */
export interface ClaudeConfig {
  apiKey: string
  model?: string
  systemPrompt?: string
  maxTokens?: number
}

/** Tools configuration */
export interface ToolsConfig {
  enabled?: boolean
  agentToolsPath?: string
}

/** Queue configuration */
export interface QueueConfig {
  messageQueueDir: string
  responseQueueDir: string
}

/** Server configuration */
export interface ServerConfig {
  port: number
  host?: string
  nodeEnv?: string
}

/** Application configuration - supports multiple platforms */
export interface AppConfig {
  server: ServerConfig
  platforms: PlatformConfig[]
  claude: ClaudeConfig
  tools?: ToolsConfig
  queue: QueueConfig
}

/** Message handler function type */
export type MessageHandler = (message: UnifiedMessage) => Promise<void>

/** Platform-specific event map for typing */
export interface PlatformEventMap {
  feishu: import("../platforms/feishu/types").FeishuMessageEvent
  dingtalk: import("../platforms/dingtalk/types").DingTalkMessageEvent
  // Add more platforms as needed
}