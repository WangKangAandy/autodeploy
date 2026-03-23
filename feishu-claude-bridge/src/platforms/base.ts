import type {
  PlatformAdapter,
  PlatformId,
  SendOptions,
  MessageResult,
  UserInfo
} from "../core/types.js"
import type { Request, Response } from "express"
import { logger } from "../utils/logger.js"

/**
 * Base Adapter - Abstract base class for platform adapters
 *
 * Provides common functionality and defines the interface that all platforms must implement.
 */
export abstract class BaseAdapter implements PlatformAdapter {
  abstract readonly id: PlatformId
  abstract readonly name: string

  protected config!: Record<string, unknown>
  protected botInfo?: { id: string; name: string }

  /**
   * Initialize the adapter with platform-specific configuration
   */
  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = config
    await this.onInitialize()
    logger.info(`Platform adapter "${this.name}" initialized`)
  }

  /**
   * Subclasses implement specific initialization logic
   */
  protected abstract onInitialize(): Promise<void>

  /**
   * Webhook route path (relative to /webhook/)
   */
  abstract getWebhookPath(): string

  /**
   * Handle incoming webhook request
   */
  abstract handleWebhook(req: Request, res: Response): Promise<void>

  /**
   * Send message to target
   */
  abstract sendMessage(targetId: string, content: string, options?: SendOptions): Promise<MessageResult>

  /**
   * Get bot information
   */
  async getBotInfo(): Promise<{ id: string; name: string }> {
    if (!this.botInfo) {
      throw new Error(`Bot not initialized for platform ${this.name}`)
    }
    return this.botInfo
  }

  /**
   * Get user information (optional - subclasses can override)
   */
  async getUserInfo?(userId: string): Promise<UserInfo>

  /**
   * Get group members (optional - subclasses can override)
   */
  async getGroupMembers?(groupId: string): Promise<UserInfo[]>

  /**
   * Dispose resources (optional - subclasses can override)
   */
  async dispose?(): Promise<void>

  /**
   * Get a required config value
   */
  protected requireConfig<T>(key: string): T {
    const value = this.config[key]
    if (value === undefined || value === null) {
      throw new Error(`Missing required config key: ${key} for platform ${this.name}`)
    }
    return value as T
  }

  /**
   * Get an optional config value with default
   */
  protected getConfig<T>(key: string, defaultValue: T): T {
    const value = this.config[key]
    if (value === undefined || value === null) {
      return defaultValue
    }
    return value as T
  }

  /**
   * Log with platform context
   */
  protected log(message: string, level: "info" | "warn" | "error" | "debug" = "info"): void {
    const prefix = `[${this.name}] `
    switch (level) {
      case "info":
        logger.info(prefix + message)
        break
      case "warn":
        logger.warn(prefix + message)
        break
      case "error":
        logger.error(prefix + message)
        break
      case "debug":
        logger.debug(prefix + message)
        break
    }
  }
}