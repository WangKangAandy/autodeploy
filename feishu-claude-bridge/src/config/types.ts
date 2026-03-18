import type { PlatformId } from "../core/types.js"

/**
 * Legacy Feishu configuration (for backward compatibility)
 */
export interface FeishuConfig {
  appId: string
  appSecret: string
  verificationToken: string
  encryptKey: string
}

/**
 * Claude API configuration
 */
export interface ClaudeConfig {
  apiKey: string
  model?: string
  systemPrompt?: string
  maxTokens?: number
}

/**
 * Server configuration
 */
export interface ServerConfig {
  port: number
  nodeEnv?: string
  host?: string
}

/**
 * Queue configuration
 */
export interface QueueConfig {
  messageQueueDir: string
  responseQueueDir: string
}

/**
 * Tools configuration
 */
export interface ToolsConfig {
  enabled?: boolean
  agentToolsPath?: string
}

/**
 * Platform-specific configuration
 */
export interface PlatformConfig {
  /** Platform type (adapter ID) */
  type: PlatformId

  /** Whether platform is enabled */
  enabled: boolean

  /** Platform-specific configuration fields */
  [key: string]: unknown
}

/**
 * Feishu-specific platform configuration
 */
export interface FeishuPlatformConfig extends PlatformConfig {
  type: "feishu"
  appId: string
  appSecret: string
  verificationToken?: string
  encryptKey?: string
}

/**
 * DingTalk-specific platform configuration
 */
export interface DingTalkPlatformConfig extends PlatformConfig {
  type: "dingtalk"
  appKey: string
  appSecret: string
  agentId: string
  encodingAESKey: string
}

/**
 * Application configuration (new multi-platform format)
 */
export interface AppConfig {
  server: ServerConfig
  platforms: PlatformConfig[]
  claude: ClaudeConfig
  queue: QueueConfig
  tools?: ToolsConfig
}

/**
 * Legacy application configuration (for backward compatibility)
 * @deprecated Use AppConfig instead
 */
export interface LegacyAppConfig {
  server: ServerConfig
  feishu: FeishuConfig
  claude: ClaudeConfig
  queue: QueueConfig
  tools?: ToolsConfig
}