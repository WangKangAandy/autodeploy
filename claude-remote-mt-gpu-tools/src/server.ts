import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { RemoteExecTool } from "./tools/remote-exec.js";
import { RemoteDockerTool } from "./tools/remote-docker.js";
import { RemoteSyncTool } from "./tools/remote-sync.js";

/**
 * Main MCP Server for Remote MT-GPU Tools
 */
class RemoteToolsServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "remote-mt-gpu-tools",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          RemoteExecTool,
          RemoteDockerTool,
          RemoteSyncTool,
        ],
      };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "remote-exec":
            return await RemoteExecTool.execute(args) as any;
          case "remote-docker":
            return await RemoteDockerTool.execute(args) as any;
          case "remote-sync":
            return await RemoteSyncTool.execute(args) as any;
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error executing ${name}: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private setupErrorHandling() {
    // Global error handler
    this.server.onerror = (error) => {
      console.error("[MCP Server Error]", error);
    };

    // Handle unexpected errors
    process.on("uncaughtException", (error) => {
      console.error("[Uncaught Exception]", error);
    });

    process.on("unhandledRejection", (reason, promise) => {
      console.error("[Unhandled Rejection at]", promise, "reason:", reason);
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("[Remote MT-GPU Tools MCP Server] Started successfully");
  }

  async stop() {
    await this.server.close();
    console.error("[Remote MT-GPU Tools MCP Server] Stopped");
  }
}

// Start the server
const server = new RemoteToolsServer();

// Graceful shutdown
process.on("SIGINT", async () => {
  console.error("\n[Remote MT-GPU Tools MCP Server] Received SIGINT, shutting down...");
  await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.error("\n[Remote MT-GPU Tools MCP Server] Received SIGTERM, shutting down...");
  await server.stop();
  process.exit(0);
});

// Start the server
server.start().catch((error) => {
  console.error("[Remote MT-GPU Tools MCP Server] Failed to start:", error);
  process.exit(1);
});