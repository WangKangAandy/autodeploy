import { loadConfig } from "./config/validator.js"
import { Server } from "./server.js"
import { ClaudeClient } from "./claude-client.js"
import { AutoResponder } from "./auto-responder.js"
import { logger } from "./utils/logger.js"

/**
 * Main entry point for the Feishu Claude Bridge
 *
 * Integration:
 * 1. Starts the webhook server to receive messages from Feishu
 * 2. Automatically responds to messages using Claude API
 * 3. Supports conversation history per user
 */

async function startServer(): Promise<Server> {
  try {
    logger.info("Starting Feishu Claude Bridge...")

    // Load configuration
    const config = loadConfig()
    logger.info("Configuration loaded successfully")

    // Create and start server
    const server = new Server(config)
    await server.start()

    // Initialize Claude client
    const claudeClient = new ClaudeClient({
      apiKey: config.claude.apiKey,
      model: config.claude.model,
      systemPrompt: config.claude.systemPrompt
    })
    logger.info(`Claude client initialized with model: ${config.claude.model}`)

    // Start the auto-responder
    const autoResponder = new AutoResponder({
      messageQueueDir: config.queue.messageQueueDir,
      claudeClient,
      checkInterval: 2000
    })
    autoResponder.start()

    logger.info("")
    logger.info("========================================")
    logger.info("Feishu Claude Bridge is running!")
    logger.info("========================================")
    logger.info("")
    logger.info("Auto-response is ENABLED")
    logger.info(`Model: ${config.claude.model}`)
    logger.info("")
    logger.info("To check status:")
    logger.info(`  curl http://localhost:${config.server.port}/health`)
    logger.info("")
    logger.info("========================================")

    return server
  } catch (error) {
    logger.error(`Failed to start application: ${error}`)
    throw error
  }
}

// Start the server when this file is run directly
startServer().catch((error) => {
  logger.error(`Fatal error: ${error}`)
  process.exit(1)
})

export { startServer, Server, ClaudeClient, AutoResponder }