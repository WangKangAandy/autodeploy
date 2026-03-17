"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const remote_exec_js_1 = require("./tools/remote-exec.js");
const remote_docker_js_1 = require("./tools/remote-docker.js");
const remote_sync_js_1 = require("./tools/remote-sync.js");
/**
 * Main MCP Server for Remote MT-GPU Tools
 */
class RemoteToolsServer {
    server;
    constructor() {
        this.server = new index_js_1.Server({
            name: "remote-mt-gpu-tools",
            version: "1.0.0",
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
        this.setupErrorHandling();
    }
    setupToolHandlers() {
        // List available tools
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
            return {
                tools: [
                    remote_exec_js_1.RemoteExecTool,
                    remote_docker_js_1.RemoteDockerTool,
                    remote_sync_js_1.RemoteSyncTool,
                ],
            };
        });
        // Handle tool execution
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            try {
                switch (name) {
                    case "remote-exec":
                        return await remote_exec_js_1.RemoteExecTool.execute(args);
                    case "remote-docker":
                        return await remote_docker_js_1.RemoteDockerTool.execute(args);
                    case "remote-sync":
                        return await remote_sync_js_1.RemoteSyncTool.execute(args);
                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            }
            catch (error) {
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
    setupErrorHandling() {
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
        const transport = new stdio_js_1.StdioServerTransport();
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
//# sourceMappingURL=server.js.map