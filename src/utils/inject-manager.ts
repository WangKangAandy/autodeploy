/**
 * Inject Manager - Declarative Document Injection
 *
 * Manages block merge of multiple source files into OpenClaw workspace targets.
 * Uses a declarative source list + idempotent merge logic.
 */

import * as fs from "fs"
import * as path from "path"

// ============================================================================
// Types
// ============================================================================

interface BlockMarkers {
  begin: string
  end: string
}

interface InjectSource {
  key: string
  sourceFile: string
  targetFile: string
  markers: BlockMarkers
  required: boolean
}

interface InjectResult {
  status: "up_to_date" | "installed" | "updated" | "skipped" | "failed"
  reason?: string
}

interface BlockStatus {
  status: "up_to_date" | "missing_file" | "missing_block" | "outdated"
}

interface LockResult {
  status: "failed"
  reason: string
}

// ============================================================================
// Declarative Injection Sources
// ============================================================================

export const INJECT_SOURCES: InjectSource[] = [
  {
    key: "agents",
    sourceFile: "AGENTS.autodeploy.md",
    targetFile: "AGENTS.md",
    markers: {
      begin: "<!-- AUTODEPLOY:BEGIN -->",
      end: "<!-- AUTODEPLOY:END -->",
    },
    required: true,
  },
  {
    key: "identity",
    sourceFile: "IDENTITY.autodeploy.md",
    targetFile: "IDENTITY.md",
    markers: {
      begin: "<!-- AUTODEPLOY:IDENTITY:BEGIN -->",
      end: "<!-- AUTODEPLOY:IDENTITY:END -->",
    },
    required: true,
  },
]

// ============================================================================
// Constants
// ============================================================================

const LOCK_CONFIG = {
  staleThreshold: 10000,
  maxWait: 5000,
  retryInterval: 100,
}

// ============================================================================
// Content Utilities
// ============================================================================

export function normalizeContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function atomicWrite(filePath: string, content: string): void {
  const tmpPath = filePath + ".tmp"
  fs.writeFileSync(tmpPath, content, "utf8")
  fs.renameSync(tmpPath, filePath)
}

// ============================================================================
// Lock Management
// ============================================================================

export function withLockSync<T>(lockPath: string, fn: () => T): T | LockResult {
  const startTime = Date.now()

  while (Date.now() - startTime < LOCK_CONFIG.maxWait) {
    try {
      const fd = fs.openSync(lockPath, "wx")
      try {
        const lockInfo = JSON.stringify({
          pid: process.pid,
          timestamp: Date.now(),
        })
        fs.writeSync(fd, lockInfo)
        fs.fsyncSync(fd)
        return fn()
      } finally {
        fs.closeSync(fd)
        try {
          fs.unlinkSync(lockPath)
        } catch {
          // Ignore cleanup failure
        }
      }
    } catch (err: any) {
      if (err.code === "EEXIST") {
        try {
          const lockContent = fs.readFileSync(lockPath, "utf-8")
          const lockInfo = JSON.parse(lockContent)
          const lockAge = Date.now() - lockInfo.timestamp

          if (lockAge > LOCK_CONFIG.staleThreshold) {
            fs.unlinkSync(lockPath)
            continue
          }
        } catch {
          try {
            fs.unlinkSync(lockPath)
          } catch {
            // Ignore
          }
          continue
        }

        const elapsed = Date.now() - startTime
        if (elapsed >= LOCK_CONFIG.maxWait) {
          return { status: "failed", reason: "Lock acquisition timeout" }
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_CONFIG.retryInterval)
        continue
      }
      return { status: "failed", reason: `Lock error: ${err.message}` }
    }
  }
  return { status: "failed", reason: "Lock acquisition timeout" }
}

// ============================================================================
// Block Operations
// ============================================================================

function wrapBlock(content: string, markers: BlockMarkers): string {
  return `${markers.begin}\n${content}\n${markers.end}`
}

function appendBlock(existingContent: string, block: string): string {
  const normalized = existingContent.trimEnd()
  const separator = normalized ? "\n\n" : ""
  return normalized + separator + block + "\n"
}

function replaceBlock(existingContent: string, block: string, markers: BlockMarkers): string {
  const blockRegex = new RegExp(
    `\\n*${escapeRegex(markers.begin)}[\\s\\S]*?${escapeRegex(markers.end)}\\n*`,
    "m"
  )
  const cleaned = existingContent.replace(blockRegex, "\n").trimEnd()
  return appendBlock(cleaned, block)
}

export function checkBlockStatus(targetPath: string, sourceContent: string, markers: BlockMarkers): BlockStatus {
  if (!fs.existsSync(targetPath)) {
    return { status: "missing_file" }
  }

  const existing = fs.readFileSync(targetPath, "utf-8")
  const blockRegex = new RegExp(
    `${escapeRegex(markers.begin)}([\\s\\S]*?)${escapeRegex(markers.end)}`,
    "m"
  )
  const blockMatch = existing.match(blockRegex)

  if (!blockMatch) {
    return { status: "missing_block" }
  }

  const existingBlock = normalizeContent(blockMatch[1])
  const sourceBlock = normalizeContent(sourceContent)

  if (existingBlock === sourceBlock) {
    return { status: "up_to_date" }
  }

  return { status: "outdated" }
}

// ============================================================================
// Injection Operations
// ============================================================================

function doInject(targetPath: string, sourceContent: string, statusResult: BlockStatus, markers: BlockMarkers): InjectResult {
  const wrappedBlock = wrapBlock(sourceContent, markers)

  if (statusResult.status === "missing_file") {
    atomicWrite(targetPath, wrappedBlock + "\n")
    return { status: "installed" }
  }

  if (statusResult.status === "missing_block") {
    const existing = fs.readFileSync(targetPath, "utf-8")
    const newContent = appendBlock(existing, wrappedBlock)
    atomicWrite(targetPath, newContent)
    return { status: "installed" }
  }

  if (statusResult.status === "outdated") {
    const existing = fs.readFileSync(targetPath, "utf-8")
    const newContent = replaceBlock(existing, wrappedBlock, markers)
    atomicWrite(targetPath, newContent)
    return { status: "updated" }
  }

  return { status: "up_to_date" }
}

function injectSource(workspacePath: string, injectDir: string, source: InjectSource): InjectResult {
  try {
    const sourcePath = path.join(injectDir, source.sourceFile)
    const targetPath = path.join(workspacePath, source.targetFile)
    const lockPath = path.join(workspacePath, `.inject.${source.key}.lock`)

    if (!fs.existsSync(sourcePath)) {
      if (source.required) {
        return { status: "failed", reason: `Required source file not found: ${source.sourceFile}` }
      }
      return { status: "skipped", reason: `Optional source file not found: ${source.sourceFile}` }
    }

    const sourceContent = fs.readFileSync(sourcePath, "utf-8")

    return withLockSync(lockPath, () => {
      const statusResult = checkBlockStatus(targetPath, sourceContent, source.markers)

      if (statusResult.status === "up_to_date") {
        return { status: "up_to_date" as const }
      }

      return doInject(targetPath, sourceContent, statusResult, source.markers)
    }) as InjectResult
  } catch (err: any) {
    return { status: "failed", reason: err.message }
  }
}

export function ensureAllInjected(workspacePath: string, injectDir: string): Record<string, InjectResult> {
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true })
  }

  const results: Record<string, InjectResult> = {}

  for (const source of INJECT_SOURCES) {
    results[source.key] = injectSource(workspacePath, injectDir, source)
  }

  return results
}

export function uninjectAll(workspacePath: string): Record<string, { status: string; reason?: string }> {
  const results: Record<string, { status: string; reason?: string }> = {}

  for (const source of INJECT_SOURCES) {
    const targetPath = path.join(workspacePath, source.targetFile)

    if (!fs.existsSync(targetPath)) {
      results[source.key] = { status: "skipped", reason: "Target file not found" }
      continue
    }

    const existing = fs.readFileSync(targetPath, "utf-8")

    if (!existing.includes(source.markers.begin)) {
      results[source.key] = { status: "skipped", reason: "Block not found" }
      continue
    }

    const blockRegex = new RegExp(
      `\\n*${escapeRegex(source.markers.begin)}[\\s\\S]*?${escapeRegex(source.markers.end)}\\n*`,
      "m"
    )
    const cleaned = existing.replace(blockRegex, "\n").trim()

    atomicWrite(targetPath, cleaned)
    results[source.key] = { status: "removed" }
  }

  return results
}

export function checkInjected(workspacePath: string): Record<string, boolean> {
  const status: Record<string, boolean> = {}

  for (const source of INJECT_SOURCES) {
    const targetPath = path.join(workspacePath, source.targetFile)
    if (!fs.existsSync(targetPath)) {
      status[source.key] = false
      continue
    }
    const content = fs.readFileSync(targetPath, "utf-8")
    status[source.key] = content.includes(source.markers.begin)
  }

  return status
}
