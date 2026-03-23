"use strict";

const { Client } = require("ssh2");
const { spawn } = require("child_process");
const {
  escapeSingleQuotes,
  buildWorkdirPrefix,
  truncateOutput,
} = require("./utils");
const { buildDockerCommand } = require("./docker-builder");

/**
 * Execute a command on a remote host via SSH using ssh2 library
 *
 * @param {Object} config - SSH configuration
 * @param {string} config.host - Remote host
 * @param {string} config.user - SSH username
 * @param {string} config.password - SSH password
 * @param {number|string} config.port - SSH port
 * @param {string} [config.sudoPasswd] - Sudo password
 * @param {string} command - Command to execute
 * @param {number} [timeout=120] - Timeout in seconds
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
async function executeSSHCommand(config, command, timeout = 120) {
  return new Promise((resolve, reject) => {
    const { host, user, password, port } = config;

    let stdout = "";
    let stderr = "";
    let commandExecuted = false;

    const conn = new Client();

    const timeoutTimer = setTimeout(() => {
      if (commandExecuted) {
        conn.end();
        reject(new Error(`Command timeout after ${timeout} seconds`));
      } else {
        conn.end();
        reject(new Error(`Connection timeout after ${timeout} seconds`));
      }
    }, timeout * 1000);

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timeoutTimer);
            conn.end();
            return reject(err);
          }

          commandExecuted = true;

          stream
            .on("close", (code) => {
              clearTimeout(timeoutTimer);
              conn.end();
              resolve({
                stdout: truncateOutput(stdout),
                stderr,
                exitCode: code || 0,
              });
            })
            .on("data", (data) => {
              stdout += data.toString();
            })
            .stderr.on("data", (data) => {
              stderr += data.toString();
            });
        });
      })
      .on("error", (err) => {
        clearTimeout(timeoutTimer);
        reject(err);
      });

    conn.connect({
      host,
      port: parseInt(port, 10),
      username: user,
      password,
      readyTimeout: timeout * 1000,
      algorithms: {
        kex: [
          "curve25519-sha256",
          "ecdh-sha2-nistp256",
          "ecdh-sha2-nistp384",
          "ecdh-sha2-nistp521",
          "diffie-hellman-group-exchange-sha256",
          "diffie-hellman-group14-sha256",
        ],
        cipher: [
          "aes128-ctr",
          "aes192-ctr",
          "aes256-ctr",
          "aes128-gcm@openssh.com",
          "aes256-gcm@openssh.com",
        ],
      },
      strictVendor: false,
      hostHash: "sha2",
    });
  });
}

/**
 * Execute a shell command on a remote host via SSH
 *
 * @param {Object} config - SSH configuration
 * @param {string} command - Command to execute
 * @param {Object} options - Execution options
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
async function execRemote(config, command, options = {}) {
  const workdir = options?.workdir || "~";
  const timeout = options?.timeout || 120;
  const sudoPasswd = config.sudoPasswd || "";

  // Build remote command body with workdir
  const remoteBody = `${buildWorkdirPrefix(workdir)}${command}`;

  // Wrap in sudo if requested
  const remoteCmd = options?.sudo
    ? `export MY_SUDO_PASSWD='${escapeSingleQuotes(sudoPasswd)}' && printf '%s\\n' "$MY_SUDO_PASSWD" | sudo -SE bash -lc '${escapeSingleQuotes(remoteBody)}'`
    : remoteBody;

  return executeSSHCommand(config, remoteCmd, timeout);
}

/**
 * Run a command inside a Docker container on a remote host
 *
 * @param {Object} config - SSH configuration
 * @param {Object} args - Docker arguments
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
async function execRemoteDocker(config, args) {
  const sudoPasswd = config.sudoPasswd || "";
  const timeout = args.timeout || 300;

  // Build Docker command
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

  // Wrap in sudo if requested
  const remoteCmd = args.sudo
    ? `export MY_SUDO_PASSWD='${escapeSingleQuotes(sudoPasswd)}' && printf '%s\\n' "$MY_SUDO_PASSWD" | sudo -SE bash -lc '${escapeSingleQuotes(dockerCmd)}'`
    : dockerCmd;

  return executeSSHCommand(config, remoteCmd, timeout);
}

/**
 * Sync files between local machine and remote host via rsync
 *
 * @param {Object} config - SSH configuration
 * @param {Object} args - Sync arguments
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
async function syncFiles(config, args) {
  const timeout = args.timeout || 600;
  const direction = args.direction || "push";

  // Build rsync command
  let rsyncCmd;

  if (direction === "push") {
    rsyncCmd = `rsync -avz --progress`;
    if (args.exclude && args.exclude.length > 0) {
      for (const pattern of args.exclude) {
        rsyncCmd += ` --exclude '${pattern}'`;
      }
    }
    if (args.delete) {
      rsyncCmd += " --delete";
    }
    rsyncCmd += ` -e "ssh -p ${config.port} -o StrictHostKeyChecking=no -o ConnectTimeout=10"`;
    rsyncCmd += ` '${args.localPath}' ${config.user}@${config.host}:'${args.remotePath}'`;
  } else {
    rsyncCmd = `rsync -avz --progress`;
    if (args.exclude && args.exclude.length > 0) {
      for (const pattern of args.exclude) {
        rsyncCmd += ` --exclude '${pattern}'`;
      }
    }
    if (args.delete) {
      rsyncCmd += " --delete";
    }
    rsyncCmd += ` -e "ssh -p ${config.port} -o StrictHostKeyChecking=no -o ConnectTimeout=10"`;
    rsyncCmd += ` ${config.user}@${config.host}:'${args.remotePath}' '${args.localPath}'`;
  }

  // Execute rsync command locally
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn("bash", ["-c", rsyncCmd], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        RSYNC_PASSWORD: config.password,
      },
    });

    const timer = setTimeout(() => {
      proc.kill();
      resolve({
        stdout: "",
        stderr: `Rsync timeout after ${timeout} seconds`,
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

    proc.on("error", () => {
      clearTimeout(timer);
      resolve({
        stdout: "",
        stderr: "Failed to execute rsync command",
        exitCode: 1,
      });
    });
  });
}

module.exports = {
  executeSSHCommand,
  execRemote,
  execRemoteDocker,
  syncFiles,
};