import type { DingTalkApiResponse, DingTalkUserInfo } from "./types.js"
import { logger } from "../../utils/logger.js"

/**
 * DingTalk API Client
 *
 * Handles authentication and API calls to DingTalk Open Platform
 */
export class DingTalkApiClient {
  private appKey: string
  private appSecret: string
  private agentId: string
  private baseUrl: string
  private accessToken: string | null = null
  private tokenExpiry: number = 0
  private refreshPromise: Promise<string> | null = null

  constructor(appKey: string, appSecret: string, agentId: string, baseUrl?: string) {
    this.appKey = appKey
    this.appSecret = appSecret
    this.agentId = agentId
    this.baseUrl = baseUrl || "https://api.dingtalk.com"
  }

  /**
   * Get a valid access token (auto-refresh if expired)
   */
  async getAccessToken(): Promise<string> {
    // Check if token is still valid (5 minute buffer)
    const now = Date.now()
    if (this.accessToken && this.tokenExpiry > now + 5 * 60 * 1000) {
      return this.accessToken
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
   * Refresh the access token
   */
  private async refreshToken(): Promise<string> {
    logger.info("Refreshing DingTalk access token...")

    // Use oapi endpoint for token
    const response = await fetch(
      `https://oapi.dingtalk.com/gettoken?appkey=${this.appKey}&appsecret=${this.appSecret}`
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to get access token: ${response.status} ${errorText}`)
    }

    const result = (await response.json()) as DingTalkApiResponse & { access_token?: string; expires_in?: number }

    if (result.errcode !== 0) {
      throw new Error(`Failed to get access token: errcode=${result.errcode} errmsg=${result.errmsg}`)
    }

    this.accessToken = result.access_token!
    this.tokenExpiry = Date.now() + (result.expires_in || 7200) * 1000

    logger.info(`DingTalk token refreshed, expires at ${new Date(this.tokenExpiry).toISOString()}`)

    return this.accessToken
  }

  /**
   * Force refresh the token
   */
  async forceRefresh(): Promise<string> {
    this.accessToken = null
    this.tokenExpiry = 0
    return this.getAccessToken()
  }

  /**
   * Send a message to a user (private chat)
   */
  async sendPrivateMessage(
    userId: string,
    msgType: string,
    content: unknown
  ): Promise<string> {
    const token = await this.getAccessToken()

    const response = await fetch(
      `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${token}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: this.agentId,
          userid_list: userId,
          msgtype: msgType,
          [msgType]: content,
        }),
      }
    )

    const result = (await response.json()) as DingTalkApiResponse<{ task_id: string }>

    // Handle token expiry
    if (result.errcode === 40014 || result.errcode === 42001) {
      logger.warn("DingTalk token expired, refreshing and retrying...")
      await this.forceRefresh()
      return this.sendPrivateMessage(userId, msgType, content)
    }

    if (result.errcode !== 0) {
      throw new Error(`Failed to send message: errcode=${result.errcode} errmsg=${result.errmsg}`)
    }

    return result.result!.task_id
  }

  /**
   * Send a message to a group chat
   */
  async sendGroupMessage(
    chatId: string,
    msgType: string,
    content: unknown,
    robotCode?: string
  ): Promise<string> {
    const token = await this.getAccessToken()

    const response = await fetch(
      `${this.baseUrl}/v1.0/robot/oToMessages/batchSend?access_token=${token}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          robotCode: robotCode || this.appKey,
          chatId: chatId,
          msgtype: msgType,
          [msgType]: content,
        }),
      }
    )

    const result = (await response.json()) as DingTalkApiResponse<{ processQueryKeys?: string[] }>

    if (result.errcode !== 0) {
      throw new Error(`Failed to send group message: errcode=${result.errcode} errmsg=${result.errmsg}`)
    }

    return result.result?.processQueryKeys?.[0] || ""
  }

  /**
   * Get user info
   */
  async getUserInfo(userId: string): Promise<DingTalkUserInfo> {
    const token = await this.getAccessToken()

    const response = await fetch(
      `https://oapi.dingtalk.com/topapi/v2/user/get?access_token=${token}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userid: userId }),
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.status}`)
    }

    const result = (await response.json()) as DingTalkApiResponse<DingTalkUserInfo>

    if (result.errcode !== 0) {
      throw new Error(`Failed to get user info: errcode=${result.errcode} errmsg=${result.errmsg}`)
    }

    return result.result!
  }

  /**
   * Get robot info
   */
  getRobotInfo(): { id: string; name: string } {
    return { id: this.agentId, name: "Claude Bot" }
  }

  // 钉钉文档 MCP API 配置
  private static readonly DINGTALK_DOCS_MCP_URL = "https://mcp.api-inference.modelscope.net/f1ca1e7fee654d/mcp"

  /**
   * 获取钉钉文档内容 (通过 MCP API)
   * 钉钉文档 URL 格式: https://alidocs.dingtalk.com/i/nodes/{docId}
   * 使用钉钉文档 MCP 服务，无需企业级应用权限
   */
  async fetchDocument(docId: string): Promise<{ success: boolean; content: string; title?: string; error?: string }> {
    try {
      const docUrl = `https://alidocs.dingtalk.com/i/nodes/${docId}`
      logger.info(`Fetching DingTalk document via MCP: ${docId}`)

      // 调用钉钉文档 MCP API
      const response = await fetch(DingTalkApiClient.DINGTALK_DOCS_MCP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: {
            name: "get_document_content_by_url",
            arguments: {
              docUrl: docUrl,
            },
          },
        }),
      })

      if (!response.ok) {
        return {
          success: false,
          content: "",
          error: `MCP API error: ${response.status}`,
        }
      }

      const result = await response.json() as {
        result?: {
          content?: Array<{ type: string; text: string }>
          structuredContent?: { content?: string; taskStatus?: number }
          isError?: boolean
        }
        error?: { message?: string }
      }

      // 检查 MCP 错误
      if (result.error) {
        return {
          success: false,
          content: "",
          error: `MCP error: ${result.error.message || "Unknown error"}`,
        }
      }

      // 提取文档内容
      let content = ""
      if (result.result?.structuredContent?.content) {
        content = result.result.structuredContent.content
      } else if (result.result?.content?.[0]?.text) {
        // 尝试解析嵌套的 JSON
        try {
          const inner = JSON.parse(result.result.content[0].text)
          content = inner.content || ""
        } catch {
          content = result.result.content[0].text
        }
      }

      if (!content) {
        return {
          success: false,
          content: "",
          error: "文档内容为空或无法解析。请确认文档存在且您有访问权限。",
        }
      }

      // 从内容中提取标题 (第一个标题行)
      const titleMatch = content.match(/^#+\s+(.+)$/m)
      const title = titleMatch ? titleMatch[1] : "钉钉文档"

      return { success: true, content, title }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error(`Error fetching DingTalk document via MCP: ${errorMessage}`)
      return { success: false, content: "", error: errorMessage }
    }
  }

  /**
   * 从钉钉文档 URL 中提取文档 ID
   * URL 格式: https://alidocs.dingtalk.com/i/nodes/{docId}?...
   */
  static extractDocIdFromUrl(url: string): string | null {
    const match = url.match(/alidocs\.dingtalk\.com\/i\/nodes\/([a-zA-Z0-9]+)/)
    return match ? match[1] : null
  }
}