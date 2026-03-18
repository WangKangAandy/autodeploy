import type { FeishuApiResponse, FeishuBotInfo } from "./types.js"
import { logger } from "../../utils/logger.js"

/**
 * Feishu API Client
 *
 * Handles authentication and API calls to Feishu Open Platform
 */
export class FeishuApiClient {
  private appId: string
  private appSecret: string
  private baseUrl: string
  private appAccessToken: string | null = null
  private tokenExpiry: number = 0
  private refreshPromise: Promise<string> | null = null

  constructor(appId: string, appSecret: string, baseUrl?: string) {
    this.appId = appId
    this.appSecret = appSecret
    this.baseUrl = baseUrl || process.env.FEISHU_BASE_URL || "https://open.feishu.cn"
  }

  /**
   * Get a valid app access token (auto-refresh if expired)
   */
  async getAppAccessToken(): Promise<string> {
    // Check if token is still valid (5 minute buffer)
    const now = Date.now()
    if (this.appAccessToken && this.tokenExpiry > now + 5 * 60 * 1000) {
      return this.appAccessToken
    }

    // If already refreshing, wait for it
    if (this.refreshPromise) {
      return this.refreshPromise
    }

    // Refresh the token
    this.refreshPromise = this.refreshToken()
    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  /**
   * Refresh the app access token
   */
  private async refreshToken(): Promise<string> {
    logger.info("Refreshing Feishu app access token...")

    const response = await fetch(`${this.baseUrl}/open-apis/auth/v3/app_access_token/internal`, {
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

    // Feishu returns app_access_token at root level, not in data
    const result = (await response.json()) as FeishuApiResponse & { app_access_token?: string; expire?: number }

    if (result.code !== 0 || !result.app_access_token) {
      throw new Error(`Failed to get app access token: code=${result.code} msg=${result.msg}`)
    }

    this.appAccessToken = result.app_access_token
    this.tokenExpiry = Date.now() + (result.expire || 7200) * 1000

    logger.info(`Feishu token refreshed, expires at ${new Date(this.tokenExpiry).toISOString()}`)

    return this.appAccessToken
  }

  /**
   * Force refresh the token (used on auth errors)
   */
  async forceRefresh(): Promise<string> {
    this.appAccessToken = null
    this.tokenExpiry = 0
    return this.getAppAccessToken()
  }

  /**
   * Get bot information
   */
  async getBotInfo(): Promise<FeishuBotInfo> {
    const token = await this.getAppAccessToken()

    const response = await fetch(`${this.baseUrl}/open-apis/bot/v3/info`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    })

    if (!response.ok) {
      throw new Error(`Failed to get bot info: ${response.status}`)
    }

    // Feishu bot info API returns bot info at root level
    const result = (await response.json()) as FeishuApiResponse & { bot?: FeishuBotInfo }

    if (result.code !== 0 || !result.bot) {
      throw new Error(`Failed to get bot info: code=${result.code} msg=${result.msg}`)
    }

    return result.bot
  }

  /**
   * Send a message
   */
  async sendMessage(
    receiveId: string,
    msgType: string,
    content: string,
    receiveIdType: "open_id" | "chat_id" | "user_id" = "open_id"
  ): Promise<string> {
    const token = await this.getAppAccessToken()

    const response = await fetch(
      `${this.baseUrl}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: msgType,
          content: content
        })
      }
    )

    // Feishu returns message_id at root level in data object
    const result = (await response.json()) as FeishuApiResponse & { data?: { message_id?: string } }

    // Handle token expiry
    if (result.code === 99991663 || result.code === 99991661) {
      logger.warn("Feishu token expired, refreshing and retrying...")
      const newToken = await this.forceRefresh()

      const retryResponse = await fetch(
        `${this.baseUrl}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${newToken}`
          },
          body: JSON.stringify({
            receive_id: receiveId,
            msg_type: msgType,
            content: content
          })
        }
      )

      const retryResult = (await retryResponse.json()) as FeishuApiResponse & { data?: { message_id?: string } }
      if (retryResult.code !== 0) {
        throw new Error(`Failed to send message: code=${retryResult.code} msg=${retryResult.msg}`)
      }

      return retryResult.data?.message_id || ""
    }

    if (result.code !== 0) {
      throw new Error(`Failed to send message: code=${result.code} msg=${result.msg}`)
    }

    return result.data?.message_id || ""
  }

  /**
   * Get user info (optional implementation)
   */
  async getUserInfo(userId: string): Promise<{ open_id: string; name?: string }> {
    const token = await this.getAppAccessToken()

    const response = await fetch(
      `${this.baseUrl}/open-apis/contact/v3/users/${userId}?user_id_type=open_id`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.status}`)
    }

    const result = (await response.json()) as FeishuApiResponse<{ user: { open_id: string; name?: string } }>

    if (result.code !== 0) {
      throw new Error(`Failed to get user info: code=${result.code} msg=${result.msg}`)
    }

    return result.data!.user
  }
}