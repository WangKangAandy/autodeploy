import type { ClaudeRequest, ClaudeResponse } from "../message/types.js"
import { logger } from "../utils/logger.js"
import * as fs from "node:fs"
import * as path from "node:path"

/**
 * Claude Bridge - Connects message queue to Claude TUI
 *
 * This class monitors a message queue directory for new messages from Feishu users
 * and polls for responses to be sent back to the webhook server.
 */
export class ClaudeBridge {
  private messageQueueDir: string
  private responseQueueDir: string
  private isRunning: boolean = false
  private pollingInterval: NodeJS.Timeout | null = null

  constructor(messageQueueDir: string, responseQueueDir: string) {
    this.messageQueueDir = messageQueueDir
    this.responseQueueDir = responseQueueDir
  }

  /**
   * Start the bridge - monitors message queue and processes requests
   */
  start(onMessageReceived: (request: ClaudeRequest) => Promise<string>): void {
    this.isRunning = true
    logger.info("Claude Bridge started")

    // Poll for new messages every 2 seconds
    this.pollingInterval = setInterval(() => {
      this.pollMessages(onMessageReceived)
    }, 2000)

    logger.info(`Monitoring message queue: ${this.messageQueueDir}`)
  }

  /**
   * Stop the bridge
   */
  stop(): void {
    this.isRunning = false
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }
    logger.info("Claude Bridge stopped")
  }

  /**
   * Poll for new messages in the queue
   */
  private async pollMessages(
    onMessageReceived: (request: ClaudeRequest) => Promise<string>
  ): Promise<void> {
    try {
      const requests = this.getQueuedRequests()

      for (const request of requests) {
        logger.info(`Processing Claude request: ${request.requestId}`)

        try {
          // Call the callback (which will be handled by Claude TUI)
          const response = await onMessageReceived(request)

          // Send the response back to the webhook server
          this.sendResponse(request.requestId, response)

          // Remove the processed request
          this.removeRequest(request.requestId)

          logger.info(`Claude request processed: ${request.requestId}`)
        } catch (error) {
          logger.error(`Error processing request ${request.requestId}: ${error}`)

          // Send error response
          this.sendResponse(request.requestId, `处理出错: ${error}`)
          this.removeRequest(request.requestId)
        }
      }
    } catch (error) {
      logger.error(`Error polling messages: ${error}`)
    }
  }

  /**
   * Get all pending requests from the queue
   */
  private getQueuedRequests(): ClaudeRequest[] {
    const requests: ClaudeRequest[] = []

    try {
      const files = fs.readdirSync(this.messageQueueDir)

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filepath = this.getFilePath(this.messageQueueDir, file)
          const content = fs.readFileSync(filepath, "utf-8")
          requests.push(JSON.parse(content) as ClaudeRequest)
        }
      }
    } catch (error) {
      logger.error(`Error reading message queue: ${error}`)
    }

    return requests
  }

  /**
   * Remove a processed request from the queue
   */
  private removeRequest(requestId: string): void {
    try {
      const filepath = this.getFilePath(this.messageQueueDir, `${requestId}.json`)
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath)
      }
    } catch (error) {
      logger.error(`Error removing request ${requestId}: ${error}`)
    }
  }

  /**
   * Send a response to be picked up by the webhook server
   */
  private sendResponse(requestId: string, content: string): void {
    try {
      const filepath = this.getFilePath(this.responseQueueDir, `${requestId}.json`)

      const response: ClaudeResponse = {
        requestId,
        content
      }

      fs.writeFileSync(filepath, JSON.stringify(response, null, 2))
    } catch (error) {
      logger.error(`Error sending response ${requestId}: ${error}`)
    }
  }

  /**
   * Get full file path
   */
  private getFilePath(dir: string, filename: string): string {
    return path.join(dir, filename)
  }

  /**
   * Check if bridge is running
   */
  isActive(): boolean {
    return this.isRunning
  }
}