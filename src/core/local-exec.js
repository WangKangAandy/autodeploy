"use strict";

const { spawn } = require("child_process");
const { formatOutput, truncateOutput } = require("./utils");

/**
 * Execute a command locally
 *
 * @param {string} command - Command to execute
 * @param {Object} options - Execution options
 * @param {number} [options.timeout=120] - Timeout in seconds
 * @param {string} [options.workdir] - Working directory
 * @param {boolean} [options.sudo=false] - Run with sudo
 * @param {string} [options.sudoPasswd] - Sudo password
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
async function execLocal(command, options = {}) {
  const timeout = options.timeout || 120;
  const workdir = options.workdir;

  // Build command with workdir and sudo
  let fullCommand = command;
  if (workdir) {
    fullCommand = `cd '${workdir}' && ${command}`;
  }
  if (options.sudo && options.sudoPasswd) {
    fullCommand = `printf '%s\\n' '${options.sudoPasswd}' | sudo -SE bash -lc '${fullCommand.replace(/'/g, "'\\''")}'`;
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn("bash", ["-c", fullCommand], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      proc.kill();
      resolve({
        stdout: truncateOutput(stdout),
        stderr: `Command timeout after ${timeout} seconds`,
        exitCode: 1,
      });
    }, timeout * 1000);

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: truncateOutput(stdout),
        stderr,
        exitCode: code || 0,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdout: "",
        stderr: `Failed to execute command: ${err.message}`,
        exitCode: 1,
      });
    });
  });
}

/**
 * Execute a Docker command locally
 *
 * @param {Object} args - Docker execution arguments
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
async function execLocalDocker(args) {
  const { buildDockerCommand } = require("./docker-builder");

  const dockerCmd = buildDockerCommand({
    command: args.command,
    image: args.image,
    workdir: args.workdir || "/workspace",
    visibleDevices: args.visibleDevices || "all",
    shmSize: args.shmSize || "16G",
    volumes: args.volumes || [],
    envVars: args.envVars || [],
    name: args.name,
  });

  return execLocal(dockerCmd, {
    timeout: args.timeout || 300,
    sudo: args.sudo,
    sudoPasswd: args.sudoPasswd,
  });
}

module.exports = {
  execLocal,
  execLocalDocker,
};