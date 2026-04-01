import { execLocal, execLocalDocker } from "./local-exec"
import { execRemote, execRemoteDocker, syncFiles } from "./ssh-client"
import type { ExecResult, ExecOptions, DockerExecArgs } from "./local-exec"
import type { SSHConfig, SyncArgs } from "./ssh-client"
import type { StateManager } from "./state-manager"

let stateManager: StateManager | null = null
let cachedMode: "local" | "remote" = "local"
let cachedRemoteConfig: SSHConfig | null = null

export function init(sm: StateManager): void {
  stateManager = sm
}

export async function refreshCache(): Promise<void> {
  if (!stateManager) {
    if (cachedMode === "remote") {
      throw new Error("StateManager not available while in remote mode.")
    }
    cachedMode = "local"
    cachedRemoteConfig = null
    return
  }

  const mode = await stateManager.getExecutionMode()
  if (mode === "remote") {
    const remoteConfig = await stateManager.getRemoteConfig()
    if (remoteConfig?.host && remoteConfig?.user) {
      cachedMode = "remote"
      cachedRemoteConfig = remoteConfig as SSHConfig
    } else {
      throw new Error("Execution mode is 'remote' but remote config is incomplete. Use musa_mode.")
    }
  } else {
    cachedMode = "local"
    cachedRemoteConfig = null
  }
}

export function getMode(): string { return cachedMode }
export function getRemoteConfig(): SSHConfig | null { return cachedRemoteConfig }
export function isRemoteReady(): boolean {
  return !!(cachedMode === "remote" && cachedRemoteConfig?.host && cachedRemoteConfig?.user)
}

/** @deprecated Use StateManager directly */
export function setMode(mode: "local" | "remote", config: SSHConfig | null = null): void {
  cachedMode = mode
  cachedRemoteConfig = config
}

async function ensureCacheSynced(): Promise<void> {
  if (stateManager) await refreshCache()
}

export async function execute(command: string, options: ExecOptions = {}): Promise<ExecResult> {
  await ensureCacheSynced()
  if (cachedMode === "remote") {
    if (!isRemoteReady()) throw new Error("Remote mode not configured. Use musa_mode.")
    return execRemote(cachedRemoteConfig!, command, options)
  }
  return execLocal(command, options)
}

export async function executeDocker(args: DockerExecArgs): Promise<ExecResult> {
  await ensureCacheSynced()
  if (cachedMode === "remote") {
    if (!isRemoteReady()) throw new Error("Remote mode not configured. Use musa_mode.")
    if (cachedRemoteConfig!.sudoPasswd && !args.sudoPasswd) {
      args.sudoPasswd = cachedRemoteConfig!.sudoPasswd
    }
    return execRemoteDocker(cachedRemoteConfig!, args)
  }
  return execLocalDocker(args)
}

export async function executeSync(args: SyncArgs): Promise<ExecResult> {
  await ensureCacheSynced()
  if (cachedMode === "local") {
    const src = args.direction === "push" ? args.localPath : args.remotePath
    const dst = args.direction === "push" ? args.remotePath : args.localPath
    return execLocal(`cp -r "${src}" "${dst}"`, { timeout: args.timeout })
  }
  if (!isRemoteReady()) throw new Error("Remote mode not configured. Use musa_mode.")
  return syncFiles(cachedRemoteConfig!, args)
}
