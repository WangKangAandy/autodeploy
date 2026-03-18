import { logger } from "./logger.js"

// Token manager to handle automatic token refresh
class TokenManager {
  private appId: string
  private appSecret: string
  private token: string | null = null
  private tokenExpiry: number = 0
  private refreshPromise: Promise<string> | null = null

  constructor(appId: string, appSecret: string) {
    this.appId = appId
    this.appSecret = appSecret
  }

  async getToken(): Promise<string> {
    // If token is still valid (with 5 minute buffer), return it
    const now = Date.now()
    if (this.token && this.tokenExpiry > now + 5 * 60 * 1000) {
      return this.token
    }

    // If already refreshing, wait for that
    if (this.refreshPromise) {
      return this.refreshPromise
    }

    // Refresh the token
    this.refreshPromise = this.refreshToken()
    try {
      const token = await this.refreshPromise
      return token
    } finally {
      this.refreshPromise = null
    }
  }

  private async refreshToken(): Promise<string> {
    logger.info("Refreshing Feishu app access token...")

    const baseUrl = process.env.FEISHU_BASE_URL || "https://open.feishu.cn"
    const response = await fetch(`${baseUrl}/open-apis/auth/v3/app_access_token/internal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to get app access token: ${response.status} ${errorText}`)
    }

    const result = (await response.json()) as {
      code: number
      app_access_token?: string
      expire?: number
      msg?: string
    }

    if (result.code !== 0) {
      throw new Error(`Failed to get app access token: ${result.msg}`)
    }

    if (!result.app_access_token) {
      throw new Error("No app_access_token in response")
    }

    this.token = result.app_access_token
    // Token typically expires in 2 hours, use the expire value if provided
    this.tokenExpiry = Date.now() + (result.expire || 7200) * 1000

    // Update the environment variable for backward compatibility
    process.env.FEISHU_APP_ACCESS_TOKEN = this.token

    logger.info(`Token refreshed, expires at ${new Date(this.tokenExpiry).toISOString()}`)

    return this.token
  }

  // Force refresh on auth error
  async forceRefresh(): Promise<string> {
    this.token = null
    this.tokenExpiry = 0
    return this.getToken()
  }
}

// Global token manager instance
let tokenManager: TokenManager | null = null

export function initTokenManager(appId: string, appSecret: string): void {
  tokenManager = new TokenManager(appId, appSecret)
}

export async function sendMessage(
  receiveId: string,
  message: { msgType: string; content: string },
  receiveIdType?: "open_id" | "chat_id"
): Promise<void> {
  if (!tokenManager) {
    throw new Error("Token manager not initialized. Call initTokenManager first.")
  }

  const baseUrl = process.env.FEISHU_BASE_URL || "https://open.feishu.cn"
  const idType = receiveIdType || "open_id"

  // Get a valid token (will refresh if needed)
  const appAccessToken = await tokenManager.getToken()

  const response = await fetch(`${baseUrl}/open-apis/im/v1/messages?receive_id_type=${idType}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${appAccessToken}`
    },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: message.msgType,
      content: message.content
    })
  })

  const result = await response.json() as { code: number; msg?: string }

  // If token is invalid, try to refresh and retry once
  if (result.code === 99991663 || result.code === 99991661) {
    logger.warn("Token expired, refreshing and retrying...")
    const newToken = await tokenManager.forceRefresh()

    const retryResponse = await fetch(`${baseUrl}/open-apis/im/v1/messages?receive_id_type=${idType}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${newToken}`
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: message.msgType,
        content: message.content
      })
    })

    if (!retryResponse.ok) {
      const errorText = await retryResponse.text()
      throw new Error(`Failed to send message after token refresh: ${retryResponse.status} ${errorText}`)
    }

    const retryResult = await retryResponse.json() as { code: number; msg?: string }
    if (retryResult.code !== 0) {
      throw new Error(`Failed to send message: ${JSON.stringify(retryResult)}`)
    }

    logger.info(`Message sent successfully after token refresh`)
    return
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to send message: ${response.status} ${errorText}`)
  }

  if (result.code !== 0) {
    throw new Error(`Failed to send message: ${JSON.stringify(result)}`)
  }

  logger.info(`Message sent successfully`)
}

export async function getAppAccessToken(
  appId: string,
  appSecret: string
): Promise<string> {
  if (!tokenManager) {
    tokenManager = new TokenManager(appId, appSecret)
  }
  return tokenManager.getToken()
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}