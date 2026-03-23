import type { UnifiedMessage, AppConfig, SendOptions } from "./types.js"
import { registry } from "./registry.js"
import { ClaudeClient } from "../claude-client.js"
import { logger } from "../utils/logger.js"

/**
 * Unified Message Handler
 *
 * Receives messages from all platforms via the message bus,
 * processes them with Claude API, and sends responses back.
 */
export class UnifiedMessageHandler {
  private claudeClient: ClaudeClient
  private processingUsers: Set<string> = new Set()

  constructor(config: AppConfig, claudeClient?: ClaudeClient) {
    // Initialize Claude client
    this.claudeClient = claudeClient || new ClaudeClient({
      apiKey: config.claude.apiKey,
      model: config.claude.model,
      systemPrompt: config.claude.systemPrompt,
      maxTokens: config.claude.maxTokens
    })
  }

  /**
   * Handle a unified message from any platform
   */
  async handle(message: UnifiedMessage): Promise<void> {
    const userId = message.sender.id
    const chatId = message.chat.id
    const platformId = message.platform

    logger.info(`Processing message from ${platformId}: user=${userId}, chat=${chatId}`)
    logger.debug(`Message content: ${message.content.text.substring(0, 100)}...`)

    // Skip empty messages
    if (!message.content.text.trim()) {
      logger.info(`Skipping empty message from ${userId}`)
      return
    }

    // Prevent concurrent processing for the same user
    const userKey = `${platformId}:${userId}`
    if (this.processingUsers.has(userKey)) {
      logger.info(`User ${userKey} is already being processed, skipping`)
      return
    }

    this.processingUsers.add(userKey)

    try {
      // Get the platform adapter for sending response
      const adapter = registry.getAdapter(platformId)
      if (!adapter) {
        logger.error(`No adapter found for platform: ${platformId}`)
        return
      }

      // Send acknowledgment
      await this.sendAcknowledgment(adapter, message)

      // Get Claude's response
      const response = await this.claudeClient.sendMessage(userId, message.content.text)

      // Send response back through the platform
      const sendOptions: SendOptions = {
        type: "text",
        raw: message.raw as Record<string, unknown>,
      }

      // For group chats, mention the sender
      if (message.chat.type === "group") {
        sendOptions.mentions = [userId]
      }

      await adapter.sendMessage(
        message.chat.type === "private" ? userId : chatId,
        response,
        sendOptions
      )

      logger.info(`Response sent to ${userId} via ${platformId}`)
    } catch (error) {
      logger.error(`Error processing message: ${error}`)

      // Try to send error message
      try {
        const adapter = registry.getAdapter(platformId)
        if (adapter) {
          await adapter.sendMessage(
            message.chat.type === "private" ? userId : chatId,
            "抱歉，处理您的消息时出错了。请稍后再试。",
            {
              type: "text",
              raw: message.raw as Record<string, unknown>,
            }
          )
        }
      } catch (sendError) {
        logger.error(`Failed to send error message: ${sendError}`)
      }
    } finally {
      this.processingUsers.delete(userKey)
    }
  }

  /**
   * Send acknowledgment that message was received
   */
  private async sendAcknowledgment(
    adapter: import("./types.js").PlatformAdapter,
    message: UnifiedMessage
  ): Promise<void> {
    try {
      const ackMessage = "收到您的消息，正在处理中..."
      const targetId = message.chat.type === "private"
        ? message.sender.id
        : message.chat.id

      await adapter.sendMessage(targetId, ackMessage, {
        type: "text",
        raw: message.raw as Record<string, unknown>,
      })
    } catch (error) {
      logger.error(`Failed to send acknowledgment: ${error}`)
    }
  }

  /**
   * Get the Claude client instance
   */
  getClaudeClient(): ClaudeClient {
    return this.claudeClient
  }

  /**
   * Clear conversation for a user
   */
  clearConversation(userId: string): void {
    this.claudeClient.clearConversation(userId)
    logger.info(`Conversation cleared for user ${userId}`)
  }

  /**
   * Clear all conversations
   */
  clearAllConversations(): void {
    this.claudeClient.clearAllConversations()
    logger.info("All conversations cleared")
  }
}