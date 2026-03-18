import Anthropic from "@anthropic-ai/sdk"
import { logger } from "./utils/logger.js"
import { ToolClient, type ToolClientConfig } from "./tool-client.js"
import { generateSystemPrompt, getContextAwarePrompt } from "./system-prompt.js"
import { parseCredentials } from "./credential-parser.js"

export interface ClaudeClientConfig {
  apiKey: string
  model?: string
  maxTokens?: number
  systemPrompt?: string
  toolClient?: ToolClient
}

// Tool definitions for Claude API with dynamic credentials support
const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "remote_exec",
    description:
      "Execute a shell command on a remote machine via SSH. " +
      "Use the credentials provided by the user in their message. " +
      "For dangerous operations (rm, uninstall, system config changes), ask user confirmation first.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute on the remote machine",
        },
        host: {
          type: "string",
          description: "Remote host IP address (use from user message if provided)",
        },
        user: {
          type: "string",
          description: "SSH username (use from user message if provided)",
        },
        password: {
          type: "string",
          description: "SSH password (use from user message if provided)",
        },
        sudo: {
          type: "boolean",
          description: "Run the command through sudo. Defaults to false.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "remote_docker",
    description:
      "Run a command inside a Docker container on a remote machine. " +
      "Use this for builds, tests, GPU workloads. " +
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
          description: "Docker image to use.",
        },
        name: {
          type: "string",
          description: "Container name for docker exec mode.",
        },
        host: {
          type: "string",
          description: "Remote host IP address",
        },
        user: {
          type: "string",
          description: "SSH username",
        },
        password: {
          type: "string",
          description: "SSH password",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "get_gpu_status",
    description:
      "Get the current GPU status from a remote machine using mthreads-gmi. " +
      "Use the credentials provided by the user in their message.",
    input_schema: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "Remote host IP address (use from user message if provided)",
        },
        user: {
          type: "string",
          description: "SSH username (use from user message if provided)",
        },
        password: {
          type: "string",
          description: "SSH password (use from user message if provided)",
        },
      },
    },
  },
  {
    name: "check_musa_status",
    description:
      "Check the complete MUSA environment status on a remote machine. " +
      "Includes GPU status, Docker, driver version, and running containers. " +
      "Use the credentials provided by the user in their message.",
    input_schema: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "Remote host IP address",
        },
        user: {
          type: "string",
          description: "SSH username",
        },
        password: {
          type: "string",
          description: "SSH password",
        },
      },
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
  private defaultToolClient: ToolClient | undefined
  private conversationHistory: Map<string, Anthropic.Messages.MessageParam[]> = new Map()
  // Store dynamic credentials per user session
  private userCredentials: Map<string, ToolClientConfig> = new Map()

  constructor(config: ClaudeClientConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
    })
    this.model = config.model || "claude-sonnet-4-20250514"
    this.maxTokens = config.maxTokens || 4096

    // Use provided prompt or generate optimized one
    this.systemPrompt = config.systemPrompt || generateSystemPrompt()

    this.defaultToolClient = config.toolClient

    logger.info(`Claude client initialized with model: ${this.model}, tools: enabled`)
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
        this.userCredentials.delete(userId)
      }

      // Try to parse credentials from message
      const parsedCreds = parseCredentials(message)
      if (parsedCreds) {
        logger.info(`Detected credentials in message for user ${userId}: ${parsedCreds.user}@${parsedCreds.host}`)
        this.userCredentials.set(userId, parsedCreds)
      }

      // Add user message to history
      history.push({ role: "user", content: message })

      // Determine if tools should be used
      const enableTools = options?.enableTools !== false

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
      if (toolUseBlocks.length > 0) {
        // Add assistant message with tool use to history
        history.push({ role: "assistant", content: response.content })

        // Process each tool use
        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []

        for (const toolUse of toolUseBlocks) {
          const result = await this.executeTool(toolUse, userId)
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
   * Get or create a ToolClient for a user
   */
  private getToolClient(userId: string, toolArgs?: { host?: string; user?: string; password?: string }): ToolClient {
    // Priority: tool args > stored user credentials > env config

    if (toolArgs?.host && toolArgs?.user && toolArgs?.password) {
      logger.info(`Using credentials from tool args: ${toolArgs.user}@${toolArgs.host}`)
      return ToolClient.fromCredentials(toolArgs.host, toolArgs.user, toolArgs.password)
    }

    const storedCreds = this.userCredentials.get(userId)
    if (storedCreds) {
      logger.info(`Using stored credentials for user ${userId}: ${storedCreds.user}@${storedCreds.host}`)
      return ToolClient.fromCredentials(storedCreds.host, storedCreds.user, storedCreds.password, storedCreds.port)
    }

    if (this.defaultToolClient) {
      logger.info(`Using default ToolClient from config`)
      return this.defaultToolClient
    }

    // Try to create from env
    try {
      return ToolClient.fromEnv()
    } catch {
      throw new Error("No SSH credentials available. Please provide host, user, and password in your message.")
    }
  }

  /**
   * Execute a tool call
   */
  private async executeTool(toolUse: Anthropic.ToolUseBlock, userId: string): Promise<string> {
    logger.info(`Executing tool: ${toolUse.name}`)

    try {
      const args = toolUse.input as Record<string, any>

      // Get appropriate ToolClient
      let client: ToolClient
      try {
        client = this.getToolClient(userId, {
          host: args.host,
          user: args.user,
          password: args.password,
        })
      } catch (error: any) {
        return `Error: ${error.message}`
      }

      // Log the connection being used
      logger.info(`Tool ${toolUse.name} using connection: ${client.getHostInfo()} (source: ${client.getCredentialsSource()})`)

      switch (toolUse.name) {
        case "remote_exec": {
          const result = await client.execCommand(args.command, { sudo: args.sudo })
          return await client.formatResult(result)
        }
        case "remote_docker": {
          const result = await client.execDocker(args.command, {
            image: args.image,
            name: args.name,
          })
          return await client.formatResult(result)
        }
        case "get_gpu_status": {
          return await client.getGpuStatus()
        }
        case "check_musa_status": {
          return await client.getMusaStatus()
        }
        default:
          return `Error: Unknown tool: ${toolUse.name}`
      }
    } catch (error: any) {
      logger.error(`Tool execution error: ${error.message}`)
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
    this.userCredentials.delete(userId)
    logger.info(`Conversation cleared for user ${userId}`)
  }

  /**
   * Clear all conversation histories
   */
  clearAllConversations(): void {
    this.conversationHistory.clear()
    this.userCredentials.clear()
    logger.info("All conversations cleared")
  }

  /**
   * Get conversation history for a user
   */
  getConversationHistory(userId: string): Anthropic.Messages.MessageParam[] {
    return this.conversationHistory.get(userId) || []
  }
}