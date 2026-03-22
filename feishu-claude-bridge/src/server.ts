import type { Request, Response } from "express"
import express from "express"
import type { AppConfig } from "./config/types.js"
import { registry } from "./core/registry.js"
import { messageBus } from "./core/message-bus.js"
import { UnifiedMessageHandler } from "./core/handler.js"
import { ClaudeClient } from "./claude-client.js"
import { logger } from "./utils/logger.js"

// Import all platform adapters (auto-registers them)
import "./platforms/index.js"

// Import adapter types to check connection mode
import { FeishuAdapter } from "./platforms/feishu/index.js"
import { DingTalkAdapter } from "./platforms/dingtalk/index.js"

/**
 * Multi-Platform Bot Server
 *
 * Provides a unified webhook server for multiple chat platforms.
 * Platform adapters are automatically loaded from configuration.
 *
 * Supports two connection modes for Feishu:
 * - webhook: Receive events via HTTP webhook (requires public domain)
 * - long-connection: Receive events via WebSocket (no public domain needed)
 */
export class Server {
  private app: express.Express
  private config: AppConfig
  private claudeClient!: ClaudeClient
  private messageHandler!: UnifiedMessageHandler

  constructor(config: AppConfig) {
    this.config = config
    this.app = express()

    // Setup middleware
    this.app.use(express.json())
    this.app.use(express.urlencoded({ extended: true }))

    // Request logging
    this.app.use((req: Request, _res: Response, next) => {
      logger.info(`${req.method} ${req.path}`)
      next()
    })

    // Health check endpoint
    this.app.get("/health", (_req: Request, res: Response) => {
      const platformDetails = []

      for (const id of registry.getEnabledPlatforms()) {
        const adapter = registry.getAdapter(id)
        const detail: Record<string, unknown> = { id, name: adapter?.name }

        if (adapter instanceof FeishuAdapter) {
          detail.mode = adapter.getConnectionMode()
          detail.connectionActive = adapter.isLongConnectionActive()
          // Add Token status
          const tokenStatus = adapter.getApiClient().getTokenStatus()
          detail.token = {
            valid: tokenStatus.isValid,
            expiresAt: new Date(tokenStatus.expiresAt).toISOString(),
            secondsToExpiry: Math.max(0, Math.floor((tokenStatus.expiresAt - Date.now()) / 1000))
          }
        } else if (adapter instanceof DingTalkAdapter) {
          detail.mode = adapter.getConnectionMode()
          detail.connectionActive = adapter.isLongConnectionActive()
          const tokenStatus = adapter.getApiClient().getTokenStatus()
          detail.token = {
            valid: tokenStatus.isValid,
            expiresAt: new Date(tokenStatus.expiresAt).toISOString(),
            secondsToExpiry: Math.max(0, Math.floor((tokenStatus.expiresAt - Date.now()) / 1000))
          }
        }

        platformDetails.push(detail)
      }

      res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        platforms: platformDetails,
        messageQueue: messageBus.getQueueSize()
      })
    })

    // Platform status endpoint
    this.app.get("/platforms", (_req: Request, res: Response) => {
      const registered = registry.getRegisteredPlatforms()
      const enabled = registry.getEnabledPlatforms()

      res.json({
        registered,
        enabled,
        adapters: enabled.map((id) => {
          const adapter = registry.getAdapter(id)
          const info: Record<string, unknown> = {
            id,
            name: adapter?.name,
          }

          // Add connection mode for Feishu
          if (adapter instanceof FeishuAdapter) {
            info.mode = adapter.getConnectionMode()
            info.longConnectionActive = adapter.isLongConnectionActive()
            if (adapter.getConnectionMode() === "webhook") {
              info.webhookPath = `/webhook/${adapter.getWebhookPath()}`
            }
          } else {
            info.webhookPath = `/webhook/${adapter?.getWebhookPath()}`
          }

          return info
        })
      })
    })

    // Note: 404 and error handlers will be added after webhook routes are registered in start()
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    try {
      // Initialize Claude client
      this.claudeClient = new ClaudeClient({
        apiKey: this.config.claude.apiKey,
        model: this.config.claude.model,
        systemPrompt: this.config.claude.systemPrompt,
        maxTokens: this.config.claude.maxTokens
      })
      logger.info(`Claude client initialized with model: ${this.config.claude.model}`)

      // Initialize message handler
      this.messageHandler = new UnifiedMessageHandler(this.config, this.claudeClient)

      // Subscribe handler to message bus
      messageBus.subscribe(this.messageHandler.handle.bind(this.messageHandler))

      // Initialize all enabled platforms
      const adapters = await registry.initializeFromConfig(this.config.platforms)

      // Pass FeishuApiClient to ClaudeClient if Feishu is enabled
      const feishuAdapter = adapters.find((a) => a instanceof FeishuAdapter) as FeishuAdapter | undefined
      if (feishuAdapter) {
        this.claudeClient.setFeishuApiClient(feishuAdapter.getApiClient())
        logger.info("FeishuApiClient passed to ClaudeClient for document access")
      }

      // Pass DingTalkApiClient to ClaudeClient if DingTalk is enabled
      const dingtalkAdapter = adapters.find((a) => a instanceof DingTalkAdapter) as DingTalkAdapter | undefined
      if (dingtalkAdapter) {
        this.claudeClient.setDingTalkApiClient(dingtalkAdapter.getApiClient())
        logger.info("DingTalkApiClient passed to ClaudeClient for document access")
      }

      // Register webhook routes for platforms that use webhook mode
      for (const adapter of adapters) {
        // Check if this is Feishu adapter in long-connection mode
        if (adapter instanceof FeishuAdapter && adapter.getConnectionMode() === "long-connection") {
          logger.info(`Platform "${adapter.name}" using long-connection mode (no webhook route needed)`)
          continue
        }

        // Register webhook route for webhook-based platforms
        const webhookPath = `/webhook/${adapter.getWebhookPath()}`
        this.app.post(
          webhookPath,
          (req: Request, res: Response) => {
            adapter.handleWebhook(req, res).catch((error) => {
              logger.error(`Webhook error for ${adapter.name}: ${error}`)
              res.status(500).json({ error: "Internal server error" })
            })
          }
        )
        logger.info(`Platform "${adapter.name}" registered at ${webhookPath}`)
      }

      // Add 404 handler after all routes are registered
      this.app.use((_req: Request, res: Response) => {
        res.status(404).json({ error: "Not found" })
      })

      // Add error handler
      this.app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
        logger.error(`Server error: ${err.message}`)
        res.status(500).json({ error: "Internal server error" })
      })

      // Start server with auto port switching
      const basePort = this.config.server.port
      const maxAttempts = 10
      let serverStarted = false

      for (let attempt = 0; attempt < maxAttempts && !serverStarted; attempt++) {
        const port = basePort + attempt
        try {
          await new Promise<void>((resolve, reject) => {
            this.app.listen(port, () => {
              logger.info(`Server listening on port ${port}`)
              logger.info(`Environment: ${this.config.server.nodeEnv || "development"}`)
              logger.info(`Message queue: ${this.config.queue.messageQueueDir}`)
              logger.info(`Response queue: ${this.config.queue.responseQueueDir}`)
              resolve()
            }).once('error', reject)
          })
          serverStarted = true
        } catch (error) {
          if (attempt === maxAttempts - 1) {
            logger.error(`Failed to start server on ports ${basePort}-${basePort + maxAttempts - 1}`)
            throw error
          }
          logger.warn(`Port ${port} is busy, trying next port...`)
        }
      }

      // Log startup info
      logger.info("")
      logger.info("========================================")
      logger.info("Multi-Platform Bot Server is running!")
      logger.info("========================================")
      logger.info("")
      logger.info(`Enabled platforms: ${registry.getEnabledPlatforms().join(", ")}`)
      logger.info(`Model: ${this.config.claude.model}`)

      // Log connection modes
      for (const id of registry.getEnabledPlatforms()) {
        const adapter = registry.getAdapter(id)
        if (adapter instanceof FeishuAdapter) {
          logger.info(`  - ${adapter.name}: ${adapter.getConnectionMode()} mode`)
        }
      }

      logger.info("")
      logger.info("Endpoints:")
      logger.info(`  Health: http://localhost:${this.config.server.port}/health`)
      logger.info(`  Platforms: http://localhost:${this.config.server.port}/platforms`)
      logger.info("")
      logger.info("========================================")
    } catch (error) {
      logger.error(`Failed to start server: ${error}`)
      throw error
    }
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    messageBus.stopProcessing()
    await registry.disposeAll()
    logger.info("Server stopped")
  }

  /**
   * Get the Express app instance
   */
  getApp(): express.Express {
    return this.app
  }

  /**
   * Get the Claude client
   */
  getClaudeClient(): ClaudeClient {
    return this.claudeClient
  }

  /**
   * Get the message handler
   */
  getMessageHandler(): UnifiedMessageHandler {
    return this.messageHandler
  }
}