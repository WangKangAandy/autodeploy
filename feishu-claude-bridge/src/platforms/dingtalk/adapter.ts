import type { Request, Response } from "express"
import type {
  SendOptions,
  MessageResult,
} from "../../core/types.js"
import { BaseAdapter } from "../base.js"
import { DingTalkApiClient } from "./api.js"
import { DingTalkWebhook } from "./webhook.js"
import { DingTalkFormatter } from "./formatter.js"
import type { DingTalkMessageEvent } from "./types.js"
import { messageBus } from "../../core/message-bus.js"

/**
 * DingTalk (钉钉) Platform Adapter
 *
 * Implements the PlatformAdapter interface for DingTalk platform.
 */
export class DingTalkAdapter extends BaseAdapter {
  readonly id = "dingtalk"
  readonly name = "钉钉"

  private apiClient!: DingTalkApiClient
  private webhook!: DingTalkWebhook
  private formatter: DingTalkFormatter
  private appKey: string = ""

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
    const encodingAESKey = this.requireConfig<string>("encodingAESKey")

    this.appKey = appKey

    // Initialize API client
    this.apiClient = new DingTalkApiClient(appKey, appSecret, agentId)

    // Initialize webhook handler
    this.webhook = new DingTalkWebhook(appKey, appSecret, encodingAESKey)

    // Set bot info
    this.botInfo = { id: agentId, name: "Claude Bot" }

    this.log(`Adapter initialized with agentId: ${agentId}`)
  }

  /**
   * Webhook route path
   */
  getWebhookPath(): string {
    return "dingtalk"
  }

  /**
   * Handle incoming webhook request
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
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
   * Process a message event
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
}