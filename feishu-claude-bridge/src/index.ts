import { loadConfig } from "./config/validator.js"
import { Server } from "./server.js"
import { ClaudeClient } from "./claude-client.js"
import { AutoResponder } from "./auto-responder.js"
import { logger } from "./utils/logger.js"

/**
 * Main entry point for the Multi-Platform Claude Bridge
 *
 * This application provides a unified bot server for multiple chat platforms
 * (Feishu, DingTalk, etc.) with Claude API integration.
 *
 * Integration:
 * 1. Starts the webhook server to receive messages from multiple platforms
 * 2. Automatically responds to messages using Claude API
 * 3. Supports conversation history per user
 * 4. Platform adapters are loaded from configuration
 */

async function startServer(): Promise<Server> {
  try {
    logger.info("Starting Multi-Platform Claude Bridge...")

    // Load configuration
    const config = loadConfig()
    logger.info("Configuration loaded successfully")

    // Log enabled platforms
    const enabledPlatforms = config.platforms
      .filter((p) => p.enabled)
      .map((p) => p.type)
    logger.info(`Enabled platforms: ${enabledPlatforms.join(", ")}`)

    // Create and start server
    const server = new Server(config)
    await server.start()

    // Start the auto-responder for backward compatibility
    // (Processes messages from queue files)
    const claudeClient = server.getClaudeClient()
    const autoResponder = new AutoResponder({
      messageQueueDir: config.queue.messageQueueDir,
      claudeClient,
      checkInterval: 2000
    })
    autoResponder.start()

    logger.info("")
    logger.info("Auto-response is ENABLED")
    logger.info("")

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

// Export main components
export { startServer, Server, ClaudeClient, AutoResponder }

// Export core components
export { registry } from "./core/registry.js"
export { messageBus } from "./core/message-bus.js"
export { UnifiedMessageHandler } from "./core/handler.js"
export * from "./core/types.js"

// Export platform adapters
export { FeishuAdapter } from "./platforms/feishu/index.js"
export { DingTalkAdapter } from "./platforms/dingtalk/index.js"