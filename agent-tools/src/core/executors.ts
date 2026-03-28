import { Client } from "ssh2"
import * as fs from "fs"
import * as path from "path"
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

// ============================================================================
// SFTP File Sync Implementation
// ============================================================================

/**
 * SFTP error codes (from SSH2 library)
 */
const SFTP_STATUS_CODE = {
  OK: 0,
  EOF: 1,        // End of file
  NO_SUCH_FILE: 2,
  PERMISSION_DENIED: 3,
  FAILURE: 4,
  BAD_MESSAGE: 5,
  NO_CONNECTION: 6,
  CONNECTION_LOST: 7,
  OP_UNSUPPORTED: 8,
}

interface FileStats {
  path: string
  isDirectory: boolean
  size: number
  mtime: number  // Modification time (seconds since epoch)
}

interface SyncContext {
  isSingleFile: boolean    // True if source is a single file, not a directory
  sourceBasePath: string   // For single file: the file path itself; for dir: the directory
  sourceFileName: string   // For single file: the filename; for dir: ""
}

interface SyncProgress {
  filesTransferred: number
  filesSkipped: number     // Files skipped due to size/mtime match
  bytesTransferred: number
  currentFile: string
}

/**
 * Convert glob pattern to regex with proper escaping
 *
 * Supports:
 * - **  → matches any path segments (zero or more)
 * - *   → matches any characters except /
 * - ?   → matches exactly one character except /
 * - [abc] → character class (preserved as-is)
 * - {a,b} → brace expansion (basic support)
 *
 * All other regex special characters are escaped.
 */
function globToRegex(pattern: string): string {
  // First escape all regex special characters except glob wildcards
  let result = ""
  let i = 0

  while (i < pattern.length) {
    const char = pattern[i]

    // Handle ** (matches zero or more path segments)
    if (char === "*" && pattern[i + 1] === "*") {
      result += "(?:[^/]*(?:/[^/]*)*)?"
      i += 2
      continue
    }

    // Handle * (matches any chars except /)
    if (char === "*") {
      result += "[^/]*"
      i++
      continue
    }

    // Handle ? (matches exactly one char except /)
    if (char === "?") {
      result += "[^/]"
      i++
      continue
    }

    // Handle character class [...] (preserve as-is)
    if (char === "[") {
      const start = i
      let foundEnd = false
      i++ // skip opening [

      // Handle negation or range at start
      if (i < pattern.length && (pattern[i] === "!" || pattern[i] === "^")) {
        result += "[^"
        i++
      } else {
        result += "["
      }

      // Find closing bracket
      while (i < pattern.length && !foundEnd) {
        if (pattern[i] === "]" && i > start + 1) {
          result += "]"
          foundEnd = true
          i++
        } else {
          result += pattern[i]
          i++
        }
      }

      if (!foundEnd) {
        // No closing bracket, treat [ as literal
        result = result.slice(0, -1) + "\\["
      }
      continue
    }

    // Handle brace expansion {a,b,c} → (a|b|c)
    if (char === "{") {
      const braceContent = pattern.slice(i + 1)
      const closeIndex = braceContent.indexOf("}")
      if (closeIndex !== -1 && braceContent.includes(",")) {
        const options = braceContent.slice(0, closeIndex).split(",")
        result += "(" + options.map(o => globToRegex(o)).join("|") + ")"
        i += closeIndex + 2
        continue
      }
    }

    // Escape regex special characters
    if (["\\", ".", "+", "^", "$", "|", "(", ")", "{", "}"].includes(char)) {
      result += "\\" + char
    } else {
      result += char
    }
    i++
  }

  return result
}

/**
 * Check if a path matches any exclude pattern
 */
function matchesExclude(filePath: string, excludes: string[]): boolean {
  if (excludes.length === 0) return false

  const normalized = filePath.replace(/^\/+/, "")

  for (const pattern of excludes) {
    const regexStr = globToRegex(pattern)
    // Match: exact, prefix, suffix, or contains
    const regex = new RegExp(`^(?:${regexStr}|${regexStr}/|.*/${regexStr}|.*/${regexStr}/.*)$`)
    if (regex.test(normalized)) {
      return true
    }
  }

  return false
}

/**
 * Get SSH connection with SFTP channel
 */
function getSFTPConnection(
  config: SSHConfig,
  timeout: number
): Promise<{ conn: Client; sftp: any }> {
  return new Promise((resolve, reject) => {
    const conn = new Client()

    const timeoutTimer = setTimeout(() => {
      conn.end()
      reject(new Error(`Connection timeout after ${timeout} seconds`))
    }, timeout * 1000)

    conn
      .on("ready", () => {
        conn.sftp((err: any, sftp: any) => {
          clearTimeout(timeoutTimer)
          if (err) {
            conn.end()
            reject(err)
          } else {
            resolve({ conn, sftp })
          }
        })
      })
      .on("error", (err: any) => {
        clearTimeout(timeoutTimer)
        reject(err)
      })
      .connect({
        host: config.host,
        port: parseInt(config.port, 10),
        username: config.user,
        password: config.password,
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
      })
  })
}

/**
 * Get remote home directory via SSH
 * Used for proper ~ expansion
 */
async function getRemoteHomeDir(config: SSHConfig, timeout: number): Promise<string> {
  const result = await executeSSHCommand(config, "echo $HOME", timeout)
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    // Fallback to common default
    return `/home/${config.user}`
  }
  return result.stdout.trim()
}

/**
 * Expand ~ in remote path to actual home directory
 */
async function expandRemotePath(
  remotePath: string,
  config: SSHConfig,
  timeout: number
): Promise<string> {
  if (remotePath.startsWith("~/")) {
    const home = await getRemoteHomeDir(config, timeout)
    return home + remotePath.slice(1)
  }
  if (remotePath === "~") {
    return await getRemoteHomeDir(config, timeout)
  }
  return remotePath
}

/**
 * Analyze local source path to determine sync context
 */
async function analyzeLocalSource(sourcePath: string): Promise<SyncContext> {
  const stat = await fs.promises.stat(sourcePath)

  if (stat.isFile()) {
    return {
      isSingleFile: true,
      sourceBasePath: path.dirname(sourcePath),
      sourceFileName: path.basename(sourcePath),
    }
  }

  return {
    isSingleFile: false,
    sourceBasePath: sourcePath,
    sourceFileName: "",
  }
}

/**
 * Analyze remote source path to determine sync context
 */
async function analyzeRemoteSource(
  sftp: any,
  sourcePath: string
): Promise<{ context: SyncContext; error?: string }> {
  const stat = await new Promise<any>((resolve) => {
    sftp.stat(sourcePath, (err: any, stats: any) => {
      if (err) resolve(null)
      else resolve(stats)
    })
  })

  if (!stat) {
    return {
      context: { isSingleFile: false, sourceBasePath: sourcePath, sourceFileName: "" },
      error: `Remote path does not exist: ${sourcePath}`,
    }
  }

  if (stat.isFile()) {
    const parts = sourcePath.split("/")
    return {
      context: {
        isSingleFile: true,
        sourceBasePath: parts.slice(0, -1).join("/") || "/",
        sourceFileName: parts[parts.length - 1],
      },
      error: undefined,
    }
  }

  return {
    context: { isSingleFile: false, sourceBasePath: sourcePath, sourceFileName: "" },
    error: undefined,
  }
}

/**
 * List files recursively in a local directory
 * Returns relative paths from basePath
 */
async function listLocalFiles(
  basePath: string,
  excludes: string[],
  context?: SyncContext
): Promise<FileStats[]> {
  const results: FileStats[] = []

  // Handle single file case
  if (context?.isSingleFile) {
    const fullPath = path.join(context.sourceBasePath, context.sourceFileName)
    const stat = await fs.promises.stat(fullPath)
    return [{
      path: context.sourceFileName,
      isDirectory: false,
      size: stat.size,
      mtime: Math.floor(stat.mtimeMs / 1000),
    }]
  }

  async function walk(dir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relativePath = fullPath.slice(basePath.length).replace(/^[\/\\]+/, "")

      if (matchesExclude(relativePath, excludes)) {
        continue
      }

      if (entry.isDirectory()) {
        results.push({ path: relativePath, isDirectory: true, size: 0, mtime: 0 })
        await walk(fullPath)
      } else if (entry.isFile()) {
        const stat = await fs.promises.stat(fullPath)
        results.push({
          path: relativePath,
          isDirectory: false,
          size: stat.size,
          mtime: Math.floor(stat.mtimeMs / 1000),
        })
      }
    }
  }

  try {
    const baseStat = await fs.promises.stat(basePath)
    if (!baseStat.isDirectory()) {
      return [] // Not a directory, but not handled as single file
    }
  } catch {
    return [] // Path doesn't exist
  }

  await walk(basePath)
  return results
}

/**
 * Remote path read result with clear error semantics
 */
interface RemoteListResult {
  files: FileStats[]
  error?: string
  exists: boolean
}

/**
 * List files recursively in a remote directory via SFTP
 * Returns clear error semantics instead of disguising errors as empty
 */
async function listRemoteFiles(
  sftp: any,
  basePath: string,
  excludes: string[],
  context?: SyncContext
): Promise<RemoteListResult> {
  const results: FileStats[] = []

  // Handle single file case
  if (context?.isSingleFile) {
    const fullPath = path.posix.join(context.sourceBasePath, context.sourceFileName)
    const stat = await new Promise<any>((resolve) => {
      sftp.stat(fullPath, (err: any, stats: any) => {
        if (err) resolve(null)
        else resolve(stats)
      })
    })

    if (!stat) {
      return { files: [], error: `Remote file does not exist: ${fullPath}`, exists: false }
    }

    return {
      files: [{
        path: context.sourceFileName,
        isDirectory: false,
        size: stat.size,
        mtime: stat.mtime,
      }],
      error: undefined,
      exists: true,
    }
  }

  async function walk(dir: string): Promise<{ error?: string }> {
    return new Promise((resolve) => {
      sftp.readdir(dir, async (err: any, list: any[]) => {
        if (err) {
          // Distinguish error types
          if (err.code === SFTP_STATUS_CODE.NO_SUCH_FILE) {
            resolve({ error: undefined }) // Not an error, just empty
          } else if (err.code === SFTP_STATUS_CODE.PERMISSION_DENIED) {
            resolve({ error: `Permission denied reading ${dir}` })
          } else {
            resolve({ error: `Failed to read ${dir}: ${err.message}` })
          }
          return
        }

        // Process entries
        for (const entry of list) {
          const fullPath = path.posix.join(dir, entry.filename)
          const relativePath = fullPath.slice(basePath.length).replace(/^\/+/, "")

          if (matchesExclude(relativePath, excludes)) {
            continue
          }

          if (entry.attrs.isDirectory()) {
            results.push({ path: relativePath, isDirectory: true, size: 0, mtime: 0 })
            // Recursively walk subdirectory - MUST await
            const r = await walk(fullPath)
            if (r.error) {
              resolve({ error: r.error })
              return
            }
          } else if (entry.attrs.isFile()) {
            results.push({
              path: relativePath,
              isDirectory: false,
              size: entry.attrs.size,
              mtime: entry.attrs.mtime,
            })
          }
        }

        resolve({ error: undefined })
      })
    })
  }

  // Check base path exists
  const baseStat = await new Promise<any>((resolve) => {
    sftp.stat(basePath, (err: any, stats: any) => {
      if (err) resolve(null)
      else resolve(stats)
    })
  })

  if (!baseStat) {
    return { files: [], error: `Remote path does not exist: ${basePath}`, exists: false }
  }

  if (baseStat.isFile()) {
    // Path is a file but not handled as single file
    return {
      files: [{
        path: path.basename(basePath),
        isDirectory: false,
        size: baseStat.size,
        mtime: baseStat.mtime,
      }],
      error: undefined,
      exists: true,
    }
  }

  // Walk the directory
  const walkResult = await walk(basePath)

  return {
    files: results,
    error: walkResult.error,
    exists: true,
  }
}

/**
 * Check if remote directory exists
 */
async function remoteDirExists(sftp: any, remotePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    sftp.stat(remotePath, (err: any, stats: any) => {
      if (err) resolve(false)
      else resolve(stats.isDirectory())
    })
  })
}

/**
 * Ensure remote directory exists (create recursively)
 *
 * Proper error handling:
 * 1. First check if directory exists via stat
 * 2. If not, try mkdir
 * 3. If mkdir fails, verify directory actually exists (may have been created concurrently)
 * 4. Only throw on genuine failures
 */
async function ensureRemoteDir(sftp: any, remotePath: string): Promise<{ error?: string }> {
  // Already exists and is a directory
  if (await remoteDirExists(sftp, remotePath)) {
    return { error: undefined }
  }

  const parts = remotePath.split("/").filter(Boolean)
  let current = remotePath.startsWith("/") ? "" : "/"

  for (const part of parts) {
    current += "/" + part

    const exists = await remoteDirExists(sftp, current)
    if (exists) continue

    // Try to create
    const mkdirResult = await new Promise<{ code: number; message: string }>((resolve) => {
      sftp.mkdir(current, (err: any) => {
        if (err) {
          resolve({ code: err.code || SFTP_STATUS_CODE.FAILURE, message: err.message })
        } else {
          resolve({ code: SFTP_STATUS_CODE.OK, message: "" })
        }
      })
    })

    if (mkdirResult.code !== SFTP_STATUS_CODE.OK) {
      // Verify it actually exists (concurrent creation case)
      const nowExists = await remoteDirExists(sftp, current)
      if (!nowExists) {
        // Genuine failure
        if (mkdirResult.code === SFTP_STATUS_CODE.PERMISSION_DENIED) {
          return { error: `Permission denied creating directory ${current}` }
        }
        return { error: `Failed to create directory ${current}: ${mkdirResult.message}` }
      }
    }
  }

  return { error: undefined }
}

/**
 * Ensure local directory exists (create recursively)
 */
async function ensureLocalDir(localPath: string): Promise<void> {
  await fs.promises.mkdir(localPath, { recursive: true })
}

/**
 * Check if file needs transfer based on size and mtime
 *
 * Returns true if:
 * - Target file doesn't exist
 * - Size differs
 * - Source mtime is newer than target mtime
 */
async function needsTransfer(
  sftp: any,
  sourceFile: FileStats,
  targetBasePath: string,
  direction: "push" | "pull"
): Promise<boolean> {
  const targetPath = path.posix.join(targetBasePath, sourceFile.path)

  // Get target stats
  if (direction === "push") {
    // Check remote target
    const targetStat = await new Promise<any>((resolve) => {
      sftp.stat(targetPath, (err: any, stats: any) => {
        if (err) resolve(null)
        else resolve(stats)
      })
    })

    if (!targetStat) return true // Target doesn't exist
    if (targetStat.size !== sourceFile.size) return true // Size differs
    if (sourceFile.mtime > targetStat.mtime) return true // Source is newer

    return false
  } else {
    // Check local target
    try {
      const targetStat = await fs.promises.stat(targetPath)
      if (targetStat.size !== sourceFile.size) return true
      if (sourceFile.mtime > Math.floor(targetStat.mtimeMs / 1000)) return true
      return false
    } catch {
      return true // Target doesn't exist
    }
  }
}

/**
 * Upload a single file via SFTP fastPut
 *
 * TODO: 断点续传支持 - 当前使用 fastPut 一次性传输，大文件失败需重新开始
 * 未来扩展：改用 createReadStream/createWriteStream 配合 start/end 偏移量
 * 实现步骤：
 * 1. 检查远程文件是否存在及大小
 * 2. 从本地文件偏移量 = 远程文件大小 处开始传输
 * 3. 使用 sftp.createWriteStream(remotePath, { start: remoteSize })
 * 4. 记录传输进度到 state.json 以便恢复
 */
async function uploadFile(
  sftp: any,
  localBase: string,
  remoteBase: string,
  relativePath: string
): Promise<number> {
  const localPath = path.join(localBase, relativePath)
  const remotePath = path.posix.join(remoteBase, relativePath)

  // Ensure parent directory exists on remote
  const parentDir = path.posix.dirname(remotePath)
  if (parentDir && parentDir !== "/" && parentDir !== remoteBase) {
    const result = await ensureRemoteDir(sftp, parentDir)
    if (result.error) {
      throw new Error(result.error)
    }
  }

  const stat = await fs.promises.stat(localPath)

  return new Promise<number>((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (err: any) => {
      if (err) reject(err)
      else resolve(stat.size)
    })
  })
}

/**
 * Download a single file via SFTP fastGet
 */
async function downloadFile(
  sftp: any,
  remoteBase: string,
  localBase: string,
  relativePath: string
): Promise<number> {
  const remotePath = path.posix.join(remoteBase, relativePath)
  const localPath = path.join(localBase, relativePath)

  // Ensure parent directory exists locally
  const parentDir = path.dirname(localPath)
  if (parentDir && parentDir !== localBase) {
    await ensureLocalDir(parentDir)
  }

  // Get file size from remote
  const stat = await new Promise<any>((resolve, reject) => {
    sftp.stat(remotePath, (err: any, stats: any) => {
      if (err) reject(err)
      else resolve(stats)
    })
  })

  return new Promise<number>((resolve, reject) => {
    sftp.fastGet(remotePath, localPath, (err: any) => {
      if (err) reject(err)
      else resolve(stat.size)
    })
  })
}

/**
 * Delete extra files on remote (for push with --delete)
 */
async function deleteRemoteExtra(
  sftp: any,
  remoteBase: string,
  sourcePaths: Set<string>,
  targetFiles: FileStats[]
): Promise<{ deleted: number; errors: string[] }> {
  // Sort by path depth descending (delete files before parent directories)
  const toDelete = targetFiles
    .filter(f => !sourcePaths.has(f.path))
    .sort((a, b) => b.path.split("/").length - a.path.split("/").length)

  const errors: string[] = []
  let deleted = 0

  for (const file of toDelete) {
    const remotePath = path.posix.join(remoteBase, file.path)

    const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      if (file.isDirectory) {
        sftp.rmdir(remotePath, (err: any) => {
          if (err) {
            if (err.code === SFTP_STATUS_CODE.FAILURE) {
              // Directory not empty - this is expected if we're deleting in wrong order
              resolve({ success: false, error: `Directory not empty: ${remotePath}` })
            } else {
              resolve({ success: false, error: `Failed to delete ${remotePath}: ${err.message}` })
            }
          } else {
            resolve({ success: true })
          }
        })
      } else {
        sftp.unlink(remotePath, (err: any) => {
          if (err) {
            resolve({ success: false, error: `Failed to delete ${remotePath}: ${err.message}` })
          } else {
            resolve({ success: true })
          }
        })
      }
    })

    if (result.success) {
      deleted++
    } else if (result.error) {
      errors.push(result.error)
    }
  }

  return { deleted, errors }
}

/**
 * Delete extra files on local (for pull with --delete)
 */
async function deleteLocalExtra(
  localBase: string,
  sourcePaths: Set<string>,
  targetFiles: FileStats[]
): Promise<{ deleted: number; errors: string[] }> {
  // Sort by path depth descending
  const toDelete = targetFiles
    .filter(f => !sourcePaths.has(f.path))
    .sort((a, b) => b.path.split("/").length - a.path.split("/").length)

  const errors: string[] = []
  let deleted = 0

  for (const file of toDelete) {
    const localPath = path.join(localBase, file.path)
    try {
      if (file.isDirectory) {
        await fs.promises.rmdir(localPath)
      } else {
        await fs.promises.unlink(localPath)
      }
      deleted++
    } catch (err: any) {
      errors.push(`Failed to delete ${localPath}: ${err.message}`)
    }
  }

  return { deleted, errors }
}

/**
 * Sync files between local machine and remote host via SFTP
 *
 * Replaces the previous rsync-based implementation with pure ssh2/SFTP,
 * eliminating the need for sshpass and enabling reliable password authentication.
 *
 * Features:
 * - Push/pull direction support
 * - Single file and directory sync
 * - Exclude patterns (glob-style)
 * - Delete extra files on target
 * - Skip files with same size and mtime
 * - Proper ~ home expansion
 * - Overall timeout control
 */
export async function syncFiles(
  config: SSHConfig,
  args: SyncArgs
): Promise<SyncResult> {
  const direction = args.direction || "push"
  const excludes = args.exclude || []
  const overallTimeout = args.timeout || 600  // Total sync timeout
  const connectionTimeout = 30  // Connection timeout

  // Track start time for overall timeout
  const startTime = Date.now()
  const deadline = startTime + overallTimeout * 1000

  // Helper to check timeout
  const checkTimeout = () => {
    if (Date.now() > deadline) {
      throw new Error(`Sync timeout after ${overallTimeout} seconds`)
    }
  }

  // Log execution start
  logger.log("remote-sync", "sftp-start", {
    timeout: overallTimeout,
    localPath: args.localPath,
    remotePath: args.remotePath,
    direction,
    delete: args.delete,
    excludes,
  })

  let stdout = ""
  let stderr = ""
  let exitCode = 0

  try {
    // Resolve local path
    const localPath = path.resolve(args.localPath)

    // Expand remote path (~ → actual home directory)
    const remotePath = await expandRemotePath(args.remotePath, config, connectionTimeout)

    // Get SFTP connection
    const { conn, sftp } = await getSFTPConnection(config, connectionTimeout)

    try {
      const progress: SyncProgress = {
        filesTransferred: 0,
        filesSkipped: 0,
        bytesTransferred: 0,
        currentFile: "",
      }

      if (direction === "push") {
        // Push: local → remote

        // Check local source exists
        const localStat = await fs.promises.stat(localPath).catch(() => null)
        if (!localStat) {
          return {
            stdout: "",
            stderr: `Local path does not exist: ${localPath}`,
            exitCode: 1,
          }
        }

        // Analyze source context (single file vs directory)
        const sourceContext = await analyzeLocalSource(localPath)

        // Determine target path
        // For single file: remotePath is the target file path or target directory
        let targetBasePath: string

        if (sourceContext.isSingleFile) {
          // Check if remotePath is a directory or target file
          const remoteStat = await new Promise<any>((resolve) => {
            sftp.stat(remotePath, (err: any, stats: any) => {
              if (err) resolve(null)
              else resolve(stats)
            })
          })

          if (remoteStat?.isDirectory()) {
            // remotePath is an existing directory, put file inside
            targetBasePath = remotePath
          } else {
            // remotePath is target file path
            targetBasePath = path.posix.dirname(remotePath)
          }
        } else {
          targetBasePath = remotePath
        }

        // List source files
        checkTimeout()
        const sourceFiles = await listLocalFiles(
          sourceContext.isSingleFile ? localPath : localPath,
          excludes,
          sourceContext
        )
        const sourcePaths = new Set(sourceFiles.map(f => f.path))
        const sourceFilesOnly = sourceFiles.filter(f => !f.isDirectory)

        // Create target directory if needed
        checkTimeout()
        const dirResult = await ensureRemoteDir(sftp, targetBasePath)
        if (dirResult.error) {
          return {
            stdout: "",
            stderr: dirResult.error,
            exitCode: 1,
          }
        }

        // Delete extra files on target if requested
        if (args.delete && !sourceContext.isSingleFile) {
          checkTimeout()
          const targetFilesResult = await listRemoteFiles(sftp, targetBasePath, excludes)
          if (targetFilesResult.error) {
            // Only warn, don't fail
            stderr += `Warning: ${targetFilesResult.error}\n`
          } else {
            const deleteResult = await deleteRemoteExtra(
              sftp, targetBasePath, sourcePaths, targetFilesResult.files
            )
            stdout += `Deleted ${deleteResult.deleted} extra files on remote\n`
            for (const err of deleteResult.errors) {
              stderr += `Warning: ${err}\n`
            }
          }
        }

        // Transfer files (with skip logic)
        const uploadBasePath = sourceContext.isSingleFile
          ? sourceContext.sourceBasePath
          : localPath

        for (const file of sourceFilesOnly) {
          checkTimeout()
          progress.currentFile = file.path

          const shouldTransfer = await needsTransfer(sftp, file, targetBasePath, "push")

          if (!shouldTransfer) {
            progress.filesSkipped++
            stdout += `skipped ${file.path} (same size/mtime)\n`
            continue
          }

          const bytes = await uploadFile(sftp, uploadBasePath, targetBasePath, file.path)
          progress.filesTransferred++
          progress.bytesTransferred += bytes
          stdout += `sent ${file.path} (${bytes} bytes)\n`
        }

        stdout += `\nTotal: ${progress.filesTransferred} files transferred, ${progress.filesSkipped} skipped, ${progress.bytesTransferred} bytes\n`

      } else {
        // Pull: remote → local

        // Analyze remote source
        checkTimeout()
        const sourceResult = await analyzeRemoteSource(sftp, remotePath)

        if (sourceResult.error) {
          return {
            stdout: "",
            stderr: sourceResult.error,
            exitCode: 1,
          }
        }

        const sourceContext = sourceResult.context

        // Determine target path
        let targetBasePath: string

        if (sourceContext.isSingleFile) {
          // Check if localPath is a directory or target file
          const localStat = await fs.promises.stat(localPath).catch(() => null)

          if (localStat?.isDirectory()) {
            // localPath is an existing directory, put file inside
            targetBasePath = localPath
          } else {
            // localPath is target file path
            targetBasePath = path.dirname(localPath)
          }
        } else {
          targetBasePath = localPath
        }

        // List source files on remote
        checkTimeout()
        const sourceFilesResult = await listRemoteFiles(
          sftp,
          sourceContext.isSingleFile ? remotePath : remotePath,
          excludes,
          sourceContext
        )

        if (sourceFilesResult.error) {
          return {
            stdout: "",
            stderr: sourceFilesResult.error,
            exitCode: 1,
          }
        }

        if (sourceFilesResult.files.length === 0) {
          return {
            stdout: "",
            stderr: `Remote path is empty: ${remotePath}`,
            exitCode: 1,
          }
        }

        const sourceFiles = sourceFilesResult.files
        const sourcePaths = new Set(sourceFiles.map(f => f.path))
        const sourceFilesOnly = sourceFiles.filter(f => !f.isDirectory)

        // Create local target directory
        checkTimeout()
        await ensureLocalDir(targetBasePath)

        // Delete extra files locally if requested
        if (args.delete && !sourceContext.isSingleFile) {
          checkTimeout()
          const targetFiles = await listLocalFiles(targetBasePath, excludes)
          const deleteResult = await deleteLocalExtra(targetBasePath, sourcePaths, targetFiles)
          stdout += `Deleted ${deleteResult.deleted} extra files locally\n`
          for (const err of deleteResult.errors) {
            stderr += `Warning: ${err}\n`
          }
        }

        // Transfer files (with skip logic)
        for (const file of sourceFilesOnly) {
          checkTimeout()
          progress.currentFile = file.path

          const shouldTransfer = await needsTransfer(sftp, file, targetBasePath, "pull")

          if (!shouldTransfer) {
            progress.filesSkipped++
            stdout += `skipped ${file.path} (same size/mtime)\n`
            continue
          }

          const bytes = await downloadFile(sftp, remotePath, targetBasePath, file.path)
          progress.filesTransferred++
          progress.bytesTransferred += bytes
          stdout += `received ${file.path} (${bytes} bytes)\n`
        }

        stdout += `\nTotal: ${progress.filesTransferred} files transferred, ${progress.filesSkipped} skipped, ${progress.bytesTransferred} bytes\n`
      }

      // Log completion
      logger.log("remote-sync", "sftp-complete", {
        filesTransferred: progress.filesTransferred,
        filesSkipped: progress.filesSkipped,
        bytesTransferred: progress.bytesTransferred,
        durationMs: Date.now() - startTime,
      })

    } finally {
      conn.end()
    }

  } catch (error: any) {
    stderr = `SFTP sync failed: ${error.message}`
    exitCode = 1

    logger.log("remote-sync", "sftp-error", {
      error: error.message,
      direction,
      durationMs: Date.now() - startTime,
    })
  }

  return { stdout, stderr, exitCode }
}

/**
 * Format output for display
 */
export { formatOutput, truncateOutput }