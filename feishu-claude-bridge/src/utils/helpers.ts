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

/**
 * 从飞书文档 URL 提取文档信息
 * 支持的 URL 格式:
 * - https://feishu.cn/docx/DoxdSxxxxxxxxxxxxxx
 * - https://feishu.cn/wiki/DoxdSxxxxxxxxxxxxxx
 * - https://xxx.feishu.cn/docx/DoxdSxxxxxxxxxxxxxx
 * - https://xxx.feishu.cn/wiki/DoxdSxxxxxxxxxxxxxx
 * - https://open.feishu.cn/document/client/docx/DoxdSxxxxxxxxxxxxxx
 */
export function parseFeishuDocUrl(url: string): { docId: string; docType: string } | null {
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname

    // Match docx format: /docx/{docId} or /wiki/{docId}
    const docxMatch = pathname.match(/\/(docx|wiki)\/([A-Za-z0-9]+)/)
    if (docxMatch) {
      return {
        docType: docxMatch[1],
        docId: docxMatch[2]
      }
    }

    // Match open.feishu.cn format: /document/client/docx/{docId}
    const openMatch = pathname.match(/\/document\/client\/(docx|wiki)\/([A-Za-z0-9]+)/)
    if (openMatch) {
      return {
        docType: openMatch[1],
        docId: openMatch[2]
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * 从飞书文件夹 URL 提取 folder_token
 * 支持的 URL 格式:
 * - https://feishu.cn/drive/folder/fldcnSxxxxxxxxxxxxxx
 * - https://xxx.feishu.cn/drive/folder/fldcnSxxxxxxxxxxxxxx
 */
export function parseFeishuFolderUrl(url: string): string | null {
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname

    // Match folder format: /drive/folder/{folderToken}
    const folderMatch = pathname.match(/\/drive\/folder\/([A-Za-z0-9]+)/)
    if (folderMatch) {
      return folderMatch[1]
    }

    return null
  } catch {
    return null
  }
}

/**
 * 检查 URL 是否为飞书文档链接
 */
export function isFeishuDocUrl(url: string): boolean {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.endsWith("feishu.cn") &&
           (urlObj.pathname.includes("/docx/") || urlObj.pathname.includes("/wiki/"))
  } catch {
    return false
  }
}

/**
 * 从钉钉文档 URL 提取文档 ID
 * 支持的 URL 格式:
 * - https://alidocs.dingtalk.com/i/nodes/{docId}?...
 */
export function parseDingTalkDocUrl(url: string): { docId: string } | null {
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname

    // Match alidocs.dingtalk.com format: /i/nodes/{docId}
    const match = pathname.match(/\/i\/nodes\/([a-zA-Z0-9]+)/)
    if (match) {
      return { docId: match[1] }
    }

    return null
  } catch {
    return null
  }
}

/**
 * 检查 URL 是否为钉钉文档链接
 */
export function isDingTalkDocUrl(url: string): boolean {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname === "alidocs.dingtalk.com" &&
           urlObj.pathname.includes("/i/nodes/")
  } catch {
    return false
  }
}

/**
 * 检测文档 URL 类型
 */
export type DocPlatform = "feishu" | "dingtalk" | "unknown"

export function detectDocPlatform(url: string): DocPlatform {
  if (isFeishuDocUrl(url)) return "feishu"
  if (isDingTalkDocUrl(url)) return "dingtalk"
  return "unknown"
}