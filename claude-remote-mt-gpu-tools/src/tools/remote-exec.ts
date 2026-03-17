import {
  getEnvConfig
} from "../shared/env-loader.js";
import {
  executeSSHCommand
} from "../shared/ssh-client.js";
import {
  truncateOutput,
  escapeSingleQuotes,
  buildWorkdirPrefix,
  formatOutput,
} from "../shared/utils.js";
import { logger } from "../logger/execution-logger.js";

/**
 * Remote Exec Tool - Execute shell commands on Remote MT-GPU Machine via SSH
 */
export const RemoteExecTool = {
  name: "remote-exec",
  description: `Execute a shell command on the Remote MT-GPU Machine via SSH.
Use this for any operation that must run on the GPU host: driver checks,
package installs, docker commands, GPU queries, compilation, etc.
Requires GPU_HOST, GPU_USER, GPU_SSH_PASSWD environment variables.`,
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute on the remote machine",
      },
      workdir: {
        type: "string",
        description:
          "Remote working directory. Defaults to GPU_WORK_DIR env or home directory",
      },
      sudo: {
        type: "boolean",
        description:
          "Run the command through sudo on the remote host using MY_SUDO_PASSWD. Defaults to false. If MY_SUDO_PASSWD is unset, GPU_SSH_PASSWD is used as fallback.",
        default: false,
      },
      timeout: {
        type: "number",
        description: "Timeout in seconds. Default 120",
        default: 120,
      },
    },
    required: ["command"],
  },

  async execute(args: any) {
    try {
      const env = getEnvConfig();
      const workdir = args.workdir || env.workdir;
      const timeoutSec = args.timeout || 120;

      // Build remote command body with workdir
      const remoteBody = `${buildWorkdirPrefix(workdir)}${args.command}`;

      // Wrap in sudo if requested
      const remoteCmd = args.sudo
        ? `export MY_SUDO_PASSWD='${escapeSingleQuotes(env.sudoPasswd)}' && printf '%s\\n' "$MY_SUDO_PASSWD" | sudo -SE bash -lc '${escapeSingleQuotes(remoteBody)}'`
        : remoteBody;

      // Log execution
      logger.log("remote-exec", "session-unknown", { ...args, command: args.command, workdir });

      // Execute via SSH
      const result = await executeSSHCommand({
        host: env.host,
        user: env.user,
        password: env.passwd,
        port: env.port,
        command: remoteCmd,
        timeout: timeoutSec,
      });

      // Format output
      const output = formatOutput(result.stdout, result.stderr, result.exitCode);

      return {
        content: [
          {
            type: "text",
            text: truncateOutput(output),
          },
        ],
        isError: result.exitCode !== 0,
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `SSH command failed: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};