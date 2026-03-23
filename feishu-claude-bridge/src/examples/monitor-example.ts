import { ClaudeMessageMonitor } from "../claude-monitor/monitor.js"
import { formatRequestForClaude } from "../utils/formatter.js"
import { logger } from "../utils/logger.js"
import type { ClaudeRequest } from "../message/types.js"

/**
 * Example: Using the Claude Message Monitor with Claude TUI
 *
 * This example shows how to integrate the message monitor with Claude TUI.
 * In a real implementation, you would replace the mock handler with actual
 * Claude API calls or Claude TUI integration.
 */

// Configuration
const config = {
  messageQueueDir: "./messages",
  responseQueueDir: "./responses",
  pollingInterval: 2000 // 2 seconds
}

// Create monitor
const monitor = new ClaudeMessageMonitor(config)

// Define message handler
async function handleClaudeRequest(request: ClaudeRequest): Promise<string> {
  // Format the request for Claude
  const formattedRequest = formatRequestForClaude(request)

  logger.info("╔══════════════════════════════════════════════╗")
  logger.info("║         新消息来自飞书                      ║")
  logger.info("╚══════════════════════════════════════════════╝")
  logger.info(formattedRequest)

  // In a real implementation, this would call Claude API or Claude TUI
  // For now, we'll return a mock response
  const mockResponse = `
你好！我收到了你的消息。

这是一个演示回复。在实际实现中，这里应该调用 Claude API 或与 Claude TUI 集成来生成真实的回复。

你的消息ID: ${request.requestId}
  `.trim()

  logger.info("Mock response generated")

  return mockResponse
}

// Start monitoring
logger.info("╔══════════════════════════════════════════════╗")
logger.info("║    飞书 Claude 消息监控器                    ║")
logger.info("╚══════════════════════════════════════════════╝")
logger.info("")

monitor.start(handleClaudeRequest)

// Handle graceful shutdown
process.on("SIGINT", () => {
  logger.info("\n收到停止信号，正在关闭监控器...")
  monitor.stop()
  process.exit(0)
})

process.on("SIGTERM", () => {
  logger.info("\n收到终止信号，正在关闭监控器...")
  monitor.stop()
  process.exit(0)
})

// Print queue status every 30 seconds
setInterval(() => {
  const status = monitor.getQueueStatus()
  if (status.pending > 0) {
    logger.info(`📬 队列状态: ${status.pending} 条待处理消息`)
  }
}, 30000)