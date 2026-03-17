"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDockerCommand = buildDockerCommand;
const utils_1 = require("./utils");
/**
 * Build Docker command for either exec or run mode
 */
function buildDockerCommand(options) {
    const { command, image, workdir = "/workspace", visibleDevices = "all", shmSize = "16G", volumes = [], envVars = [], name, } = options;
    // Escape single quotes in command for bash -c wrapping
    const escapedCmd = command.replace(/'/g, "'\\''");
    let dockerCmd;
    if (name) {
        // Reuse existing container via docker exec
        const parts = ["docker exec"];
        if (workdir)
            parts.push(`-w ${(0, utils_1.shellQuote)(workdir)}`);
        if (envVars.length > 0) {
            for (const entry of envVars) {
                parts.push(`-e ${(0, utils_1.shellQuote)(entry)}`);
            }
        }
        parts.push(`${(0, utils_1.shellQuote)(name)} bash -c '${escapedCmd}'`);
        dockerCmd = parts.join(" ");
    }
    else {
        // One-shot docker run with mthreads runtime (MT GPU access)
        if (!image) {
            throw new Error("Docker image is required for docker run mode");
        }
        const parts = [
            "docker run --rm",
            "--network host",
            `--shm-size ${shmSize}`,
            "--runtime=mthreads",
            "--privileged",
            `--env MTHREADS_VISIBLE_DEVICES=${visibleDevices}`,
            "--env MTHREADS_DRIVER_CAPABILITIES=compute,utility",
            `-w ${(0, utils_1.shellQuote)(workdir)}`,
        ];
        if (volumes.length > 0) {
            for (const vol of volumes) {
                parts.push(`-v ${(0, utils_1.shellQuote)(vol)}`);
            }
        }
        if (envVars.length > 0) {
            for (const entry of envVars) {
                parts.push(`-e ${(0, utils_1.shellQuote)(entry)}`);
            }
        }
        parts.push(`${(0, utils_1.shellQuote)(image)} bash -c '${escapedCmd}'`);
        dockerCmd = parts.join(" ");
    }
    return dockerCmd;
}
//# sourceMappingURL=docker-builder.js.map