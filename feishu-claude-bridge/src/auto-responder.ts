import * as fs from "node:fs"
import * as path from "node:path"
import { ClaudeClient } from "./claude-client.js"
import { sendMessage } from "./utils/helpers.js"
import { logger } from "./utils/logger.js"
import type { ClaudeRequest } from "./message/types.js"

export interface AutoResponderConfig {
  messageQueueDir: string
  claudeClient: ClaudeClient
  checkInterval?: number
}

/**
 * Auto Responder - Monitors message queue and automatically responds using Claude
 */
export class AutoResponder {
  private messageQueueDir: string
  private claudeClient: ClaudeClient
  private checkInterval: number
  private isRunning: boolean = false
  private pollingInterval: NodeJS.Timeout | null = null

  constructor(config: AutoResponderConfig) {
    this.messageQueueDir = config.messageQueueDir
    this.claudeClient = config.claudeClient
    this.checkInterval = config.checkInterval || 2000
  }

  /**
   * Start monitoring for new messages
   */
  start(): void {
    if (this.isRunning) {
      logger.warn("AutoResponder is already running")
      return
    }

    this.isRunning = true
    logger.info("AutoResponder started")
    logger.info(`Monitoring: ${this.messageQueueDir}`)

    this.pollingInterval = setInterval(() => {
      this.processMessages()
    }, this.checkInterval)
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.isRunning) return

    this.isRunning = false
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }
    logger.info("AutoResponder stopped")
  }

  /**
   * Process all pending messages
   */
  private async processMessages(): Promise<void> {
    try {
      const files = fs.readdirSync(this.messageQueueDir)
      const jsonFiles = files.filter(f => f.endsWith('.json'))

      for (const file of jsonFiles) {
        const filepath = path.join(this.messageQueueDir, file)
        await this.processMessageFile(filepath)
      }
    } catch (error) {
      logger.error(`Error processing messages: ${error}`)
    }
  }

  /**
   * Process a single message file
   */
  private async processMessageFile(filepath: string): Promise<void> {
    try {
      // Check if file still exists (may have been processed by another instance)
      if (!fs.existsSync(filepath)) {
        return
      }

      // Read the message
      const content = fs.readFileSync(filepath, 'utf-8')
      const request: ClaudeRequest = JSON.parse(content)

      logger.info(`Processing message: ${request.requestId}`)
      logger.info(`From: ${request.senderId}, Message: ${request.message.substring(0, 50)}...`)

      // Remove the message file immediately to prevent duplicate processing
      fs.unlinkSync(filepath)

      // Get Claude's response
      const claudeResponse = await this.claudeClient.sendMessage(
        request.senderId,
        request.message
      )

      // Send response to Feishu
      const receiveIdType = request.chatType === 'p2p' ? 'open_id' : 'chat_id'
      const receiveId = request.chatType === 'p2p' ? request.senderId : request.chatId

      // Format as text message
      const textContent = JSON.stringify({ text: claudeResponse })

      await sendMessage(
        receiveId,
        { msgType: "text", content: textContent },
        receiveIdType
      )

      logger.info(`Response sent to ${request.senderId}`)
    } catch (error) {
      logger.error(`Error processing message file ${filepath}: ${error}`)

      // Try to remove the file to prevent repeated errors
      try {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath)
        }
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Check if responder is running
   */
  isActive(): boolean {
    return this.isRunning
  }
}