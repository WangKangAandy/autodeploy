import * as fs from "node:fs"
import * as path from "node:path"
import { logger } from "../utils/logger.js"
import type { ClaudeRequest } from "../message/types.js"

export interface MonitorConfig {
  messageQueueDir: string
  responseQueueDir: string
  pollingInterval: number // milliseconds
}

export interface MessageHandler {
  (request: ClaudeRequest): Promise<string>
}

/**
 * Claude Message Monitor
 *
 * Monitors the message queue directory for new messages and processes them.
 * This is designed to be integrated with Claude TUI or any other AI system.
 */
export class ClaudeMessageMonitor {
  private config: MonitorConfig
  private isRunning: boolean = false
  private pollingInterval: NodeJS.Timeout | null = null

  constructor(config: MonitorConfig) {
    this.config = config
    this.ensureDirectories()
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.config.messageQueueDir)) {
      fs.mkdirSync(this.config.messageQueueDir, { recursive: true })
      logger.info(`Created message queue directory: ${this.config.messageQueueDir}`)
    }
    if (!fs.existsSync(this.config.responseQueueDir)) {
      fs.mkdirSync(this.config.responseQueueDir, { recursive: true })
      logger.info(`Created response queue directory: ${this.config.responseQueueDir}`)
    }
  }

  /**
   * Start monitoring the message queue
   */
  start(handler: MessageHandler): void {
    if (this.isRunning) {
      logger.warn("Monitor is already running")
      return
    }

    this.isRunning = true
    logger.info("Starting Claude Message Monitor...")
    logger.info(`Message queue: ${this.config.messageQueueDir}`)
    logger.info(`Response queue: ${this.config.responseQueueDir}`)
    logger.info(`Polling interval: ${this.config.pollingInterval}ms`)

    // Start polling
    this.pollingInterval = setInterval(() => {
      this.pollMessages(handler)
    }, this.config.pollingInterval)

    logger.info("Claude Message Monitor started")
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.isRunning) {
      return
    }

    this.isRunning = false

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }

    logger.info("Claude Message Monitor stopped")
  }

  /**
   * Poll for new messages and process them
   */
  private async pollMessages(handler: MessageHandler): Promise<void> {
    try {
      const requests = this.getPendingRequests()

      for (const request of requests) {
        logger.info(`Processing request: ${request.requestId}`)
        logger.info(`  From: ${request.senderName || request.userId}`)
        logger.info(`  Type: ${request.chatType}`)
        logger.info(`  Message: ${request.message.substring(0, 100)}...`)

        try {
          // Process the request using the provided handler
          const response = await handler(request)

          // Send response
          this.sendResponse(request.requestId, response)

          // Remove processed request
          this.removeRequest(request.requestId)

          logger.info(`Request processed successfully: ${request.requestId}`)
        } catch (error) {
          logger.error(`Error processing request ${request.requestId}: ${error}`)

          // Send error response
          const errorResponse = `处理出错: ${error instanceof Error ? error.message : String(error)}`
          this.sendResponse(request.requestId, errorResponse)

          // Remove the request
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
  private getPendingRequests(): ClaudeRequest[] {
    const requests: ClaudeRequest[] = []

    try {
      const files = fs.readdirSync(this.config.messageQueueDir)

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filepath = path.join(this.config.messageQueueDir, file)
          const content = fs.readFileSync(filepath, "utf-8")
          requests.push(JSON.parse(content))
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
      const filepath = path.join(this.config.messageQueueDir, `${requestId}.json`)
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath)
      }
    } catch (error) {
      logger.error(`Error removing request ${requestId}: ${error}`)
    }
  }

  /**
   * Send a response to the response queue
   */
  private sendResponse(requestId: string, content: string): void {
    try {
      const filepath = path.join(this.config.responseQueueDir, `${requestId}.json`)
      const response = {
        requestId,
        content
      }
      fs.writeFileSync(filepath, JSON.stringify(response, null, 2))
      logger.info(`Response sent: ${requestId}`)
    } catch (error) {
      logger.error(`Error sending response ${requestId}: ${error}`)
    }
  }

  /**
   * Check if monitor is running
   */
  isActive(): boolean {
    return this.isRunning
  }

  /**
   * Get queue status
   */
  getQueueStatus(): { pending: number; pendingRequests: string[] } {
    try {
      const files = fs.readdirSync(this.config.messageQueueDir)
      const pending = files.filter(f => f.endsWith('.json')).length
      return {
        pending,
        pendingRequests: files.filter(f => f.endsWith('.json'))
      }
    } catch (error) {
      logger.error(`Error getting queue status: ${error}`)
      return { pending: 0, pendingRequests: [] }
    }
  }
}

