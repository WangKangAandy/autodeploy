import type { Request, Response } from "express"
import express from "express"
import type { AppConfig } from "./config/types.js"
import { MessageProcessor } from "./message/processor.js"
import { MessageFormatter } from "./message/formatter.js"
import { PrivateChatHandler } from "./handlers/private-chat.js"
import { GroupChatHandler } from "./handlers/group-chat.js"
import { WebhookVerifier } from "./webhook/verifier.js"
import { initTokenManager, getAppAccessToken } from "./utils/helpers.js"
import { logger } from "./utils/logger.js"
import type { FeishuMessageEvent } from "./message/types.js"

export class Server {
  private app: express.Express
  private config: AppConfig
  private messageProcessor: MessageProcessor
  private messageFormatter: MessageFormatter
  private webhookVerifier: WebhookVerifier
  private botOpenId: string = ""

  constructor(config: AppConfig) {
    this.config = config
    this.app = express()

    // Initialize message processor and formatter
    this.messageProcessor = new MessageProcessor(
      config.queue.messageQueueDir,
      config.queue.responseQueueDir
    )
    this.messageFormatter = new MessageFormatter()

    // Initialize webhook verifier
    this.webhookVerifier = new WebhookVerifier(config.feishu.encryptKey)

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
      res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        messageQueue: this.messageProcessor.getMessageQueue().length
      })
    })

    // Message queue status endpoint
    this.app.get("/queue", (_req: Request, res: Response) => {
      const queue = this.messageProcessor.getMessageQueue()
      res.json({
        status: "ok",
        queueSize: queue.length,
        messages: queue
      })
    })

    // Webhook endpoint for Feishu
    this.app.post("/webhook/feishu", this.handleWebhook.bind(this))

    // 404 handler
    this.app.use((_req: Request, res: Response) => {
      res.status(404).json({ error: "Not found" })
    })

    // Error handler
    this.app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
      logger.error(`Server error: ${err.message}`)
      res.status(500).json({ error: "Internal server error" })
    })
  }

  async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      // Debug: log the incoming request
      logger.info(`Incoming webhook: type=${req.body?.type}, event_type=${req.body?.header?.event_type}`)
      logger.info(`Full request body: ${JSON.stringify(req.body)}`)

      // Handle URL verification challenge
      // 飞书平台会先验证URL，验证成功后才能获取到 Verification Token 和 Encrypt Key
      // 所以这里暂时不做 token 校验，直接返回 challenge
      if (req.body?.type === "url_verification") {
        const { challenge, token } = req.body
        logger.info(`URL verification request received, token: ${token}`)

        // 如果已配置 verificationToken，则校验；否则跳过校验
        if (this.config.feishu.verificationToken && this.config.feishu.verificationToken.length > 0) {
          if (token !== this.config.feishu.verificationToken) {
            logger.warn(`Invalid verification token, expected: ${this.config.feishu.verificationToken}`)
            res.status(401).json({ error: "Invalid verification token" })
            return
          }
        }

        logger.info("URL verification successful")
        res.json({ challenge })
        return
      }

      // Handle message events
      if (req.body?.header?.event_type === "im.message.receive_v1") {
        // Verify signature if headers are present
        const timestamp = req.headers["x-lark-request-timestamp"] as string
        const nonce = req.headers["x-lark-request-nonce"] as string
        const signature = req.headers["x-lark-signature"] as string

        if (timestamp && nonce && signature) {
          const body = JSON.stringify(req.body)
          const isValid = this.webhookVerifier.verify({
            timestamp,
            nonce,
            body,
            encryptKey: this.config.feishu.encryptKey,
            signature
          })

          if (!isValid) {
            logger.warn("Invalid webhook signature")
            res.status(401).json({ error: "Invalid signature" })
            return
          }
        }

        // Process the event asynchronously
        const event = req.body as FeishuMessageEvent
        this.processMessageEvent(event).catch((error) => {
          logger.error(`Error processing message event: ${error}`)
        })

        res.status(200).json({ code: 0, msg: "success" })
        return
      }

      res.status(400).json({ error: "Unsupported event type" })
    } catch (error) {
      logger.error(`Webhook error: ${error}`)
      res.status(500).json({ error: "Internal server error" })
    }
  }

  private async processMessageEvent(event: FeishuMessageEvent): Promise<void> {
    const chatType = event.event.message.chat_type

    if (chatType === "p2p") {
      const handler = new PrivateChatHandler(
        this.messageProcessor,
        this.messageFormatter,
        this.botOpenId
      )
      await handler.handle(event)
    } else if (chatType === "group") {
      const handler = new GroupChatHandler(
        this.messageProcessor,
        this.messageFormatter,
        this.botOpenId
      )
      await handler.handle(event)
    }
  }

  async start(): Promise<void> {
    try {
      // Initialize token manager for automatic token refresh
      initTokenManager(this.config.feishu.appId, this.config.feishu.appSecret)

      // Get app access token
      logger.info("Getting Feishu app access token...")
      const appAccessToken = await getAppAccessToken(
        this.config.feishu.appId,
        this.config.feishu.appSecret
      )
      logger.info("App access token obtained")

      // Get bot info to get open_id
      logger.info("Getting bot info...")
      const baseUrl = process.env.FEISHU_BASE_URL || "https://open.feishu.cn"
      const botInfoResponse = await fetch(`${baseUrl}/open-apis/bot/v3/info`, {
        headers: {
          Authorization: `Bearer ${appAccessToken}`
        }
      })

      if (botInfoResponse.ok) {
        const botInfo = (await botInfoResponse.json()) as { code: number; bot: { open_id: string } }
        if (botInfo.code === 0 && botInfo.bot.open_id) {
          this.botOpenId = botInfo.bot.open_id
          logger.info(`Bot open_id: ${this.botOpenId}`)
        }
      }

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
              logger.info(`Environment: ${this.config.server.nodeEnv}`)
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
    } catch (error) {
      logger.error(`Failed to start server: ${error}`)
      throw error
    }
  }

  stop(): void {
    logger.info("Server stopped")
  }
}