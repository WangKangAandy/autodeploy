import { shellQuote } from "./utils"

export interface DockerCommandOptions {
  command: string
  image?: string
  workdir?: string
  visibleDevices?: string
  shmSize?: string
  volumes?: string[]
  envVars?: string[]
  name?: string
}

export function buildDockerCommand(options: DockerCommandOptions): string {
  const {
    command,
    image,
    workdir = "/workspace",
    visibleDevices = "all",
    shmSize = "16G",
    volumes = [],
    envVars = [],
    name,
  } = options

  const escapedCmd = command.replace(/'/g, "'\\''")

  if (name) {
    const parts = ["docker exec"]
    if (workdir) parts.push(`-w ${shellQuote(workdir)}`)
    for (const entry of envVars) {
      parts.push(`-e ${shellQuote(entry)}`)
    }
    parts.push(`${shellQuote(name)} bash -c '${escapedCmd}'`)
    return parts.join(" ")
  }

  if (!image) {
    throw new Error("Docker image is required for docker run mode")
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
  ]

  for (const vol of volumes) parts.push(`-v ${shellQuote(vol)}`)
  for (const entry of envVars) parts.push(`-e ${shellQuote(entry)}`)
  parts.push(`${shellQuote(image)} bash -c '${escapedCmd}'`)

  return parts.join(" ")
}
