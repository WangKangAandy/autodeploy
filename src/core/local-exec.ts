import { spawn } from "child_process"
import { truncateOutput } from "./utils"

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface ExecOptions {
  timeout?: number
  workdir?: string
  sudo?: boolean
  sudoPasswd?: string
}

export async function execLocal(command: string, options: ExecOptions = {}): Promise<ExecResult> {
  const timeout = options.timeout || 120
  const workdir = options.workdir

  let fullCommand = command
  if (workdir) {
    fullCommand = `cd '${workdir}' && ${command}`
  }
  if (options.sudo && options.sudoPasswd) {
    fullCommand = `printf '%s\\n' '${options.sudoPasswd}' | sudo -SE bash -lc '${fullCommand.replace(/'/g, "'\\''")}'`
  }

  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""

    const proc = spawn("bash", ["-c", fullCommand], {
      stdio: ["pipe", "pipe", "pipe"],
    })

    const timer = setTimeout(() => {
      proc.kill()
      resolve({
        stdout: truncateOutput(stdout),
        stderr: `Command timeout after ${timeout} seconds`,
        exitCode: 1,
      })
    }, timeout * 1000)

    proc.stdout?.on("data", (data: Buffer) => { stdout += data.toString() })
    proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString() })

    proc.on("close", (code) => {
      clearTimeout(timer)
      resolve({ stdout: truncateOutput(stdout), stderr, exitCode: code || 0 })
    })

    proc.on("error", (err) => {
      clearTimeout(timer)
      resolve({ stdout: "", stderr: `Failed to execute command: ${err.message}`, exitCode: 1 })
    })
  })
}

export interface DockerExecArgs {
  command: string
  image?: string
  workdir?: string
  visibleDevices?: string
  shmSize?: string
  volumes?: string[]
  envVars?: string[]
  name?: string
  timeout?: number
  sudo?: boolean
  sudoPasswd?: string
}

export async function execLocalDocker(args: DockerExecArgs): Promise<ExecResult> {
  const { buildDockerCommand } = await import("./docker-builder")

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

  return execLocal(dockerCmd, {
    timeout: args.timeout || 300,
    sudo: args.sudo,
    sudoPasswd: args.sudoPasswd,
  })
}
