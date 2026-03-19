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

  /**
   * 获取钉钉文档内容
   * 钉钉文档 URL 格式: https://alidocs.dingtalk.com/i/nodes/{docId}
   * API 文档: https://open.dingtalk.com/document/orgapp/obtain-the-details-of-a-knowledge-base
   * 权限要求: qyapi_wiki_read (企业知识库只读权限)
   */
  async fetchDocument(docId: string): Promise<{ success: boolean; content: string; title?: string; error?: string }> {
    try {
      const token = await this.getAccessToken()

      // 钉钉知识库文档 API - 获取文档详情
      // 需要权限: qyapi_wiki_read (企业知识库只读权限)
      const response = await fetch(
        `https://oapi.dingtalk.com/topapi/wiki/doc/detail?access_token=${token}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            doc_id: docId,
          }),
        }
      )

      if (!response.ok) {
        return {
          success: false,
          content: "",
          error: `HTTP error: ${response.status}`,
        }
      }

      const result = (await response.json()) as DingTalkApiResponse & {
        result?: {
          doc_name?: string
          content?: string
          text_content?: string
          main_text?: string
        }
        sub_code?: string
        sub_msg?: string
      }

      // Handle permission errors
      // 钉钉权限已从旧格式 qyapi_wiki_read 迁移到新 OAuth 2.0 格式
      if (result.errcode === 88 && result.sub_code === "60011") {
        return {
          success: false,
          content: "",
          error: `应用缺少知识库/文档读取权限。

请在钉钉开发者后台开通以下权限：
1. 进入应用 → 权限管理 → 申请权限
2. 搜索并申请以下权限：
   - Wiki.Workspace.Read (企业知识库只读权限)
   - Document.WorkspaceDocument.Read (钉钉文档读取权限)
3. 等待权限审批通过并生效（可能需要几分钟）

注意：旧权限代码 qyapi_wiki_read 已废弃，新权限采用 OAuth 2.0 格式。

错误详情: ${result.sub_msg}`,
        }
      }

      if (result.errcode !== 0) {
        return {
          success: false,
          content: "",
          error: `API error: ${result.errmsg} (errcode: ${result.errcode}, sub_code: ${result.sub_code || 'N/A'})`,
        }
      }

      const title = result.result?.doc_name || "钉钉文档"
      // 钉钉文档内容可能在多个字段
      const content = result.result?.text_content
        || result.result?.main_text
        || result.result?.content
        || ""

      if (!content) {
        return {
          success: false,
          content: "",
          error: `文档内容为空。文档可能不支持通过API读取，或内容格式不兼容。

文档标题: ${title}
文档ID: ${docId}

请确认：
1. 文档是企业知识库文档（而非个人文档）
2. 应用有权限访问该文档
3. 文档类型支持API读取`,
        }
      }

      return { success: true, content, title }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error(`Error fetching DingTalk document: ${errorMessage}`)
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