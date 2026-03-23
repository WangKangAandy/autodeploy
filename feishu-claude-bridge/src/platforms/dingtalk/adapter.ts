import type { Request, Response } from "express"
import type {
  SendOptions,
  MessageResult,
} from "../../core/types.js"
import { BaseAdapter } from "../base.js"
import { DingTalkApiClient } from "./api.js"
import { DingTalkWebhook } from "./webhook.js"
import { DingTalkLongConnection } from "./long-connection.js"
import { DingTalkFormatter } from "./formatter.js"
import type { DingTalkMessageEvent } from "./types.js"
import { messageBus } from "../../core/message-bus.js"

/** Connection mode for DingTalk */
export type DingTalkConnectionMode = "webhook" | "stream"

/**
 * DingTalk (钉钉) Platform Adapter
 *
 * Implements the PlatformAdapter interface for DingTalk platform.
 * Supports two connection modes:
 * - webhook: Receive events via HTTP webhook (requires public domain)
 * - stream: Receive events via WebSocket Stream mode (no public domain needed)
 */
export class DingTalkAdapter extends BaseAdapter {
  readonly id = "dingtalk"
  readonly name = "钉钉"

  private apiClient!: DingTalkApiClient
  private webhook!: DingTalkWebhook
  private longConnection!: DingTalkLongConnection
  private formatter: DingTalkFormatter
  private appKey: string = ""
  private connectionMode: DingTalkConnectionMode = "webhook"

  constructor() {
    super()
    this.formatter = new DingTalkFormatter()
  }

  /**
   * Initialize DingTalk adapter
   */
  protected async onInitialize(): Promise<void> {
    const appKey = this.requireConfig<string>("appKey")
    const appSecret = this.requireConfig<string>("appSecret")
    const agentId = this.requireConfig<string>("agentId")

    this.appKey = appKey

    // Get connection mode from config
    const mode = this.getConfig<string>("connectionMode", "webhook")
    this.connectionMode = mode as DingTalkConnectionMode

    // Initialize API client (used for both modes)
    this.apiClient = new DingTalkApiClient(appKey, appSecret, agentId)

    // Initialize webhook handler (for webhook mode)
    const encodingAESKey = this.getConfig<string>("encodingAESKey", "")
    this.webhook = new DingTalkWebhook(appKey, appSecret, encodingAESKey)

    // Initialize long connection client (for stream mode)
    this.longConnection = new DingTalkLongConnection(appKey, appSecret)

    // Set bot info
    this.botInfo = { id: agentId, name: "Claude Bot" }

    // Start long connection if mode is stream
    if (this.connectionMode === "stream") {
      this.log("Starting in stream mode")
      await this.longConnection.start()
    } else {
      this.log("Starting in webhook mode")
    }

    this.log(`Adapter initialized with agentId: ${agentId}`)
  }

  /**
   * Webhook route path (only used in webhook mode)
   */
  getWebhookPath(): string {
    return "dingtalk"
  }

  /**
   * Handle incoming webhook request (only used in webhook mode)
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    // In stream mode, webhook is not used
    if (this.connectionMode === "stream") {
      res.status(400).json({ error: "Webhook not available in stream mode" })
      return
    }

    try {
      // Handle URL verification
      if (this.webhook.handleUrlVerification(req, res)) {
        return
      }

      // Verify signature
      if (!this.webhook.verifyRequest(req)) {
        res.status(401).json({ error: "Invalid signature" })
        return
      }

      // Parse message event
      const event = this.webhook.parseMessageEvent(req)
      if (!event) {
        res.status(400).json({ error: "Invalid message format" })
        return
      }

      // Respond quickly to DingTalk
      res.status(200).json({ errcode: 0, errmsg: "success" })

      // Process message asynchronously
      this.processMessageEvent(event).catch((error) => {
        this.log(`Error processing message: ${error}`, "error")
      })
    } catch (error) {
      this.log(`Webhook error: ${error}`, "error")
      res.status(500).json({ error: "Internal server error" })
    }
  }

  /**
   * Process a message event (webhook mode)
   */
  private async processMessageEvent(event: DingTalkMessageEvent): Promise<void> {
    const unifiedMessage = this.formatter.parseToUnified(event)

    // For group chats, check if bot is mentioned
    if (unifiedMessage.chat.type === "group") {
      // Check if bot's appKey is in at users
      const isMentioned = event.AtUsers?.some(
        (u) => u.DingTalkId === this.appKey
      )
      if (!isMentioned) {
        this.log("Bot not mentioned in group, skipping", "debug")
        return
      }
    }

    // Skip empty messages
    if (this.formatter.isEmptyMessage(unifiedMessage)) {
      this.log("Empty message, skipping", "debug")
      return
    }

    // Publish to message bus
    await messageBus.publish(unifiedMessage)
  }

  /**
   * Send a message
   */
  async sendMessage(
    targetId: string,
    content: string,
    options?: SendOptions
  ): Promise<MessageResult> {
    try {
      // In stream mode, prefer using session webhook if available
      const sessionWebhook = options?.raw?.sessionWebhook as string | undefined
      const originalMessageId = options?.raw?.messageId as string | undefined
      if (this.connectionMode === "stream" && sessionWebhook) {
        return this.longConnection.sendMessage(targetId, content, {
          ...options,
          sessionWebhook,
          messageId: originalMessageId,
        })
      }

      const formatted = this.formatter.formatForSend(content, options)

      // Determine if sending to group or private
      const isGroup = options?.mentions && options.mentions.length > 0

      let messageId: string
      if (isGroup) {
        messageId = await this.apiClient.sendGroupMessage(
          targetId,
          formatted.msgType,
          formatted.content,
          this.appKey
        )
      } else {
        messageId = await this.apiClient.sendPrivateMessage(
          targetId,
          formatted.msgType,
          formatted.content
        )
      }

      return { success: true, messageId }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.log(`Failed to send message: ${errorMessage}`, "error")
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Get formatter instance (for testing)
   */
  getFormatter(): DingTalkFormatter {
    return this.formatter
  }

  /**
   * Get current connection mode
   */
  getConnectionMode(): DingTalkConnectionMode {
    return this.connectionMode
  }

  /**
   * Check if long connection is active
   */
  isLongConnectionActive(): boolean {
    return this.longConnection?.isActive() || false
  }

  /**
   * Get the DingTalk API client
   */
  getApiClient(): DingTalkApiClient {
    return this.apiClient
  }

  /**
   * Dispose resources
   */
  async dispose(): Promise<void> {
    if (this.longConnection) {
      this.longConnection.stop()
    }
    this.log("Disposed")
  }
}