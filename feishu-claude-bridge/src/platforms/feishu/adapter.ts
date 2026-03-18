import type { Request, Response } from "express"
import type {
  SendOptions,
  MessageResult,
} from "../../core/types.js"
import { BaseAdapter } from "../base.js"
import { FeishuApiClient } from "./api.js"
import { FeishuWebhook } from "./webhook.js"
import { FeishuLongConnection } from "./long-connection.js"
import { FeishuFormatter } from "./formatter.js"
import type { FeishuMessageEvent } from "./types.js"
import { messageBus } from "../../core/message-bus.js"

/** Connection mode for Feishu */
export type FeishuConnectionMode = "webhook" | "long-connection"

/**
 * Feishu (Lark) Platform Adapter
 *
 * Implements the PlatformAdapter interface for Feishu/Lark platform.
 * Supports two connection modes:
 * - webhook: Receive events via HTTP webhook (requires public domain)
 * - long-connection: Receive events via WebSocket (no public domain needed)
 */
export class FeishuAdapter extends BaseAdapter {
  readonly id = "feishu"
  readonly name = "飞书"

  private apiClient!: FeishuApiClient
  private webhook!: FeishuWebhook
  private longConnection!: FeishuLongConnection
  private formatter: FeishuFormatter
  private botOpenId: string = ""
  private connectionMode: FeishuConnectionMode = "webhook"

  constructor() {
    super()
    this.formatter = new FeishuFormatter()
  }

  /**
   * Initialize Feishu adapter
   */
  protected async onInitialize(): Promise<void> {
    const appId = this.requireConfig<string>("appId")
    const appSecret = this.requireConfig<string>("appSecret")
    const encryptKey = this.getConfig<string>("encryptKey", "")
    const verificationToken = this.getConfig<string>("verificationToken", "")

    // Get connection mode from config
    const mode = this.getConfig<string>("connectionMode", "webhook")
    this.connectionMode = mode as FeishuConnectionMode

    // Initialize API client (used for both modes)
    this.apiClient = new FeishuApiClient(appId, appSecret)

    // Initialize webhook handler
    this.webhook = new FeishuWebhook(encryptKey, verificationToken)

    // Initialize long connection client
    this.longConnection = new FeishuLongConnection(appId, appSecret)

    // Get bot info
    try {
      const botInfo = await this.apiClient.getBotInfo()
      this.botOpenId = botInfo.open_id
      this.botInfo = { id: botInfo.open_id, name: "Claude Bot" }
      this.log(`Bot open_id: ${this.botOpenId}`)

      // Pass bot open ID to long connection client
      this.longConnection.setBotOpenId(this.botOpenId)
    } catch (error) {
      this.log(`Warning: Could not fetch bot info: ${error}`, "warn")
    }

    // Start long connection if mode is long-connection
    if (this.connectionMode === "long-connection") {
      this.log("Starting in long-connection mode")
      await this.longConnection.start()
    } else {
      this.log("Starting in webhook mode")
    }
  }

  /**
   * Webhook route path (only used in webhook mode)
   */
  getWebhookPath(): string {
    return "feishu"
  }

  /**
   * Handle incoming webhook request (only used in webhook mode)
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    // In long-connection mode, webhook is not used
    if (this.connectionMode === "long-connection") {
      res.status(400).json({ error: "Webhook not available in long-connection mode" })
      return
    }

    try {
      // Handle URL verification
      if (this.webhook.handleUrlVerification(req, res)) {
        return
      }

      // Parse message event
      const event = this.webhook.parseMessageEvent(req)
      if (!event) {
        res.status(400).json({ error: "Unsupported event type" })
        return
      }

      // Verify signature
      if (!this.webhook.verifyRequest(req)) {
        res.status(401).json({ error: "Invalid signature" })
        return
      }

      // Respond quickly to Feishu
      res.status(200).json({ code: 0, msg: "success" })

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
  private async processMessageEvent(event: FeishuMessageEvent): Promise<void> {
    const unifiedMessage = this.formatter.parseToUnified(event)

    // For group chats, check if bot is mentioned
    if (unifiedMessage.chat.type === "group") {
      if (!this.formatter.isBotMentioned(unifiedMessage, this.botOpenId)) {
        this.log("Bot not mentioned in group, skipping")
        return
      }
    }

    // Skip empty messages
    if (this.formatter.isEmptyMessage(unifiedMessage)) {
      this.log("Empty message, skipping")
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
      const formatted = this.formatter.formatForSend(content, options)
      const receiveIdType = options?.mentions?.length ? "chat_id" : "open_id"

      const messageId = await this.apiClient.sendMessage(
        targetId,
        formatted.msgType,
        formatted.content,
        receiveIdType
      )

      return { success: true, messageId }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.log(`Failed to send message: ${errorMessage}`, "error")
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Get bot open ID
   */
  getBotOpenId(): string {
    return this.botOpenId
  }

  /**
   * Get formatter instance (for testing)
   */
  getFormatter(): FeishuFormatter {
    return this.formatter
  }

  /**
   * Get current connection mode
   */
  getConnectionMode(): FeishuConnectionMode {
    return this.connectionMode
  }

  /**
   * Check if long connection is active
   */
  isLongConnectionActive(): boolean {
    return this.longConnection?.isActive() || false
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