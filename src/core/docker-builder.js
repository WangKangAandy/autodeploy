"use strict";

const { shellQuote } = require("./utils");

/**
 * Build Docker command for either exec or run mode
 *
 * @param {Object} options - Docker command options
 * @param {string} options.command - Command to execute in container
 * @param {string} [options.image] - Docker image (required for run mode)
 * @param {string} [options.workdir] - Working directory in container
 * @param {string} [options.visibleDevices] - GPU devices visible to container
 * @param {string} [options.shmSize] - Shared memory size
 * @param {string[]} [options.volumes] - Volume mounts
 * @param {string[]} [options.envVars] - Environment variables
 * @param {string} [options.name] - Container name (for exec mode)
 * @returns {string} Docker command
 */
function buildDockerCommand(options) {
  const {
    command,
    image,
    workdir = "/workspace",
    visibleDevices = "all",
    shmSize = "16G",
    volumes = [],
    envVars = [],
    name,
  } = options;

  // Escape single quotes in command for bash -c wrapping
  const escapedCmd = command.replace(/'/g, "'\\''");

  let dockerCmd;

  if (name) {
    // Reuse existing container via docker exec
    const parts = ["docker exec"];
    if (workdir) parts.push(`-w ${shellQuote(workdir)}`);
    if (envVars.length > 0) {
      for (const entry of envVars) {
        parts.push(`-e ${shellQuote(entry)}`);
      }
    }
    parts.push(`${shellQuote(name)} bash -c '${escapedCmd}'`);
    dockerCmd = parts.join(" ");
  } else {
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
      `-w ${shellQuote(workdir)}`,
    ];

    if (volumes.length > 0) {
      for (const vol of volumes) {
        parts.push(`-v ${shellQuote(vol)}`);
      }
    }

    if (envVars.length > 0) {
      for (const entry of envVars) {
        parts.push(`-e ${shellQuote(entry)}`);
      }
    }

    parts.push(`${shellQuote(image)} bash -c '${escapedCmd}'`);
    dockerCmd = parts.join(" ");
  }

  return dockerCmd;
}

module.exports = {
  buildDockerCommand,
};