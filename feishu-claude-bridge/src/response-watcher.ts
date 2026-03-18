import * as fs from "node:fs"
import * as path from "node:path"
import { sendMessage } from "./utils/helpers.js"
import { logger } from "./utils/logger.js"

export interface ResponseWatcherConfig {
  responseQueueDir: string
  checkInterval: number // milliseconds
}

/**
 * Response Watcher - Monitors the response queue directory and automatically
 * sends responses to Feishu users when they appear.
 */
export class ResponseWatcher {
  private config: ResponseWatcherConfig
  private isRunning: boolean = false
  private pollingInterval: NodeJS.Timeout | null = null

  constructor(config: ResponseWatcherConfig) {
    this.config = config
    this.ensureDirectory()
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.config.responseQueueDir)) {
      fs.mkdirSync(this.config.responseQueueDir, { recursive: true })
      logger.info(`Created response queue directory: ${this.config.responseQueueDir}`)
    }
  }

  /**
   * Start watching for responses
   */
  start(): void {
    if (this.isRunning) {
      logger.warn("Response watcher is already running")
      return
    }

    this.isRunning = true
    logger.info("Starting Response Watcher...")
    logger.info(`Response queue: ${this.config.responseQueueDir}`)
    logger.info(`Check interval: ${this.config.checkInterval}ms`)

    // Start polling for responses
    this.pollingInterval = setInterval(() => {
      this.processResponses()
    }, this.config.checkInterval)

    logger.info("Response Watcher started")
  }

  /**
   * Stop watching for responses
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

    logger.info("Response Watcher stopped")
  }

  /**
   * Process all pending responses
   */
  private async processResponses(): Promise<void> {
    try {
      const files = fs.readdirSync(this.config.responseQueueDir)

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue
        }

        const filepath = path.join(this.config.responseQueueDir, file)
        const requestId = file.replace('.json', '')

        try {
          // Read the response file
          const content = fs.readFileSync(filepath, 'utf-8')
          const response = JSON.parse(content)

          logger.info(`Processing response: ${requestId}`)

          // Get the original request to determine where to send the response
          const messageQueueDir = this.config.responseQueueDir.replace('responses', 'messages')
          const requestFilepath = path.join(messageQueueDir, `${requestId}.json`)

          if (fs.existsSync(requestFilepath)) {
            const requestContent = fs.readFileSync(requestFilepath, 'utf-8')
            const request = JSON.parse(requestContent)

            // Send the response
            await this.sendResponseToFeishu(request, response)

            // Remove both files
            fs.unlinkSync(filepath)
            fs.unlinkSync(requestFilepath)

            logger.info(`Response sent and files cleaned up: ${requestId}`)
          } else {
            logger.warn(`Original request not found for ${requestId}, skipping response`)
            // Still remove the orphan response
            fs.unlinkSync(filepath)
          }
        } catch (error) {
          logger.error(`Error processing response ${file}: ${error}`)
          // Try to remove the file to prevent repeated errors
          try {
            fs.unlinkSync(filepath)
          } catch {
            // Ignore
          }
        }
      }
    } catch (error) {
      logger.error(`Error reading response queue: ${error}`)
    }
  }

  /**
   * Send a response to Feishu
   */
  private async sendResponseToFeishu(request: any, response: any): Promise<void> {
    try {
      const { chatId, chatType } = request
      const content = response.content

      if (!content) {
        logger.warn(`Empty response content for request ${request.requestId}`)
        return
      }

      // Determine the receive_id_type based on chat type
      const receiveIdType = chatType === 'p2p' ? 'open_id' : 'chat_id'

      logger.info(`Sending response to ${chatType} ${chatId} (type: ${receiveIdType})`)

      await sendMessage(chatId, content, receiveIdType)

      logger.info(`Response sent successfully to ${chatId}`)
    } catch (error) {
      logger.error(`Failed to send response to Feishu: ${error}`)
      throw error
    }
  }

  /**
   * Check if watcher is running
   */
  isActive(): boolean {
    return this.isRunning
  }

  /**
   * Get pending responses count
   */
  getPendingCount(): number {
    try {
      const files = fs.readdirSync(this.config.responseQueueDir)
      return files.filter(f => f.endsWith('.json')).length
    } catch (error) {
      logger.error(`Error counting pending responses: ${error}`)
      return 0
    }
  }
}