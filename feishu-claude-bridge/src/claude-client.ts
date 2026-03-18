import Anthropic from "@anthropic-ai/sdk"
import { logger } from "./utils/logger.js"
import { ToolClient } from "./tool-client.js"
import { generateSystemPrompt, getContextAwarePrompt } from "./system-prompt.js"

export interface ClaudeClientConfig {
  apiKey: string
  model?: string
  maxTokens?: number
  systemPrompt?: string
  toolClient?: ToolClient
}

// Tool definitions for Claude API
const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "remote_exec",
    description:
      "Execute a shell command on the Remote MT-GPU Machine via SSH. " +
      "Use this for GPU queries, driver checks, docker commands, system packages, etc. " +
      "For dangerous operations (rm, uninstall, system config changes), ask user confirmation first.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute on the remote machine",
        },
        sudo: {
          type: "boolean",
          description: "Run the command through sudo. Defaults to false. Use only when necessary.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "remote_docker",
    description:
      "Run a command inside a Docker container on the Remote MT-GPU Machine. " +
      "Use this for builds, tests, GPU workloads in the MUSA SDK container. " +
      "Automatically uses --runtime=mthreads for MT GPU access.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The command to run inside the Docker container",
        },
        image: {
          type: "string",
          description: "Docker image to use. Defaults to TORCH_MUSA_DOCKER_IMAGE env var.",
        },
        name: {
          type: "string",
          description: "Container name. If set, uses 'docker exec' on existing container; otherwise 'docker run --rm'",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "get_gpu_status",
    description:
      "Get the current GPU status from the Remote MT-GPU Machine using mthreads-gmi. " +
      "Use this for quick GPU health checks, driver version verification, and GPU utilization info.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
]

/**
 * Claude API Client - Handles communication with Claude API with tool support
 */
export class ClaudeClient {
  private client: Anthropic
  private model: string
  private maxTokens: number
  private systemPrompt: string
  private toolClient: ToolClient | undefined
  private conversationHistory: Map<string, Anthropic.Messages.MessageParam[]> = new Map()

  constructor(config: ClaudeClientConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
    })
    this.model = config.model || "claude-sonnet-4-20250514"
    this.maxTokens = config.maxTokens || 4096

    // Use provided prompt or generate optimized one
    this.systemPrompt = config.systemPrompt || generateSystemPrompt()

    this.toolClient = config.toolClient

    logger.info(`Claude client initialized with model: ${this.model}, tools: ${this.toolClient ? "enabled" : "disabled"}`)
  }

  /**
   * Send a message to Claude and get a response
   */
  async sendMessage(
    userId: string,
    message: string,
    options?: {
      resetConversation?: boolean
      systemPrompt?: string
      enableTools?: boolean
    }
  ): Promise<string> {
    try {
      // Get or create conversation history for this user
      let history = this.conversationHistory.get(userId) || []

      // Reset conversation if requested
      if (options?.resetConversation) {
        history = []
        this.conversationHistory.set(userId, history)
      }

      // Add user message to history
      history.push({ role: "user", content: message })

      // Determine if tools should be used
      const enableTools = options?.enableTools !== false && this.toolClient !== undefined

      // Use custom system prompt, context-aware prompt, or default
      const systemPrompt = options?.systemPrompt || getContextAwarePrompt(message) || this.systemPrompt

      // Call Claude API
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: systemPrompt,
        messages: history,
        tools: enableTools ? TOOLS : undefined,
      })

      // Handle tool use if present
      let responseText = ""
      const toolUseBlocks: Anthropic.ToolUseBlock[] = []

      for (const block of response.content) {
        if (block.type === "text") {
          responseText += block.text
        } else if (block.type === "tool_use") {
          toolUseBlocks.push(block)
        }
      }

      // Process tool use blocks
      if (toolUseBlocks.length > 0 && this.toolClient) {
        // Add assistant message with tool use to history
        history.push({ role: "assistant", content: response.content })

        // Process each tool use
        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []

        for (const toolUse of toolUseBlocks) {
          const result = await this.executeTool(toolUse)
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result,
          })
        }

        // Add tool result to history
        history.push({
          role: "user",
          content: toolResults,
        })

        // Get final response after tool use
        const finalResponse = await this.client.messages.create({
          model: this.model,
          max_tokens: this.maxTokens,
          system: systemPrompt,
          messages: history,
        })

        responseText = this.extractText(finalResponse)

        // Add final assistant response to history
        history.push({ role: "assistant", content: responseText })
      } else {
        // Add assistant response to history
        history.push({ role: "assistant", content: responseText })
      }

      // Update conversation history (keep last 20 messages to avoid context overflow)
      if (history.length > 20) {
        history = history.slice(-20)
      }
      this.conversationHistory.set(userId, history)

      logger.info(`Claude response generated for user ${userId}, length: ${responseText.length}`)

      return responseText
    } catch (error) {
      logger.error(`Claude API error: ${error}`)
      throw error
    }
  }

  /**
   * Execute a tool call
   */
  private async executeTool(toolUse: Anthropic.ToolUseBlock): Promise<string> {
    if (!this.toolClient) {
      return "Error: Tool client not configured"
    }

    logger.info(`Executing tool: ${toolUse.name}`)

    try {
      switch (toolUse.name) {
        case "remote_exec": {
          const args = toolUse.input as { command: string; sudo?: boolean }
          const result = await this.toolClient.execCommand(args.command, { sudo: args.sudo })
          return await this.toolClient.formatResult(result)
        }
        case "remote_docker": {
          const args = toolUse.input as { command: string; image?: string; name?: string }
          const result = await this.toolClient.execDocker(args.command, {
            image: args.image,
            name: args.name,
          })
          return await this.toolClient.formatResult(result)
        }
        case "get_gpu_status": {
          return await this.toolClient.getGpuStatus()
        }
        default:
          return `Error: Unknown tool: ${toolUse.name}`
      }
    } catch (error: any) {
      return `Error executing ${toolUse.name}: ${error.message}`
    }
  }

  /**
   * Extract text content from Claude response
   */
  private extractText(response: Anthropic.Messages.Message): string {
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === "text"
    )
    return textBlocks.map((block) => block.text).join("\n")
  }

  /**
   * Clear conversation history for a user
   */
  clearConversation(userId: string): void {
    this.conversationHistory.delete(userId)
    logger.info(`Conversation cleared for user ${userId}`)
  }

  /**
   * Clear all conversation histories
   */
  clearAllConversations(): void {
    this.conversationHistory.clear()
    logger.info("All conversations cleared")
  }

  /**
   * Get conversation history for a user
   */
  getConversationHistory(userId: string): Anthropic.Messages.MessageParam[] {
    return this.conversationHistory.get(userId) || []
  }
}