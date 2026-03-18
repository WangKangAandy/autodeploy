import * as dotenv from "dotenv"
import * as path from "path"

export function loadEnv() {
  // 优先从当前工作目录的 config/.env 加载
  const cwd = process.cwd()

  // 尝试多个可能的 .env 路径
  const envPaths = [
    path.join(cwd, "config", ".env"),
    path.join(cwd, ".env"),
  ]

  for (const envPath of envPaths) {
    const result = dotenv.config({ path: envPath })
    if (!result.error) {
      console.log(`[loadEnv] Loaded .env from: ${envPath}`)
      return process.env
    }
  }

  // 最后尝试默认路径
  dotenv.config()
  return process.env
}

// 获取环境变量，优先使用已设置的环境变量（如系统环境变量），然后才用 .env 文件
export function getEnvVar(key: string, required: true): string
export function getEnvVar(key: string, required?: false): string | undefined
export function getEnvVar(key: string, required = false): string | undefined {
  // process.env 已经包含了系统环境变量和 .env 文件的值
  const value = process.env[key]
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}