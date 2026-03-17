"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoteSyncTool = void 0;
const env_loader_js_1 = require("../shared/env-loader.js");
const utils_js_1 = require("../shared/utils.js");
const execution_logger_js_1 = require("../logger/execution-logger.js");
/**
 * Remote Sync Tool - Sync files between local machine and Remote MT-GPU Machine
 */
exports.RemoteSyncTool = {
    name: "remote-sync",
    description: `Sync files between the local machine and the Remote MT-GPU Machine via rsync over SSH.
Supports both push (local to remote) and pull (remote to local) directions.
Requires GPU_HOST, GPU_USER, GPU_SSH_PASSWD environment variables.`,
    inputSchema: {
        type: "object",
        properties: {
            local_path: {
                type: "string",
                description: "Local file or directory path. Can be relative or absolute path.",
            },
            remote_path: {
                type: "string",
                description: "Remote file or directory path on the Remote MT-GPU Machine. Relative paths are relative to GPU_WORK_DIR.",
            },
            direction: {
                type: "string",
                description: "Sync direction: 'push' (local to remote) or 'pull' (remote to local)",
                enum: ["push", "pull"],
                default: "push",
            },
            delete: {
                type: "boolean",
                description: "Delete files in destination that don't exist in source. Use with caution. Default: false",
                default: false,
            },
            exclude: {
                type: "array",
                items: { type: "string" },
                description: "Patterns to exclude from sync (rsync --exclude patterns). E.g. ['*.tmp', '.git']",
                default: [],
            },
            timeout: {
                type: "number",
                description: "Timeout in seconds. Default 600 (10 minutes)",
                default: 600,
            },
        },
        required: ["local_path", "remote_path"],
    },
    async execute(args) {
        try {
            const env = (0, env_loader_js_1.getEnvConfig)();
            const timeoutSec = args.timeout || 600;
            const direction = args.direction || "push";
            // Build rsync command
            let rsyncCmd;
            if (direction === "push") {
                // Push: local -> remote
                rsyncCmd = `rsync -avz --progress`;
                if (args.exclude && args.exclude.length > 0) {
                    for (const pattern of args.exclude) {
                        rsyncCmd += ` --exclude '${pattern}'`;
                    }
                }
                if (args.delete) {
                    rsyncCmd += " --delete";
                }
                rsyncCmd += ` -e "ssh -p ${env.port} -o StrictHostKeyChecking=no -o ConnectTimeout=10"`;
                rsyncCmd += ` '${args.local_path}' ${env.user}@${env.host}:'${args.remote_path}'`;
            }
            else {
                // Pull: remote -> local
                rsyncCmd = `rsync -avz --progress`;
                if (args.exclude && args.exclude.length > 0) {
                    for (const pattern of args.exclude) {
                        rsyncCmd += ` --exclude '${pattern}'`;
                    }
                }
                if (args.delete) {
                    rsyncCmd += " --delete";
                }
                rsyncCmd += ` -e "ssh -p ${env.port} -o StrictHostKeyChecking=no -o ConnectTimeout=10"`;
                rsyncCmd += ` ${env.user}@${env.host}:'${args.remote_path}' '${args.local_path}'`;
            }
            // Log execution
            execution_logger_js_1.logger.log("remote-sync", "session-unknown", {
                ...args,
                direction,
                command: rsyncCmd.replace(/'([^']+)'/g, "***"), // Mask paths in log
            });
            // Execute rsync command locally (not via SSH)
            const { spawn } = await Promise.resolve().then(() => __importStar(require("child_process")));
            return new Promise((resolve) => {
                let stdout = "";
                let stderr = "";
                let exitCode = 0;
                const proc = spawn("bash", ["-c", rsyncCmd], {
                    stdio: ["pipe", "pipe", "pipe"],
                    env: {
                        ...process.env,
                        RSYNC_PASSWORD: env.passwd, // For rsync with password (if using rsync daemon)
                    },
                });
                // Set timeout
                const timer = setTimeout(() => {
                    proc.kill();
                    resolve({
                        content: [
                            {
                                type: "text",
                                text: `Rsync timeout after ${timeoutSec} seconds`,
                            },
                        ],
                        isError: true,
                    });
                }, timeoutSec * 1000);
                proc.stdout?.on("data", (data) => {
                    stdout += data.toString();
                });
                proc.stderr?.on("data", (data) => {
                    stderr += data.toString();
                });
                proc.on("close", (code) => {
                    clearTimeout(timer);
                    exitCode = code || 0;
                    const output = (0, utils_js_1.formatOutput)(stdout, stderr, exitCode);
                    resolve({
                        content: [
                            {
                                type: "text",
                                text: (0, utils_js_1.truncateOutput)(output),
                            },
                        ],
                        isError: exitCode !== 0,
                    });
                });
                proc.on("error", (_error) => {
                    clearTimeout(timer);
                    // Swallow error as per lint rules
                });
            });
        }
        catch {
            return {
                content: [
                    {
                        type: "text",
                        text: "File sync failed",
                    },
                ],
                isError: true,
            };
        }
    },
};
//# sourceMappingURL=remote-sync.js.map