import type { UnifiedMessage, MessageHandler } from "./types.js"
import { logger } from "../utils/logger.js"

/**
 * Message Bus - Decouples message reception from processing
 *
 * Platform adapters publish messages to the bus, and handlers subscribe to process them.
 * This allows multiple handlers to process the same message (e.g., logging, AI response).
 */
class MessageBus {
  private handlers: MessageHandler[] = []
  private messageQueue: UnifiedMessage[] = []
  private isProcessing: boolean = false
  private processInterval: NodeJS.Timeout | null = null

  /**
   * Subscribe a handler to process messages
   */
  subscribe(handler: MessageHandler): void {
    this.handlers.push(handler)
    logger.info(`Message handler subscribed, total handlers: ${this.handlers.length}`)
  }

  /**
   * Unsubscribe a handler
   */
  unsubscribe(handler: MessageHandler): void {
    const index = this.handlers.indexOf(handler)
    if (index > -1) {
      this.handlers.splice(index, 1)
      logger.info(`Message handler unsubscribed, remaining handlers: ${this.handlers.length}`)
    }
  }

  /**
   * Publish a message to the bus
   * Messages are queued and processed asynchronously
   */
  async publish(message: UnifiedMessage): Promise<void> {
    logger.info(`Message published: platform=${message.platform}, chat=${message.chat.id}, sender=${message.sender.id}`)
    this.messageQueue.push(message)

    // Start processing if not already
    this.startProcessing()
  }

  /**
   * Start the message processing loop
   */
  private startProcessing(): void {
    if (this.isProcessing) return

    this.isProcessing = true
    this.processInterval = setInterval(() => {
      this.processNextMessage()
    }, 100)
  }

  /**
   * Stop the message processing loop
   */
  stopProcessing(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval)
      this.processInterval = null
    }
    this.isProcessing = false
    logger.info("Message bus processing stopped")
  }

  /**
   * Process the next message in the queue
   */
  private async processNextMessage(): Promise<void> {
    if (this.messageQueue.length === 0) {
      // No more messages, stop processing
      this.stopProcessing()
      return
    }

    const message = this.messageQueue.shift()
    if (!message) return

    // Process message with all handlers
    await this.processMessage(message)
  }

  /**
   * Process a single message with all handlers
   */
  private async processMessage(message: UnifiedMessage): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(message)
      } catch (error) {
        logger.error(`Error in message handler: ${error}`)
        // Continue with other handlers
      }
    }
  }

  /**
   * Get the current queue size
   */
  getQueueSize(): number {
    return this.messageQueue.length
  }

  /**
   * Check if the bus is processing messages
   */
  isActive(): boolean {
    return this.isProcessing
  }

  /**
   * Clear the message queue
   */
  clearQueue(): void {
    this.messageQueue = []
    logger.info("Message queue cleared")
  }
}

// Global singleton instance
export const messageBus = new MessageBus()