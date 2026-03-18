import { z } from "zod"
import type { AppConfig, PlatformConfig } from "./types.js"
import { getEnvVar, loadEnv } from "./loader.js"

/**
 * Schema for server configuration
 */
const ServerConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
  nodeEnv: z.string().default("development"),
  host: z.string().optional()
})

/**
 * Schema for Claude configuration
 */
const ClaudeConfigSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().default("claude-sonnet-4-20250514"),
  systemPrompt: z.string().default("你是一个友好、有帮助的AI助手。请用中文回复用户的问题。"),
  maxTokens: z.coerce.number().int().positive().optional()
})

/**
 * Schema for queue configuration
 */
const QueueConfigSchema = z.object({
  messageQueueDir: z.string().default("./messages"),
  responseQueueDir: z.string().default("./responses")
})

/**
 * Schema for tools configuration
 */
const ToolsConfigSchema = z.object({
  enabled: z.coerce.boolean().default(true),
  agentToolsPath: z.string().optional()
}).optional()

/**
 * Schema for a single platform configuration
 */
const PlatformConfigSchema = z.object({
  type: z.string().min(1),
  enabled: z.coerce.boolean().default(true)
}).passthrough() // Allow platform-specific fields

/**
 * Schema for platforms array
 */
const PlatformsSchema = z.array(PlatformConfigSchema).min(1)

/**
 * Schema for the new multi-platform AppConfig
 */
const AppConfigSchema = z.object({
  server: ServerConfigSchema,
  platforms: PlatformsSchema,
  claude: ClaudeConfigSchema,
  queue: QueueConfigSchema,
  tools: ToolsConfigSchema
})

/**
 * Load legacy Feishu configuration from environment variables
 */
function loadLegacyFeishuConfig(): PlatformConfig {
  // Get connection mode from env, default to webhook for backward compatibility
  // Set FEISHU_CONNECTION_MODE=long-connection to use WebSocket mode
  const connectionMode = getEnvVar("FEISHU_CONNECTION_MODE", false) || "webhook"

  return {
    type: "feishu",
    enabled: true,
    appId: getEnvVar("FEISHU_APP_ID", true)!,
    appSecret: getEnvVar("FEISHU_APP_SECRET", true)!,
    connectionMode: connectionMode as "webhook" | "long-connection",
    // These are only required for webhook mode
    verificationToken: getEnvVar("FEISHU_VERIFICATION_TOKEN", false) || "",
    encryptKey: getEnvVar("FEISHU_ENCRYPT_KEY", false) || ""
  }
}

/**
 * Load DingTalk configuration from environment variables
 */
function loadDingTalkConfig(): PlatformConfig | null {
  const appKey = getEnvVar("DINGTALK_APP_KEY", false)
  const appSecret = getEnvVar("DINGTALK_APP_SECRET", false)
  const agentId = getEnvVar("DINGTALK_AGENT_ID", false)
  const encodingAESKey = getEnvVar("DINGTALK_ENCODING_AES_KEY", false)

  if (!appKey || !appSecret || !agentId || !encodingAESKey) {
    return null
  }

  return {
    type: "dingtalk",
    enabled: getEnvVar("DINGTALK_ENABLED", false) !== "false",
    appKey,
    appSecret,
    agentId,
    encodingAESKey
  }
}

/**
 * Check if multi-platform config is available
 */
function hasMultiPlatformConfig(): boolean {
  // Check for new-style config via PLATFORMS env var
  const platforms = getEnvVar("PLATFORMS", false)
  if (platforms) {
    try {
      const parsed = JSON.parse(platforms)
      return Array.isArray(parsed) && parsed.length > 0
    } catch {
      // Not valid JSON, ignore
    }
  }
  return false
}

/**
 * Parse platforms from PLATFORMS env var
 */
function parsePlatformsFromEnv(): PlatformConfig[] {
  const platforms = getEnvVar("PLATFORMS", false)
  if (!platforms) {
    return []
  }

  try {
    const parsed = JSON.parse(platforms)
    if (Array.isArray(parsed)) {
      return parsed
    }
  } catch (error) {
    console.warn(`Failed to parse PLATFORMS env var: ${error}`)
  }

  return []
}

/**
 * Validate and load configuration
 */
export function validateConfig(): AppConfig {
  // Synchronously load environment variables
  loadEnv()

  // Build platforms array
  let platforms: PlatformConfig[]

  if (hasMultiPlatformConfig()) {
    // Use new multi-platform config
    platforms = parsePlatformsFromEnv()
  } else {
    // Use legacy config (Feishu from individual env vars)
    platforms = []

    // Always add Feishu (required for backward compatibility)
    platforms.push(loadLegacyFeishuConfig())

    // Optionally add DingTalk if configured
    const dingtalkConfig = loadDingTalkConfig()
    if (dingtalkConfig) {
      platforms.push(dingtalkConfig)
    }
  }

  const rawConfig = {
    server: {
      port: getEnvVar("PORT", false) || "3000",
      nodeEnv: getEnvVar("NODE_ENV", false) || "development",
      host: getEnvVar("SERVER_HOST", false) || undefined
    },
    platforms,
    claude: {
      apiKey: getEnvVar("ANTHROPIC_API_KEY", true)!,
      model: getEnvVar("CLAUDE_MODEL", false) || "claude-sonnet-4-20250514",
      systemPrompt: getEnvVar("CLAUDE_SYSTEM_PROMPT", false) || "你是一个友好、有帮助的AI助手。请用中文回复用户的问题。",
      maxTokens: getEnvVar("CLAUDE_MAX_TOKENS", false) || undefined
    },
    queue: {
      messageQueueDir: getEnvVar("MESSAGE_QUEUE_DIR", false) || "./messages",
      responseQueueDir: getEnvVar("RESPONSE_QUEUE_DIR", false) || "./responses"
    },
    tools: {
      enabled: getEnvVar("TOOLS_ENABLED", false) !== "false",
      agentToolsPath: getEnvVar("AGENT_TOOLS_PATH", false) || undefined
    }
  }

  try {
    return AppConfigSchema.parse(rawConfig)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map((e) => `${e.path.join(".")}: ${e.message}`)
      throw new Error(`Configuration validation failed:\n${messages.join("\n")}`)
    }
    throw error
  }
}

/**
 * Load and return validated configuration
 */
export function loadConfig(): AppConfig {
  return validateConfig()
}

/**
 * Get enabled platforms from config
 */
export function getEnabledPlatforms(config: AppConfig): PlatformConfig[] {
  return config.platforms.filter((p) => p.enabled)
}