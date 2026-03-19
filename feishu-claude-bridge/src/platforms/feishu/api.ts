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

  /**
   * 获取飞书文档内容
   * 通过遍历文档所有块来提取文本内容
   */
  async fetchDocument(docId: string): Promise<{ success: boolean; content: string; title?: string; error?: string }> {
    try {
      const token = await this.getAppAccessToken()

      // First, get the document root block to obtain title
      const docResponse = await fetch(
        `${this.baseUrl}/open-apis/docx/v1/documents/${docId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      )

      const docResult = (await docResponse.json()) as FeishuApiResponse<{ document: { title: string } }>
      const title = docResult.data?.document?.title || "Untitled"

      // Get all blocks from the document
      const blocksResponse = await fetch(
        `${this.baseUrl}/open-apis/docx/v1/documents/${docId}/blocks/${docId}/children`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      )

      if (!blocksResponse.ok) {
        const errorText = await blocksResponse.text()
        return { success: false, content: "", error: `Failed to fetch document blocks: ${blocksResponse.status} ${errorText}` }
      }

      const blocksResult = (await blocksResponse.json()) as FeishuApiResponse<{ items: BlockItem[] }>

      if (blocksResult.code !== 0) {
        return { success: false, content: "", error: `Failed to fetch document blocks: code=${blocksResult.code} msg=${blocksResult.msg}` }
      }

      // Extract text content from blocks
      const content = await this.extractTextFromBlocks(docId, blocksResult.data?.items || [], token)

      return { success: true, content, title }
    } catch (error: any) {
      logger.error(`Error fetching document: ${error.message}`)
      return { success: false, content: "", error: error.message }
    }
  }

  /**
   * 递归提取文档块中的文本内容
   */
  private async extractTextFromBlocks(
    docId: string,
    items: BlockItem[],
    token: string,
    depth: number = 0
  ): Promise<string> {
    if (depth > 10) return "" // Prevent infinite recursion

    const textParts: string[] = []

    for (const item of items) {
      // Extract text from block based on type
      const blockText = this.extractBlockText(item)
      if (blockText) {
        textParts.push(blockText)
      }

      // Fetch children if present
      if (item.has_children) {
        try {
          const childrenResponse = await fetch(
            `${this.baseUrl}/open-apis/docx/v1/documents/${docId}/blocks/${item.block_id}/children`,
            {
              headers: {
                Authorization: `Bearer ${token}`
              }
            }
          )

          if (childrenResponse.ok) {
            const childrenResult = (await childrenResponse.json()) as FeishuApiResponse<{ items: BlockItem[] }>
            if (childrenResult.code === 0 && childrenResult.data?.items) {
              const childText = await this.extractTextFromBlocks(docId, childrenResult.data.items, token, depth + 1)
              if (childText) {
                textParts.push(childText)
              }
            }
          }
        } catch (error) {
          logger.warn(`Failed to fetch children for block ${item.block_id}`)
        }
      }
    }

    return textParts.join("\n")
  }

  /**
   * 从单个块中提取文本
   */
  private extractBlockText(item: BlockItem): string {
    if (!item.block_type || !item.text?.elements) {
      return ""
    }

    const elements = item.text.elements as TextElement[]
    const text = elements.map((el) => el.text_run?.content || "").join("")

    // Add prefix based on block type
    switch (item.block_type) {
      case "text":
        return text
      case "heading1":
        return `# ${text}`
      case "heading2":
        return `## ${text}`
      case "heading3":
        return `### ${text}`
      case "bullet":
        return `• ${text}`
      case "ordered":
        return `1. ${text}`
      case "code":
        return `\`\`\`\n${text}\n\`\`\``
      case "quote":
        return `> ${text}`
      default:
        return text
    }
  }

  /**
   * 创建飞书文档
   */
  async createDocument(title: string, folderToken?: string): Promise<{ success: boolean; docId?: string; docUrl?: string; error?: string }> {
    try {
      const token = await this.getAppAccessToken()

      const body: Record<string, any> = {
        title: title
      }

      if (folderToken) {
        body.folder_token = folderToken
      }

      const response = await fetch(
        `${this.baseUrl}/open-apis/docx/v1/documents`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(body)
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, error: `Failed to create document: ${response.status} ${errorText}` }
      }

      const result = (await response.json()) as FeishuApiResponse<{ document: { document_id: string } }>

      if (result.code !== 0) {
        return { success: false, error: `Failed to create document: code=${result.code} msg=${result.msg}` }
      }

      const docId = result.data!.document.document_id
      const docUrl = `https://feishu.cn/docx/${docId}`

      logger.info(`Created document: ${docId}`)

      return { success: true, docId, docUrl }
    } catch (error: any) {
      logger.error(`Error creating document: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  /**
   * 更新飞书文档内容（追加文本块）
   */
  async updateDocument(docId: string, content: string): Promise<{ success: boolean; error?: string }> {
    try {
      const token = await this.getAppAccessToken()

      // Create text block content
      const blockData = {
        index: 0,
        children: [
          {
            block_type: 2, // text block
            text: {
              elements: [
                {
                  text_run: {
                    content: content
                  }
                }
              ],
              style: {}
            }
          }
        ]
      }

      const response = await fetch(
        `${this.baseUrl}/open-apis/docx/v1/documents/${docId}/blocks/${docId}/children`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(blockData)
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, error: `Failed to update document: ${response.status} ${errorText}` }
      }

      const result = (await response.json()) as FeishuApiResponse

      if (result.code !== 0) {
        return { success: false, error: `Failed to update document: code=${result.code} msg=${result.msg}` }
      }

      logger.info(`Updated document: ${docId}`)

      return { success: true }
    } catch (error: any) {
      logger.error(`Error updating document: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  /**
   * 获取文件夹信息（用于验证文件夹 token）
   */
  async getFolderInfo(folderToken: string): Promise<{ success: boolean; name?: string; error?: string }> {
    try {
      const token = await this.getAppAccessToken()

      const response = await fetch(
        `${this.baseUrl}/open-apis/drive/v1/files/${folderToken}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, error: `Failed to get folder info: ${response.status} ${errorText}` }
      }

      const result = (await response.json()) as FeishuApiResponse<{ file: { name: string } }>

      if (result.code !== 0) {
        return { success: false, error: `Failed to get folder info: code=${result.code} msg=${result.msg}` }
      }

      return { success: true, name: result.data?.file?.name }
    } catch (error: any) {
      logger.error(`Error getting folder info: ${error.message}`)
      return { success: false, error: error.message }
    }
  }
}

// Types for document blocks
interface BlockItem {
  block_id: string
  block_type?: string
  text?: {
    elements: TextElement[]
    style?: Record<string, any>
  }
  has_children?: boolean
}

interface TextElement {
  text_run?: {
    content: string
  }
}