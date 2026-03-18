import type { FeishuMessageEvent } from "../message/types.js"
import { sendMessage } from "../utils/helpers.js"
import { BaseHandler } from "./base.js"
import { logger } from "../utils/logger.js"

export class PrivateChatHandler extends BaseHandler {
  async handle(event: FeishuMessageEvent): Promise<void> {
    try {
      const message = this.messageProcessor.parseEvent(event)

      // Check if message is empty
      if (this.messageProcessor.isEmptyMessage(message)) {
        logger.info(`Skipping empty message from ${message.senderId}`)
        return
      }

      const userId = message.senderId
      logger.info(`Processing private chat message from ${userId}: ${this.messageProcessor.cleanMentions(message.content).substring(0, 50)}...`)

      // Queue the message for Claude to process
      const requestId = this.messageProcessor.queueForClaude(message, this.botOpenId)
      logger.info(`Message queued with requestId: ${requestId}`)

      // Send acknowledgment message
      const ackMessage = this.messageFormatter.formatAsText("收到您的消息，正在处理中...")
      await sendMessage(userId, ackMessage, "open_id")
      logger.info(`Acknowledgment sent to user ${userId}`)

      // Note: The response will be sent automatically when a response file
      // is created in the responses/ directory by the user
    } catch (error) {
      logger.error(`Error in private chat handler: ${error}`)
      const userId = event.event.sender.sender_id.open_id
      const errorMessage = this.messageFormatter.formatAsText("抱歉，处理您的消息时出错了。请稍后再试。")
      await sendMessage(userId, errorMessage, "open_id").catch((e) =>
        logger.error(`Failed to send error message: ${e}`)
      )
    }
  }
}