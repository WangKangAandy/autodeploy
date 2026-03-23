import { Client } from "ssh2"
import type {
  SSHConfig,
  ExecOptions,
  ExecResult,
  DockerArgs,
  SyncArgs,
  SyncResult,
} from "./types.js"
import {
  escapeSingleQuotes,
  buildWorkdirPrefix,
  truncateOutput,
  formatOutput,
} from "../shared/utils.js"
import { buildDockerCommand } from "../shared/docker-builder.js"
import { logger } from "../logger/execution-logger.js"

/**
 * Execute a command on a remote host via SSH using ssh2 library
 */
export async function executeSSHCommand(
  config: SSHConfig,
  command: string,
  timeout: number = 120
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const { host, user, password, port } = config

    let stdout = ""
    let stderr = ""
    let commandExecuted = false

    const conn = new Client()

    const timeoutTimer = setTimeout(() => {
      if (commandExecuted) {
        conn.end()
        reject(new Error(`Command timeout after ${timeout} seconds`))
      } else {
        conn.end()
        reject(new Error(`Connection timeout after ${timeout} seconds`))
      }
    }, timeout * 1000)

    conn
      .on("ready", () => {
        conn.exec(command, (err: any, stream: any) => {
          if (err) {
            clearTimeout(timeoutTimer)
            conn.end()
            return reject(err)
          }

          commandExecuted = true

          stream
            .on("close", (code: number) => {
              clearTimeout(timeoutTimer)
              conn.end()
              resolve({
                stdout,
                stderr,
                exitCode: code || 0,
              })
            })
            .on("data", (data: Buffer) => {
              stdout += data.toString()
            })
            .stderr.on("data", (data: Buffer) => {
              stderr += data.toString()
            })
        })
      })
      .on("error", (err: any) => {
        clearTimeout(timeoutTimer)
        reject(err)
      })

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
    })
  })
}

/**
 * Execute a shell command on a remote host via SSH
 */
export async function execRemote(
  config: SSHConfig,
  command: string,
  options?: ExecOptions
): Promise<ExecResult> {
  const workdir = options?.workdir || "~"
  const timeout = options?.timeout || 120
  const sudoPasswd = config.sudoPasswd || ""

  // Build remote command body with workdir
  const remoteBody = `${buildWorkdirPrefix(workdir)}${command}`

  // Wrap in sudo if requested
  const remoteCmd = options?.sudo
    ? `export MY_SUDO_PASSWD='${escapeSingleQuotes(sudoPasswd)}' && printf '%s\\n' "$MY_SUDO_PASSWD" | sudo -SE bash -lc '${escapeSingleQuotes(remoteBody)}'`
    : remoteBody

  // Log execution
  logger.log("remote-exec", "direct-call", { command, workdir, sudo: options?.sudo })

  return executeSSHCommand(config, remoteCmd, timeout)
}

/**
 * Run a command inside a Docker container on a remote host
 */
export async function execDocker(
  config: SSHConfig,
  args: DockerArgs
): Promise<ExecResult> {
  const sudoPasswd = config.sudoPasswd || ""
  const timeout = args.timeout || 300

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
  })

  // Wrap in sudo if requested
  const remoteCmd = args.sudo
    ? `export MY_SUDO_PASSWD='${escapeSingleQuotes(sudoPasswd)}' && printf '%s\\n' "$MY_SUDO_PASSWD" | sudo -SE bash -lc '${escapeSingleQuotes(dockerCmd)}'`
    : dockerCmd

  // Log execution
  logger.log("remote-docker", "direct-call", { command: args.command, image: args.image })

  return executeSSHCommand(config, remoteCmd, timeout)
}

/**
 * Sync files between local machine and remote host via rsync
 */
export async function syncFiles(
  config: SSHConfig,
  args: SyncArgs
): Promise<SyncResult> {
  const timeout = args.timeout || 600
  const direction = args.direction || "push"

  // Build rsync command
  let rsyncCmd: string

  if (direction === "push") {
    rsyncCmd = `rsync -avz --progress`
    if (args.exclude && args.exclude.length > 0) {
      for (const pattern of args.exclude) {
        rsyncCmd += ` --exclude '${pattern}'`
      }
    }
    if (args.delete) {
      rsyncCmd += " --delete"
    }
    rsyncCmd += ` -e "ssh -p ${config.port} -o StrictHostKeyChecking=no -o ConnectTimeout=10"`
    rsyncCmd += ` '${args.localPath}' ${config.user}@${config.host}:'${args.remotePath}'`
  } else {
    rsyncCmd = `rsync -avz --progress`
    if (args.exclude && args.exclude.length > 0) {
      for (const pattern of args.exclude) {
        rsyncCmd += ` --exclude '${pattern}'`
      }
    }
    if (args.delete) {
      rsyncCmd += " --delete"
    }
    rsyncCmd += ` -e "ssh -p ${config.port} -o StrictHostKeyChecking=no -o ConnectTimeout=10"`
    rsyncCmd += ` ${config.user}@${config.host}:'${args.remotePath}' '${args.localPath}'`
  }

  // Log execution
  logger.log("remote-sync", "direct-call", {
    ...args,
    direction,
    command: rsyncCmd.replace(/'([^']+)'/g, "***"),
  })

  // Execute rsync command locally
  const { spawn } = await import("child_process")

  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""

    const proc = spawn("bash", ["-c", rsyncCmd], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        RSYNC_PASSWORD: config.password,
      },
    })

    const timer = setTimeout(() => {
      proc.kill()
      resolve({
        stdout: "",
        stderr: `Rsync timeout after ${timeout} seconds`,
        exitCode: 1,
      })
    }, timeout * 1000)

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on("close", (code: number) => {
      clearTimeout(timer)
      resolve({
        stdout,
        stderr,
        exitCode: code || 0,
      })
    })

    proc.on("error", () => {
      clearTimeout(timer)
      resolve({
        stdout: "",
        stderr: "Failed to execute rsync command",
        exitCode: 1,
      })
    })
  })
}

/**
 * Format output for display
 */
export { formatOutput, truncateOutput }