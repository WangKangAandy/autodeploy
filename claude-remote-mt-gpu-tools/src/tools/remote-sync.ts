import {
  getEnvConfig
} from "../shared/env-loader.js";
import {
  truncateOutput,
  formatOutput,
} from "../shared/utils.js";
import { logger } from "../logger/execution-logger.js";

/**
 * Remote Sync Tool - Sync files between local machine and Remote MT-GPU Machine
 */
export const RemoteSyncTool = {
  name: "remote-sync",
  description: `Sync files between the local machine and the Remote MT-GPU Machine via rsync over SSH.
Supports both push (local to remote) and pull (remote to local) directions.
Requires GPU_HOST, GPU_USER, GPU_SSH_PASSWD environment variables.`,
  inputSchema: {
    type: "object",
    properties: {
      local_path: {
        type: "string",
        description:
          "Local file or directory path. Can be relative or absolute path.",
      },
      remote_path: {
        type: "string",
        description:
          "Remote file or directory path on the Remote MT-GPU Machine. Relative paths are relative to GPU_WORK_DIR.",
      },
      direction: {
        type: "string",
        description: "Sync direction: 'push' (local to remote) or 'pull' (remote to local)",
        enum: ["push", "pull"],
        default: "push",
      },
      delete: {
        type: "boolean",
        description:
          "Delete files in destination that don't exist in source. Use with caution. Default: false",
        default: false,
      },
      exclude: {
        type: "array",
        items: { type: "string" },
        description:
          "Patterns to exclude from sync (rsync --exclude patterns). E.g. ['*.tmp', '.git']",
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

  async execute(args: any) {
    try {
      const env = getEnvConfig();
      const timeoutSec = args.timeout || 600;
      const direction = args.direction || "push";

      // Build rsync command
      let rsyncCmd: string;

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
      } else {
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
      logger.log("remote-sync", "session-unknown", {
        ...args,
        direction,
        command: rsyncCmd.replace(/'([^']+)'/g, "***"), // Mask paths in log
      });

      // Execute rsync command locally (not via SSH)
      const { spawn } = await import("child_process");

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

        proc.stdout?.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        proc.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on("close", (code: number) => {
          clearTimeout(timer);
          exitCode = code || 0;

          const output = formatOutput(stdout, stderr, exitCode);

          resolve({
            content: [
              {
                type: "text",
                text: truncateOutput(output),
              },
            ],
            isError: exitCode !== 0,
          });
        });

        proc.on("error", (_error: Error) => {
          clearTimeout(timer);
          // Swallow error as per lint rules
        });
      });
    } catch {
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