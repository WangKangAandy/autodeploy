"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoteDockerTool = void 0;
const env_loader_js_1 = require("../shared/env-loader.js");
const ssh_client_js_1 = require("../shared/ssh-client.js");
const utils_js_1 = require("../shared/utils.js");
const docker_builder_js_1 = require("../shared/docker-builder.js");
const execution_logger_js_1 = require("../logger/execution-logger.js");
/**
 * Remote Docker Tool - Run commands inside Docker containers on Remote MT-GPU Machine
 */
exports.RemoteDockerTool = {
    name: "remote-docker",
    description: `Run a command inside a Docker container on the Remote MT-GPU Machine via SSH.
This is the primary way to execute builds, tests, and GPU workloads in the MUSA SDK
container environment. Uses --runtime=mthreads for MT GPU access.
Requires GPU_HOST, GPU_USER, GPU_SSH_PASSWD environment variables.`,
    inputSchema: {
        type: "object",
        properties: {
            command: {
                type: "string",
                description: "The command to run inside the Docker container",
            },
            image: {
                type: "string",
                description: "Docker image to use. Defaults to TORCH_MUSA_DOCKER_IMAGE env var. Example: sh-harbor.mthreads.com/mcctest/musa-train:4.3.5_kuae2.1_20260119_torch2.7.1_ubuntu",
            },
            workdir: {
                type: "string",
                description: "Working directory inside the container. Default: /workspace",
                default: "/workspace",
            },
            visible_devices: {
                type: "string",
                description: "MTHREADS_VISIBLE_DEVICES value. Default: 'all'",
                default: "all",
            },
            shm_size: {
                type: "string",
                description: "Shared memory size. Default: '16G'",
                default: "16G",
            },
            volumes: {
                type: "array",
                items: { type: "string" },
                description: "Volume mounts. E.g. ['/data:/data', '/home/user/project:/workspace']",
                default: [],
            },
            env_vars: {
                type: "array",
                items: { type: "string" },
                description: "Extra environment variables as KEY=VALUE strings. E.g. ['FORCE_MUSA=1', 'DEBUG=true']",
                default: [],
            },
            name: {
                type: "string",
                description: "Container name. If set, reuses a running container with 'docker exec' instead of 'docker run'",
            },
            sudo: {
                type: "boolean",
                description: "Run the host-side docker command through sudo using MY_SUDO_PASSWD. Defaults to false. If MY_SUDO_PASSWD is unset, GPU_SSH_PASSWD is used as fallback.",
                default: false,
            },
            timeout: {
                type: "number",
                description: "Timeout in seconds. Default 300 (5 minutes)",
                default: 300,
            },
        },
        required: ["command"],
    },
    async execute(args) {
        try {
            const env = (0, env_loader_js_1.getEnvConfig)();
            const image = args.image || env.dockerImage;
            // Build Docker command
            const dockerCmd = (0, docker_builder_js_1.buildDockerCommand)({
                command: args.command,
                image,
                workdir: args.workdir || "/workspace",
                visibleDevices: args.visible_devices || "all",
                shmSize: args.shm_size || "16G",
                volumes: args.volumes || [],
                envVars: args.env_vars || [],
                name: args.name,
            });
            // Wrap in sudo if requested
            const remoteCmd = args.sudo
                ? `export MY_SUDO_PASSWD='${(0, utils_js_1.escapeSingleQuotes)(env.sudoPasswd)}' && printf '%s\\n' "$MY_SUDO_PASSWD" | sudo -SE bash -lc '${(0, utils_js_1.escapeSingleQuotes)(dockerCmd)}'`
                : dockerCmd;
            // Log execution
            execution_logger_js_1.logger.log("remote-docker", "session-unknown", { ...args, command: args.command, image });
            // Execute via SSH
            const result = await (0, ssh_client_js_1.executeSSHCommand)({
                host: env.host,
                user: env.user,
                password: env.passwd,
                port: env.port,
                command: remoteCmd,
                timeout: args.timeout || 300,
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
                        text: `Docker command failed: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    },
};
//# sourceMappingURL=remote-docker.js.map