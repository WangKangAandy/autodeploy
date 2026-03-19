import {
  DWClient,
  TOPIC_ROBOT,
  EventAck,
  type DWClientDownStream,
} from "dingtalk-stream"
import type { UnifiedMessage, SendOptions, MessageResult } from "../../core/types.js"
import { DingTalkFormatter } from "./formatter.js"
import { messageBus } from "../../core/message-bus.js"
import { logger } from "../../utils/logger.js"
import type { ExtendedRobotMessage } from "./types.js"

/**
 * DingTalk Long Connection Client
 *
 * Uses DingTalk official SDK's Stream mode to receive events via WebSocket.
 * No need for public domain or encryption policy configuration.
 */
export class DingTalkLongConnection {
  private clientId: string      // AppKey
  private clientSecret: string  // AppSecret
  private dwClient: DWClient
  private formatter: DingTalkFormatter
  private isRunning: boolean = false

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.formatter = new DingTalkFormatter()

    // Initialize DWClient for Stream mode
    this.dwClient = new DWClient({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      debug: process.env.NODE_ENV === "development",
    })
  }

  /**
   * Start the long connection and listen for events
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("[钉钉长连接] Already running")
      return
    }

    try {
      logger.info("[钉钉长连接] Starting Stream connection...")

      // Register robot message callback
      this.dwClient.registerCallbackListener(TOPIC_ROBOT, async (res: DWClientDownStream) => {
        await this.handleMessageEvent(res)
      })

      // Register all event listener - this is required for the SDK to work properly
      // Must return EventAck.SUCCESS to acknowledge events
      this.dwClient.registerAllEventListener((message: DWClientDownStream) => {
        logger.debug(`[钉钉长连接] Event received: ${message.headers.topic}`)
        return { status: EventAck.SUCCESS }
      })

      // Start the connection
      await this.dwClient.connect()

      this.isRunning = true
      logger.info("[钉钉长连接] Stream connection established successfully")
    } catch (error) {
      logger.error(`[钉钉长连接] Failed to start: ${error}`)
      throw error
    }
  }

  /**
   * Stop the long connection
   */
  stop(): void {
    if (!this.isRunning) {
      return
    }

    try {
      this.dwClient.disconnect()
      this.isRunning = false
      logger.info("[钉钉长连接] Stream connection stopped")
    } catch (error) {
      logger.error(`[钉钉长连接] Failed to stop: ${error}`)
    }
  }

  /**
   * Handle incoming message event from Stream
   */
  private async handleMessageEvent(res: DWClientDownStream): Promise<void> {
    try {
      logger.info(`[钉钉长连接] Received message event`)

      // Parse the message data
      const messageData: ExtendedRobotMessage = JSON.parse(res.data)

      // Convert to UnifiedMessage
      const unifiedMessage = this.parseStreamMessage(messageData)

      if (!unifiedMessage) {
        logger.warn("[钉钉长连接] Failed to parse message event")
        // Ack the message to avoid re-delivery
        this.dwClient.socketCallBackResponse(res.headers.messageId, { success: true })
        return
      }

      // For group chats, check if bot is mentioned
      if (unifiedMessage.chat.type === "group") {
        // In Stream mode, only messages that mention the bot are delivered
        // But we still check for safety
        const isMentioned = this.checkMentionedInGroup(messageData)
        if (!isMentioned) {
          logger.debug("[钉钉长连接] Bot not mentioned in group, skipping")
          this.dwClient.socketCallBackResponse(res.headers.messageId, { success: true })
          return
        }
      }

      // Skip empty messages
      if (this.formatter.isEmptyMessage(unifiedMessage)) {
        logger.debug("[钉钉长连接] Empty message, skipping")
        this.dwClient.socketCallBackResponse(res.headers.messageId, { success: true })
        return
      }

      // Store session webhook for reply
      const rawObj = unifiedMessage.raw as Record<string, unknown> | undefined
      unifiedMessage.raw = {
        ...rawObj,
        sessionWebhook: messageData.sessionWebhook,
        messageId: res.headers.messageId,
      }

      // Publish to message bus
      await messageBus.publish(unifiedMessage)

      // Note: We don't ack here - the message handler will ack after sending reply
    } catch (error) {
      logger.error(`[钉钉长连接] Error handling message event: ${error}`)
      // Try to ack anyway
      try {
        this.dwClient.socketCallBackResponse(res.headers.messageId, { success: true })
      } catch (e) {
        logger.debug(`[钉钉长连接] Failed to ack message: ${e}`)
      }
    }
  }

  /**
   * Check if bot is mentioned in group chat
   */
  private checkMentionedInGroup(_messageData: ExtendedRobotMessage): boolean {
    // In Stream mode, the SDK already filters to only deliver messages where bot is mentioned
    // Return true for now - can add more specific logic if needed
    return true
  }

  /**
   * Parse Stream message to UnifiedMessage format
   */
  private parseStreamMessage(data: ExtendedRobotMessage): UnifiedMessage | null {
    try {
      // Determine chat type
      const isGroup = data.conversationType === "2"

      // Extract text content based on message type
      let text = ""
      let contentType: "text" | "image" | "file" | "audio" | "video" | "mixed" = "text"

      if (data.msgtype === "text" && data.text?.content) {
        text = data.text.content
      } else if (data.msgtype === "interactiveCard") {
        // Handle interactive card messages (e.g., document links)
        if (data.content?.biz_custom_action_url) {
          text = data.content.biz_custom_action_url
          contentType = "mixed"
        }
      } else if (data.msgtype === "richText") {
        // Handle rich text messages
        if (data.content?.richText) {
          text = data.content.richText
        }
      } else if (data.msgtype === "picture") {
        // Handle image messages
        if (data.content?.downloadURL || data.content?.picURL) {
          text = data.content.downloadURL || data.content.picURL || ""
          contentType = "image"
        }
      } else if (data.msgtype === "file") {
        // Handle file messages
        if (data.content?.downloadURL || data.content?.fileName) {
          text = data.content.downloadURL || data.content.fileName || ""
          contentType = "file"
        }
      } else if (data.content) {
        // Fallback: try to extract any content
        if (typeof data.content === "string") {
          text = data.content
        } else {
          // Try to find any URL or text in the content
          text = data.content.biz_custom_action_url ||
                 data.content.downloadURL ||
                 data.content.picURL ||
                 data.content.richText ||
                 JSON.stringify(data.content)
        }
      }

      // Log the message type for debugging
      if (!text && data.msgtype !== "text") {
        logger.debug(`[钉钉长连接] Non-text message type: ${data.msgtype}, content: ${JSON.stringify((data as any).content)}`)
      }

      return {
        id: data.msgId || `dt-${Date.now()}`,
        platform: "dingtalk",
        chat: {
          id: data.conversationId || "",
          type: isGroup ? "group" : "private",
        },
        sender: {
          id: data.senderStaffId || data.senderId || "",
          name: data.senderNick || "",
        },
        content: {
          text,
          type: contentType,
        },
        timestamp: data.createAt || Date.now(),
        raw: data,
      }
    } catch (error) {
      logger.error(`[钉钉长连接] Error parsing Stream message: ${error}`)
      return null
    }
  }

  /**
   * Send a message via session webhook
   */
  async sendMessage(
    _targetId: string,
    content: string,
    options?: SendOptions & { sessionWebhook?: string; messageId?: string }
  ): Promise<MessageResult> {
    try {
      // If we have a session webhook from the original message, use it
      if (options?.sessionWebhook) {
        const accessToken = await this.dwClient.getAccessToken()

        // Build message body according to DingTalk session webhook format
        // Reference: https://open.dingtalk.com/document/orgapp/reply-to-single-chat-session
        const body: Record<string, unknown> = {
          msgtype: "text",
          text: {
            content: content,
          },
        }

        if (options?.mentions && options.mentions.length > 0) {
          body.at = {
            atUserIds: options.mentions,
            isAtAll: false,
          }
        }

        const response = await fetch(options.sessionWebhook, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-acs-dingtalk-access-token": accessToken,
          },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`HTTP ${response.status}: ${errorText}`)
        }

        const result = await response.json() as { errcode?: number; errmsg?: string }
        if (result.errcode && result.errcode !== 0) {
          throw new Error(`DingTalk error: ${result.errmsg || result.errcode}`)
        }

        // Ack the original message after successful reply
        if (options?.messageId) {
          this.dwClient.socketCallBackResponse(options.messageId, result)
        }

        return { success: true }
      }

      // Otherwise, return error - need session webhook for Stream mode replies
      throw new Error("No session webhook available for reply")
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error(`[钉钉长连接] Failed to send message: ${errorMessage}`)
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Get access token
   */
  async getAccessToken(): Promise<string> {
    return this.dwClient.getAccessToken()
  }

  /**
   * Check if connection is running
   */
  isActive(): boolean {
    return this.isRunning
  }
}