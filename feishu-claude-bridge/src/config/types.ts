export interface FeishuConfig {
  appId: string
  appSecret: string
  verificationToken: string
  encryptKey: string
}

export interface ClaudeConfig {
  apiKey: string
  model?: string
  systemPrompt?: string
}

export interface ServerConfig {
  port: number
  nodeEnv: string
}

export interface QueueConfig {
  messageQueueDir: string
  responseQueueDir: string
}

export interface AppConfig {
  server: ServerConfig
  feishu: FeishuConfig
  claude: ClaudeConfig
  queue: QueueConfig
}