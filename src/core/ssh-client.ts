import { Client } from "ssh2"
import { spawn } from "child_process"
import { escapeSingleQuotes, buildWorkdirPrefix, truncateOutput } from "./utils"
import { buildDockerCommand } from "./docker-builder"
import type { ExecResult, ExecOptions, DockerExecArgs } from "./local-exec"

export interface SSHConfig {
  host: string
  user: string
  username?: string   // alias for user (ssh2 compat)
  password: string
  port: number | string
  sudoPasswd?: string
}

/**
 * Resolve username from SSHConfig, accepting both `user` and `username` fields.
 * Throws if neither is provided.
 */
function resolveUser(config: SSHConfig): string {
  const u = config.user || config.username
  if (!u) throw new Error("SSHConfig requires 'user' (or 'username') field")
  return u
}

export async function executeSSHCommand(config: SSHConfig, command: string, timeout = 120): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const { host, password, port } = config
    const user = resolveUser(config)
    let stdout = ""
    let stderr = ""
    let commandExecuted = false

    const conn = new Client()

    const timeoutTimer = setTimeout(() => {
      conn.end()
      reject(new Error(`${commandExecuted ? "Command" : "Connection"} timeout after ${timeout} seconds`))
    }, timeout * 1000)

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
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
              resolve({ stdout: truncateOutput(stdout), stderr, exitCode: code || 0 })
            })
            .on("data", (data: Buffer) => { stdout += data.toString() })
            .stderr.on("data", (data: Buffer) => { stderr += data.toString() })
        })
      })
      .on("error", (err) => {
        clearTimeout(timeoutTimer)
        reject(err)
      })

    conn.connect({
      host,
      port: typeof port === "string" ? parseInt(port, 10) : port,
      username: user,
      password,
      readyTimeout: timeout * 1000,
      algorithms: {
        kex: [
          "curve25519-sha256", "ecdh-sha2-nistp256", "ecdh-sha2-nistp384",
          "ecdh-sha2-nistp521", "diffie-hellman-group-exchange-sha256", "diffie-hellman-group14-sha256",
        ],
        cipher: [
          "aes128-ctr", "aes192-ctr", "aes256-ctr",
          "aes128-gcm@openssh.com", "aes256-gcm@openssh.com",
        ],
      },
    } as any)
  })
}

export async function execRemote(config: SSHConfig, command: string, options: ExecOptions = {}): Promise<ExecResult> {
  const workdir = options.workdir || "~"
  const timeout = options.timeout || 120
  const sudoPasswd = config.sudoPasswd || ""

  const remoteBody = `${buildWorkdirPrefix(workdir)}${command}`
  const remoteCmd = options.sudo
    ? `export MY_SUDO_PASSWD='${escapeSingleQuotes(sudoPasswd)}' && printf '%s\\n' "$MY_SUDO_PASSWD" | sudo -SE bash -lc '${escapeSingleQuotes(remoteBody)}'`
    : remoteBody

  return executeSSHCommand(config, remoteCmd, timeout)
}

export async function execRemoteDocker(config: SSHConfig, args: DockerExecArgs): Promise<ExecResult> {
  const sudoPasswd = config.sudoPasswd || ""
  const timeout = args.timeout || 300

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

  const remoteCmd = args.sudo
    ? `export MY_SUDO_PASSWD='${escapeSingleQuotes(sudoPasswd)}' && printf '%s\\n' "$MY_SUDO_PASSWD" | sudo -SE bash -lc '${escapeSingleQuotes(dockerCmd)}'`
    : dockerCmd

  return executeSSHCommand(config, remoteCmd, timeout)
}

export interface SyncArgs {
  localPath: string
  remotePath: string
  direction?: "push" | "pull"
  exclude?: string[]
  delete?: boolean
  timeout?: number
}

export async function syncFiles(config: SSHConfig, args: SyncArgs): Promise<ExecResult> {
  const timeout = args.timeout || 600
  const direction = args.direction || "push"

  let rsyncCmd = "rsync -avz --progress"
  if (args.exclude) {
    for (const pattern of args.exclude) rsyncCmd += ` --exclude '${pattern}'`
  }
  if (args.delete) rsyncCmd += " --delete"
  rsyncCmd += ` -e "ssh -p ${config.port} -o StrictHostKeyChecking=no -o ConnectTimeout=10"`

  const rsyncUser = resolveUser(config)
  if (direction === "push") {
    rsyncCmd += ` '${args.localPath}' ${rsyncUser}@${config.host}:'${args.remotePath}'`
  } else {
    rsyncCmd += ` ${rsyncUser}@${config.host}:'${args.remotePath}' '${args.localPath}'`
  }

  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""

    const proc = spawn("bash", ["-c", rsyncCmd], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, RSYNC_PASSWORD: config.password },
    })

    const timer = setTimeout(() => {
      proc.kill()
      resolve({ stdout: "", stderr: `Rsync timeout after ${timeout} seconds`, exitCode: 1 })
    }, timeout * 1000)

    proc.stdout?.on("data", (data: Buffer) => { stdout += data.toString() })
    proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString() })
    proc.on("close", (code) => {
      clearTimeout(timer)
      resolve({ stdout: truncateOutput(stdout), stderr, exitCode: code || 0 })
    })
    proc.on("error", () => {
      clearTimeout(timer)
      resolve({ stdout: "", stderr: "Failed to execute rsync command", exitCode: 1 })
    })
  })
}
