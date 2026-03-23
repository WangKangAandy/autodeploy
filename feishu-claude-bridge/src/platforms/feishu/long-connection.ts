import * as Lark from "@larksuiteoapi/node-sdk"
import type { UnifiedMessage, SendOptions, MessageResult } from "../../core/types.js"
import { FeishuFormatter } from "./formatter.js"
import { messageBus } from "../../core/message-bus.js"
import { logger } from "../../utils/logger.js"

/**
 * Feishu Long Connection Client
 *
 * Uses Feishu official SDK's WebSocket long connection mode to receive events.
 * No need for public domain or encryption policy configuration.
 */
export class FeishuLongConnection {
  private appId: string
  private appSecret: string
  private client: Lark.Client
  private wsClient: Lark.WSClient
  private formatter: FeishuFormatter
  private botOpenId: string = ""
  private isRunning: boolean = false

  constructor(appId: string, appSecret: string) {
    this.appId = appId
    this.appSecret = appSecret
    this.formatter = new FeishuFormatter()

    // Initialize Lark client for sending messages
    this.client = new Lark.Client({
      appId: this.appId,
      appSecret: this.appSecret,
      loggerLevel: Lark.LoggerLevel.info,
    })

    // Initialize WebSocket client for receiving events
    this.wsClient = new Lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      loggerLevel: Lark.LoggerLevel.info,
    })
  }

  /**
   * Start the long connection and listen for events
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("[飞书长连接] Already running")
      return
    }

    try {
      // Get bot info first using our own API client
      logger.info("[飞书长连接] Starting WebSocket connection...")

      // Create event dispatcher
      const eventDispatcher = new Lark.EventDispatcher({})

      // Register message event handler
      eventDispatcher.register({
        "im.message.receive_v1": async (data) => {
          await this.handleMessageEvent(data)
        },
      })

      // Start the WebSocket connection
      await this.wsClient.start({
        eventDispatcher,
      })

      this.isRunning = true
      logger.info("[飞书长连接] WebSocket connection established successfully")
    } catch (error) {
      logger.error(`[飞书长连接] Failed to start: ${error}`)
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
      this.wsClient.close()
      this.isRunning = false
      logger.info("[飞书长连接] WebSocket connection stopped")
    } catch (error) {
      logger.error(`[飞书长连接] Failed to stop: ${error}`)
    }
  }

  /**
   * Set bot open ID (called from adapter after fetching)
   */
  setBotOpenId(botOpenId: string): void {
    this.botOpenId = botOpenId
  }

  /**
   * Handle incoming message event
   */
  private async handleMessageEvent(data: any): Promise<void> {
    try {
      logger.info(`[飞书长连接] Received message event`)

      // Convert SDK event to UnifiedMessage
      const unifiedMessage = this.parseSdkEvent(data)

      if (!unifiedMessage) {
        logger.warn("[飞书长连接] Failed to parse message event")
        return
      }

      // For group chats, check if bot is mentioned
      if (unifiedMessage.chat.type === "group") {
        const isMentioned = this.formatter.isBotMentioned(unifiedMessage, this.botOpenId)
        if (!isMentioned) {
          logger.debug("[飞书长连接] Bot not mentioned in group, skipping")
          return
        }
      }

      // Skip empty messages
      if (this.formatter.isEmptyMessage(unifiedMessage)) {
        logger.debug("[飞书长连接] Empty message, skipping")
        return
      }

      // Publish to message bus
      await messageBus.publish(unifiedMessage)
    } catch (error) {
      logger.error(`[飞书长连接] Error handling message event: ${error}`)
    }
  }

  /**
   * Parse SDK event to UnifiedMessage format
   */
  private parseSdkEvent(data: any): UnifiedMessage | null {
    try {
      const { message, sender } = data

      if (!message || !sender) {
        return null
      }

      // Parse message content
      const { text, attachments, mentions } = this.parseContent(
        message.content,
        message.message_type,
        message.mentions
      )

      return {
        id: message.message_id,
        platform: "feishu",
        chat: {
          id: message.chat_id,
          type: message.chat_type === "p2p" ? "private" : "group",
        },
        sender: {
          id: sender.sender_id?.open_id || "",
          name: sender.sender_id?.user_id,
        },
        content: {
          text,
          type: this.getMessageType(message.message_type),
          attachments,
          mentions,
        },
        timestamp: parseInt(message.create_time, 10) || Date.now(),
        raw: data,
      }
    } catch (error) {
      logger.error(`[飞书长连接] Error parsing SDK event: ${error}`)
      return null
    }
  }

  /**
   * Parse message content based on type
   */
  private parseContent(
    content: string,
    messageType: string,
    mentions?: any[]
  ): { text: string; attachments: any[]; mentions: any[] } {
    let text = ""
    const attachments: any[] = []
    const parsedMentions = mentions?.map((m: any) => ({
      id: m.id || m.key,
      idType: m.id_type || "open_id",
      key: m.key,
      name: m.name,
    })) || []

    try {
      const parsed = JSON.parse(content)
      const actualType = parsed.type || messageType

      switch (actualType) {
        case "text":
          text = parsed.text || ""
          break

        case "post":
          text = this.parsePostContent(parsed.post)
          break

        case "image":
          if (parsed.image?.key) {
            attachments.push({ type: "image", content: parsed.image.key })
          }
          break

        case "file":
          if (parsed.file?.key) {
            attachments.push({
              type: "file",
              content: parsed.file.key,
              name: parsed.file.name,
            })
          }
          break

        case "audio":
          if (parsed.audio?.file_key) {
            attachments.push({ type: "audio", content: parsed.audio.file_key })
          }
          break

        case "video":
          if (parsed.video?.file_key) {
            attachments.push({ type: "video", content: parsed.video.file_key })
          }
          break

        case "media":
          if (parsed.media?.file_key) {
            attachments.push({ type: "video", content: parsed.media.file_key })
          }
          break

        default:
          text = content
      }
    } catch {
      text = content
    }

    return { text, attachments, mentions: parsedMentions }
  }

  /**
   * Parse post (rich text) content
   */
  private parsePostContent(post: any): string {
    const zhCnContent = post?.zh_cn || {}
    const title = zhCnContent.title || ""
    const contentList = zhCnContent.content || []

    const paragraphs = contentList.map((section: any) => {
      switch (section.tag) {
        case "text":
          return section.text || ""
        case "a":
          return `[${section.text || ""}](${section.href || ""})`
        case "img":
          return `[图片: ${section.img_key || ""}]`
        case "at":
          return `@${section.user_name || ""}`
        default:
          return ""
      }
    })

    return [title, ...paragraphs].filter(Boolean).join("\n")
  }

  /**
   * Get unified message type from Feishu type
   */
  private getMessageType(feishuType: string): "text" | "image" | "file" | "audio" | "video" | "mixed" {
    const typeMap: Record<string, "text" | "image" | "file" | "audio" | "video" | "mixed"> = {
      text: "text",
      post: "text",
      image: "image",
      file: "file",
      audio: "audio",
      video: "video",
      media: "video",
    }
    return typeMap[feishuType] || "text"
  }

  /**
   * Send a message using the SDK client
   */
  async sendMessage(
    targetId: string,
    content: string,
    options?: SendOptions
  ): Promise<MessageResult> {
    try {
      const formatted = this.formatter.formatForSend(content, options)
      const receiveIdType = options?.mentions?.length ? "chat_id" : "open_id"

      const response = await this.client.im.v1.message.create({
        params: {
          receive_id_type: receiveIdType as "open_id" | "chat_id" | "user_id",
        },
        data: {
          receive_id: targetId,
          msg_type: formatted.msgType as "text" | "post" | "interactive" | "image",
          content: formatted.content,
        },
      })

      if (response.code !== 0) {
        throw new Error(`Failed to send message: code=${response.code} msg=${response.msg}`)
      }

      return { success: true, messageId: response.data?.message_id }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error(`[飞书长连接] Failed to send message: ${errorMessage}`)
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Check if connection is running
   */
  isActive(): boolean {
    return this.isRunning
  }
}