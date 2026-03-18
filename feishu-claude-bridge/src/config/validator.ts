import { z } from "zod"
import type { AppConfig } from "./types.js"
import { getEnvVar, loadEnv } from "./loader.js"

const AppConfigSchema = z.object({
  server: z.object({
    port: z.coerce.number().int().positive().default(3000),
    nodeEnv: z.string().default("development")
  }),
  feishu: z.object({
    appId: z.string().min(1),
    appSecret: z.string().min(1),
    verificationToken: z.string().default(""),  // 可以为空，URL验证后再配置
    encryptKey: z.string().default("")          // 可以为空，URL验证后再配置
  }),
  claude: z.object({
    apiKey: z.string().min(1),
    model: z.string().default("claude-sonnet-4-20250514"),
    systemPrompt: z.string().default("你是一个友好、有帮助的AI助手。请用中文回复用户的问题。")
  }),
  queue: z.object({
    messageQueueDir: z.string().default("./messages"),
    responseQueueDir: z.string().default("./responses")
  })
})

export function validateConfig(): AppConfig {
  // 同步加载环境变量
  loadEnv()

  const rawConfig = {
    server: {
      port: getEnvVar("PORT", false) || "3000",
      nodeEnv: getEnvVar("NODE_ENV", false) || "development"
    },
    feishu: {
      appId: getEnvVar("FEISHU_APP_ID", true)!,
      appSecret: getEnvVar("FEISHU_APP_SECRET", true)!,
      verificationToken: getEnvVar("FEISHU_VERIFICATION_TOKEN", false) || "",
      encryptKey: getEnvVar("FEISHU_ENCRYPT_KEY", false) || ""
    },
    claude: {
      apiKey: getEnvVar("ANTHROPIC_API_KEY", true)!,
      model: getEnvVar("CLAUDE_MODEL", false) || "claude-sonnet-4-20250514",
      systemPrompt: getEnvVar("CLAUDE_SYSTEM_PROMPT", false) || "你是一个友好、有帮助的AI助手。请用中文回复用户的问题。"
    },
    queue: {
      messageQueueDir: getEnvVar("MESSAGE_QUEUE_DIR", false) || "./messages",
      responseQueueDir: getEnvVar("RESPONSE_QUEUE_DIR", false) || "./responses"
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

export function loadConfig(): AppConfig {
  return validateConfig()
}