import { tool } from "@opencode-ai/plugin"
import * as fs from "fs"
import * as path from "path"

const SSH_FLAGS = [
  "-o", "StrictHostKeyChecking=no",
  "-o", "ConnectTimeout=10",
  "-o", "ServerAliveInterval=30",
  "-o", "ServerAliveCountMax=3",
  "-o", "LogLevel=ERROR",
]

function loadEnvFile(): Record<string, string> {
  const envFile = path.join(process.cwd(), ".opencode", "remote-ssh.env")
  const vars: Record<string, string> = {}
  try {
    if (fs.existsSync(envFile)) {
      for (const line of fs.readFileSync(envFile, "utf-8").split("\n")) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const eq = trimmed.indexOf("=")
        if (eq > 0) vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
      }
    }
  } catch { /* ignore */ }
  return vars
}

function getEnv() {
  const file = loadEnvFile()
  const host = process.env.GPU_HOST || file.GPU_HOST
  const user = process.env.GPU_USER || file.GPU_USER
  const passwd = process.env.GPU_SSH_PASSWD || file.GPU_SSH_PASSWD
  const sudoPasswd = process.env.MY_SUDO_PASSWD || file.MY_SUDO_PASSWD || passwd
  const port = process.env.GPU_PORT || file.GPU_PORT || "22"
  const workdir = process.env.GPU_WORK_DIR || file.GPU_WORK_DIR || "~"
  if (!host || !user || !passwd) {
    throw new Error(
      "Missing required env vars. Set GPU_HOST, GPU_USER, and GPU_SSH_PASSWD.\n" +
      "Either as environment variables or in .opencode/remote-ssh.env\n" +
      `  GPU_HOST=${host || "(unset)"}\n` +
      `  GPU_USER=${user || "(unset)"}\n` +
      `  GPU_SSH_PASSWD=${passwd ? "(set)" : "(unset)"}`
    )
  }
  return { host, user, passwd, sudoPasswd, port, workdir }
}

function truncate(text: string, maxBytes: number = 51200): string {
  if (Buffer.byteLength(text) <= maxBytes) return text
  const truncated = Buffer.from(text).subarray(0, maxBytes).toString("utf-8")
  return truncated + "\n\n--- OUTPUT TRUNCATED (exceeded 50KB) ---"
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, "'\\''")
}

function escapeDoubleQuotes(value: string): string {
  return value.replace(/[\\"$`]/g, "\\$&")
}

function buildWorkdirPrefix(workdir: string): string {
  if (workdir === "~") return ""
  if (workdir.startsWith("~/")) {
    return `cd "$HOME/${escapeDoubleQuotes(workdir.slice(2))}" && `
  }
  const otherUserHome = workdir.match(/^(~[^/]+)(?:\/(.*))?$/)
  if (otherUserHome) {
    const [, homePrefix, rest = ""] = otherUserHome
    if (!rest) return `cd ${homePrefix} && `
    return `cd ${homePrefix}/${shellQuote(rest)} && `
  }
  return `cd '${escapeSingleQuotes(workdir)}' && `
}

function shellQuote(value: string): string {
  return `'${escapeSingleQuotes(value)}'`
}

function ensureLocalDependency(name: string): string | null {
  return Bun.which(name) || null
}

export default tool({
  description:
    "Execute a shell command on the Remote MT-GPU Machine via SSH. " +
    "Use this for any operation that must run on the GPU host: driver checks, " +
    "package installs, docker commands, GPU queries, compilation, etc. " +
    "Requires GPU_HOST, GPU_USER, GPU_SSH_PASSWD environment variables.",
  args: {
    command: tool.schema.string().describe(
      "The shell command to execute on the remote machine"
    ),
    workdir: tool.schema.string().optional().describe(
      "Remote working directory. Defaults to GPU_WORK_DIR env or home directory"
    ),
    sudo: tool.schema.boolean().optional().describe(
      "Run the command through sudo on the remote host using MY_SUDO_PASSWD. " +
      "Defaults to false. If MY_SUDO_PASSWD is unset, GPU_SSH_PASSWD is used as fallback."
    ),
    timeout: tool.schema.number().optional().describe(
      "Timeout in seconds. Default 120"
    ),
  },
  async execute(args, context) {
    if (!ensureLocalDependency("sshpass")) {
      return (
        "ERROR: Local dependency 'sshpass' is not installed. " +
        "Install it before using remote-exec so SSH password auth can work."
      )
    }

    const env = getEnv()
    const workdir = args.workdir || env.workdir
    const timeoutSec = args.timeout || 120

    const remoteBody = `${buildWorkdirPrefix(workdir)}${args.command}`

    const remoteCmd = args.sudo
      ? `export MY_SUDO_PASSWD='${escapeSingleQuotes(env.sudoPasswd)}' && printf '%s\n' "$MY_SUDO_PASSWD" | sudo -SE bash -lc '${escapeSingleQuotes(remoteBody)}'`
      : remoteBody

    const sshArgs = [
      "sshpass", "-p", env.passwd,
      "ssh",
      ...SSH_FLAGS,
      "-p", env.port,
      `${env.user}@${env.host}`,
      remoteCmd,
    ]

    // Short title for TUI display
    const shortCmd = args.command.length > 60
      ? args.command.substring(0, 57) + "..."
      : args.command
    context.metadata({ title: `${env.host}: ${shortCmd}` })

    try {
      const proc = Bun.spawn(sshArgs, {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      })

      // Timeout handling
      const timer = setTimeout(() => proc.kill(), timeoutSec * 1000)

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      const exitCode = await proc.exited
      clearTimeout(timer)

      let output = ""
      if (stdout.trim()) output += stdout
      if (stderr.trim()) output += (output ? "\n" : "") + `STDERR:\n${stderr}`
      output += `\nEXIT CODE: ${exitCode}`

      return truncate(output)
    } catch (err: any) {
      return `SSH command failed: ${err.message}`
    }
  },
})
