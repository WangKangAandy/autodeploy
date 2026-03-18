import type { FeishuMessageEvent } from "../message/types.js"
import { sendMessage } from "../utils/helpers.js"
import { BaseHandler } from "./base.js"
import { logger } from "../utils/logger.js"

export class GroupChatHandler extends BaseHandler {
  async handle(event: FeishuMessageEvent): Promise<void> {
    try {
      const message = this.messageProcessor.parseEvent(event)

      // Check if bot is mentioned
      const isMentioned = this.messageProcessor.extractMentionedBot(message, this.botOpenId)
      if (!isMentioned) {
        logger.debug(`Bot not mentioned in group ${message.chatId}, skipping`)
        return
      }

      // Check if message is empty after removing mentions
      if (this.messageProcessor.isEmptyMessage(message)) {
        logger.info(`Skipping empty message in group ${message.chatId}`)
        return
      }

      const userId = message.senderId
      const chatId = message.chatId
      logger.info(`Processing group chat message from ${userId} in ${chatId}: ${this.messageProcessor.cleanMentions(message.content).substring(0, 50)}...`)

      // Queue the message for Claude to process
      const requestId = this.messageProcessor.queueForClaude(message, this.botOpenId)
      logger.info(`Message queued with requestId: ${requestId}`)

      // Send acknowledgment message
      const ackMessage = this.messageFormatter.formatAsText("收到您的消息，正在处理中...")
      await sendMessage(chatId, ackMessage, "chat_id")
      logger.info(`Acknowledgment sent to group ${chatId}`)

      // Note: The response will be sent automatically when a response file
      // is created in the responses/ directory by the user
    } catch (error) {
      logger.error(`Error in group chat handler: ${error}`)
      const chatId = event.event.message.chat_id
      const errorMessage = this.messageFormatter.formatAsText("抱歉，处理您的消息时出错了。请稍后再试。")
      await sendMessage(chatId, errorMessage, "chat_id").catch((e) =>
        logger.error(`Failed to send error message: ${e}`)
      )
    }
  }
}