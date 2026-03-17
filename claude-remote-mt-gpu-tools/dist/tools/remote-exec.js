"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoteExecTool = void 0;
const env_loader_js_1 = require("../shared/env-loader.js");
const ssh_client_js_1 = require("../shared/ssh-client.js");
const utils_js_1 = require("../shared/utils.js");
const execution_logger_js_1 = require("../logger/execution-logger.js");
/**
 * Remote Exec Tool - Execute shell commands on Remote MT-GPU Machine via SSH
 */
exports.RemoteExecTool = {
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
                description: "Remote working directory. Defaults to GPU_WORK_DIR env or home directory",
            },
            sudo: {
                type: "boolean",
                description: "Run the command through sudo on the remote host using MY_SUDO_PASSWD. Defaults to false. If MY_SUDO_PASSWD is unset, GPU_SSH_PASSWD is used as fallback.",
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
    async execute(args) {
        try {
            const env = (0, env_loader_js_1.getEnvConfig)();
            const workdir = args.workdir || env.workdir;
            const timeoutSec = args.timeout || 120;
            // Build remote command body with workdir
            const remoteBody = `${(0, utils_js_1.buildWorkdirPrefix)(workdir)}${args.command}`;
            // Wrap in sudo if requested
            const remoteCmd = args.sudo
                ? `export MY_SUDO_PASSWD='${(0, utils_js_1.escapeSingleQuotes)(env.sudoPasswd)}' && printf '%s\\n' "$MY_SUDO_PASSWD" | sudo -SE bash -lc '${(0, utils_js_1.escapeSingleQuotes)(remoteBody)}'`
                : remoteBody;
            // Log execution
            execution_logger_js_1.logger.log("remote-exec", "session-unknown", { ...args, command: args.command, workdir });
            // Execute via SSH
            const result = await (0, ssh_client_js_1.executeSSHCommand)({
                host: env.host,
                user: env.user,
                password: env.passwd,
                port: env.port,
                command: remoteCmd,
                timeout: timeoutSec,
            });
            // Format output
            const output = (0, utils_js_1.formatOutput)(result.stdout, result.stderr, result.exitCode);
            return {
                content: [
                    {
                        type: "text",
                        text: (0, utils_js_1.truncateOutput)(output),
                    },
                ],
                isError: result.exitCode !== 0,
            };
        }
        catch (error) {
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
//# sourceMappingURL=remote-exec.js.map