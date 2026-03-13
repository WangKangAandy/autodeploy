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
  if (!host || !user || !passwd) {
    throw new Error(
      "Missing required env vars. Set GPU_HOST, GPU_USER, and GPU_SSH_PASSWD.\n" +
      "Either as environment variables or in .opencode/remote-ssh.env\n" +
      `  GPU_HOST=${host || "(unset)"}\n` +
      `  GPU_USER=${user || "(unset)"}\n` +
      `  GPU_SSH_PASSWD=${passwd ? "(set)" : "(unset)"}`
    )
  }
  return { host, user, passwd, port }
}

function truncate(text: string, maxBytes: number = 51200): string {
  if (Buffer.byteLength(text) <= maxBytes) return text
  const truncated = Buffer.from(text).subarray(0, maxBytes).toString("utf-8")
  return truncated + "\n\n--- OUTPUT TRUNCATED (exceeded 50KB) ---"
}

export default tool({
  description:
    "Run a command inside a Docker container on the Remote MT-GPU Machine via SSH. " +
    "This is the primary way to execute builds, tests, and GPU workloads in the MUSA SDK " +
    "container environment. Uses --runtime=mthreads for MT GPU access. " +
    "Requires GPU_HOST, GPU_USER, GPU_SSH_PASSWD environment variables.",
  args: {
    command: tool.schema.string().describe(
      "The command to run inside the Docker container"
    ),
    image: tool.schema.string().optional().describe(
      "Docker image to use. Defaults to TORCH_MUSA_DOCKER_IMAGE env var. " +
      "Example: sh-harbor.mthreads.com/mcctest/musa-train:4.3.5_kuae2.1_20260119_torch2.7.1_ubuntu"
    ),
    workdir: tool.schema.string().optional().describe(
      "Working directory inside the container. Default: /workspace"
    ),
    visible_devices: tool.schema.string().optional().describe(
      "MTHREADS_VISIBLE_DEVICES value. Default: 'all'"
    ),
    shm_size: tool.schema.string().optional().describe(
      "Shared memory size. Default: '16G'"
    ),
    volumes: tool.schema.array(tool.schema.string()).optional().describe(
      "Volume mounts. E.g. ['/data:/data', '/home/user/project:/workspace']"
    ),
    env_vars: tool.schema.array(tool.schema.string()).optional().describe(
      "Extra environment variables as KEY=VALUE strings. E.g. ['FORCE_MUSA=1', 'DEBUG=true']"
    ),
    name: tool.schema.string().optional().describe(
      "Container name. If set, reuses a running container with 'docker exec' instead of 'docker run'"
    ),
    timeout: tool.schema.number().optional().describe(
      "Timeout in seconds. Default 300 (5 minutes)"
    ),
  },
  async execute(args, context) {
    const env = getEnv()
    const image = args.image || process.env.TORCH_MUSA_DOCKER_IMAGE
    const workdir = args.workdir || "/workspace"
    const visibleDevices = args.visible_devices || "all"
    const shmSize = args.shm_size || "16G"
    const timeoutSec = args.timeout || 300

    // Escape single quotes in command for bash -c wrapping
    const escapedCmd = args.command.replace(/'/g, "'\\''")

    // Build docker command
    let dockerCmd: string

    if (args.name) {
      // Reuse existing container via docker exec
      const parts = ["docker exec"]
      if (args.workdir) parts.push(`-w ${workdir}`)
      if (args.env_vars) {
        for (const entry of args.env_vars) {
          parts.push(`-e '${entry}'`)
        }
      }
      parts.push(`${args.name} bash -c '${escapedCmd}'`)
      dockerCmd = parts.join(" ")
    } else {
      // One-shot docker run with mthreads runtime (MT GPU access)
      if (!image) {
        return "ERROR: No Docker image specified. Set the 'image' argument or TORCH_MUSA_DOCKER_IMAGE env var."
      }
      const parts = [
        "docker run --rm",
        "--network host",
        `--shm-size ${shmSize}`,
        "--runtime=mthreads",
        "--privileged",
        `--env MTHREADS_VISIBLE_DEVICES=${visibleDevices}`,
        "--env MTHREADS_DRIVER_CAPABILITIES=compute,utility",
        `-w ${workdir}`,
      ]
      if (args.volumes) {
        for (const vol of args.volumes) parts.push(`-v ${vol}`)
      }
      if (args.env_vars) {
        for (const entry of args.env_vars) {
          parts.push(`-e '${entry}'`)
        }
      }
      parts.push(`${image} bash -c '${escapedCmd}'`)
      dockerCmd = parts.join(" ")
    }

    // Wrap in SSH
    const sshArgs = [
      "sshpass", "-p", env.passwd,
      "ssh",
      ...SSH_FLAGS,
      "-p", env.port,
      `${env.user}@${env.host}`,
      dockerCmd,
    ]

    const shortCmd = args.command.length > 50
      ? args.command.substring(0, 47) + "..."
      : args.command
    const label = args.name ? `container:${args.name}` : "docker-run"
    context.metadata({ title: `${env.host} ${label}: ${shortCmd}` })

    try {
      const proc = Bun.spawn(sshArgs, {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      })

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
      return `Docker command failed: ${err.message}`
    }
  },
})
