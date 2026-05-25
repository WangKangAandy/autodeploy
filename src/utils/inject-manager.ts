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

type InjectMode = "block" | "wholeFile"

interface InjectSource {
  key: string
  sourceFile: string
  targetFile: string
  mode: InjectMode
  markers?: BlockMarkers  // required for "block" mode
  required: boolean
}

interface InjectResult {
  status: "up_to_date" | "installed" | "updated" | "skipped" | "failed"
  reason?: string
}

export interface BootstrapRemovalResult {
  status: "removed" | "absent" | "failed"
  reason?: string
}

export interface AgentsScaffoldPatchResult {
  status: "updated" | "up_to_date" | "skipped"
  reason?: string
}

export const BOOTSTRAP_FILENAME = "BOOTSTRAP.md"

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
    mode: "block",
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
    // Overwrite entire IDENTITY.md so OpenClaw scaffold placeholders cannot
    // outrank MUSA-Claw in bootstrap / system-prompt context.
    mode: "wholeFile",
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

/**
 * Whole-file injection: create or overwrite the target file entirely.
 * - If target doesn't exist → create it
 * - If target exists with same content → skip (up_to_date)
 * - If target exists with different content → overwrite (updated)
 */
function injectWholeFile(targetPath: string, sourceContent: string): InjectResult {
  if (!fs.existsSync(targetPath)) {
    atomicWrite(targetPath, sourceContent)
    return { status: "installed" }
  }

  const existing = fs.readFileSync(targetPath, "utf-8")
  if (normalizeContent(existing) === normalizeContent(sourceContent)) {
    return { status: "up_to_date" }
  }

  atomicWrite(targetPath, sourceContent)
  return { status: "updated" }
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
      // Whole-file mode: simple create/overwrite
      if (source.mode === "wholeFile") {
        return injectWholeFile(targetPath, sourceContent)
      }

      // Block mode: merge into existing file
      const statusResult = checkBlockStatus(targetPath, sourceContent, source.markers!)

      if (statusResult.status === "up_to_date") {
        return { status: "up_to_date" as const }
      }

      return doInject(targetPath, sourceContent, statusResult, source.markers!)
    }) as InjectResult
  } catch (err: any) {
    return { status: "failed", reason: err.message }
  }
}

/** OpenClaw default AGENTS.md First Run (BOOTSTRAP onboarding). */
const AGENTS_SCAFFOLD_FIRST_RUN_OLD =
  /## First Run\r?\n\r?\nIf `BOOTSTRAP\.md` exists, that's your birth certificate\. Follow it, figure out who you are, then delete it\. You won't need it again\./

const AGENTS_SCAFFOLD_FIRST_RUN_NEW = `## First Run

Identity is in \`IDENTITY.md\`. This workspace does not use \`BOOTSTRAP.md\`.`

const AGENTS_SCAFFOLD_STARTUP_LIST_OLD = /- `AGENTS\.md`, `SOUL\.md`, and `USER\.md`/
const AGENTS_SCAFFOLD_STARTUP_LIST_NEW =
  "- `IDENTITY.md`, `AGENTS.md`, `SOUL.md`, and `USER.md`"

/**
 * Patch native OpenClaw AGENTS.md scaffold once: BOOTSTRAP First Run → IDENTITY-based, add IDENTITY to startup list.
 */
export function patchAgentsWorkspaceScaffold(workspacePath: string): AgentsScaffoldPatchResult {
  const agentsPath = path.join(workspacePath, "AGENTS.md")
  if (!fs.existsSync(agentsPath)) {
    return { status: "skipped", reason: "AGENTS.md not found" }
  }

  const original = fs.readFileSync(agentsPath, "utf-8")
  let content = original
  const hasBootstrapFirstRun = AGENTS_SCAFFOLD_FIRST_RUN_OLD.test(content)
  const needsIdentityInList = AGENTS_SCAFFOLD_STARTUP_LIST_OLD.test(content)

  if (!hasBootstrapFirstRun && !needsIdentityInList) {
    return { status: "up_to_date" }
  }

  if (hasBootstrapFirstRun) {
    content = content.replace(AGENTS_SCAFFOLD_FIRST_RUN_OLD, AGENTS_SCAFFOLD_FIRST_RUN_NEW)
  }
  if (needsIdentityInList) {
    content = content.replace(AGENTS_SCAFFOLD_STARTUP_LIST_OLD, AGENTS_SCAFFOLD_STARTUP_LIST_NEW)
  }

  if (content === original) {
    return { status: "up_to_date" }
  }

  atomicWrite(agentsPath, content)
  return { status: "updated" }
}

/** Delete BOOTSTRAP.md so OpenClaw skips bootstrap-pending (identity is in IDENTITY.md). */
export function removeBootstrapFile(workspacePath: string): BootstrapRemovalResult {
  const targetPath = path.join(workspacePath, BOOTSTRAP_FILENAME)
  if (!fs.existsSync(targetPath)) {
    return { status: "absent" }
  }
  try {
    fs.unlinkSync(targetPath)
    return { status: "removed" }
  } catch (err: any) {
    return { status: "failed", reason: err.message }
  }
}

export function ensureAllInjected(
  workspacePath: string,
  injectDir: string
): Record<string, InjectResult | BootstrapRemovalResult | AgentsScaffoldPatchResult> {
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true })
  }

  const results: Record<string, InjectResult | BootstrapRemovalResult | AgentsScaffoldPatchResult> =
    {}

  for (const source of INJECT_SOURCES) {
    results[source.key] = injectSource(workspacePath, injectDir, source)
  }

  results.agentsScaffold = patchAgentsWorkspaceScaffold(workspacePath)
  results.bootstrapCleanup = removeBootstrapFile(workspacePath)

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

    // Whole-file mode: delete the entire file
    if (source.mode === "wholeFile") {
      fs.unlinkSync(targetPath)
      results[source.key] = { status: "removed" }
      continue
    }

    // Block mode: remove the block from the file
    const existing = fs.readFileSync(targetPath, "utf-8")

    if (!source.markers || !existing.includes(source.markers.begin)) {
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

    // Whole-file mode: file exists = injected
    if (source.mode === "wholeFile") {
      status[source.key] = true
      continue
    }

    // Block mode: check for marker presence
    const content = fs.readFileSync(targetPath, "utf-8")
    status[source.key] = !!source.markers && content.includes(source.markers.begin)
  }

  return status
}
