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
  return { host, user, passwd, port, workdir }
}

function truncate(text: string, maxBytes: number = 51200): string {
  if (Buffer.byteLength(text) <= maxBytes) return text
  const truncated = Buffer.from(text).subarray(0, maxBytes).toString("utf-8")
  return truncated + "\n\n--- OUTPUT TRUNCATED (exceeded 50KB) ---"
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
    timeout: tool.schema.number().optional().describe(
      "Timeout in seconds. Default 120"
    ),
  },
  async execute(args, context) {
    const env = getEnv()
    const workdir = args.workdir || env.workdir
    const timeoutSec = args.timeout || 120

    // Build the remote command with cd
    const remoteCmd = workdir !== "~"
      ? `cd ${workdir} && ${args.command}`
      : args.command

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
