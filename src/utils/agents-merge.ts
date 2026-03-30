/**
 * AGENTS.md Merge Utilities
 *
 * @deprecated Use inject-manager.ts instead.
 * This module is kept for backwards compatibility and re-exports inject-manager functions.
 */

import * as fs from "fs"
import * as path from "path"
import {
  ensureAllInjected,
  uninjectAll,
  checkInjected,
  INJECT_SOURCES,
  normalizeContent,
  atomicWrite,
  withLockSync,
  checkBlockStatus as checkBlockStatusGeneric,
} from "./inject-manager"

// ============================================================================
// Constants
// ============================================================================

export const BLOCK_MARKERS = {
  begin: "<!-- AUTODEPLOY:BEGIN -->",
  end: "<!-- AUTODEPLOY:END -->",
}

const LOCK_CONFIG = {
  staleThreshold: 10000,
  maxWait: 5000,
  retryInterval: 100,
}

// ============================================================================
// Content Normalization
// ============================================================================

export { normalizeContent, atomicWrite, withLockSync }

// ============================================================================
// Block Status Check
// ============================================================================

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function checkBlockStatus(targetPath: string, sourceContent: string): { status: string } {
  return checkBlockStatusGeneric(targetPath, sourceContent, BLOCK_MARKERS)
}

export function checkStaticRules(workspacePath: string): boolean {
  const status = checkInjected(workspacePath)
  return status.agents || false
}

// ============================================================================
// Merge Operations
// ============================================================================

function wrapBlock(content: string): string {
  return `${BLOCK_MARKERS.begin}\n${content}\n${BLOCK_MARKERS.end}`
}

function appendBlock(existingContent: string, block: string): string {
  const normalized = existingContent.trimEnd()
  const separator = normalized ? "\n\n" : ""
  return normalized + separator + block + "\n"
}

function replaceBlock(existingContent: string, newBlock: string): string {
  const blockRegex = new RegExp(
    `\\n*${escapeRegex(BLOCK_MARKERS.begin)}[\\s\\S]*?${escapeRegex(BLOCK_MARKERS.end)}\\n*`,
    "m"
  )
  const cleaned = existingContent.replace(blockRegex, "\n").trimEnd()
  return appendBlock(cleaned, newBlock)
}

function doMerge(targetPath: string, sourceContent: string, statusResult: { status: string }): { status: string; reason?: string } {
  const wrappedBlock = wrapBlock(sourceContent)

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
    const newContent = replaceBlock(existing, wrappedBlock)
    atomicWrite(targetPath, newContent)
    return { status: "updated" }
  }

  return { status: "failed", reason: `Unknown status: ${statusResult.status}` }
}

/**
 * @deprecated Use ensureAllInjected from inject-manager instead
 */
export function ensureAgentsMerged(workspacePath: string, pluginDir: string): { status: string; reason?: string } {
  const injectDir = path.join(pluginDir, "inject")
  const results = ensureAllInjected(workspacePath, injectDir)
  return results.agents || { status: "failed", reason: "agents injection missing" }
}

/**
 * Legacy merge function for scripts/install.js compatibility
 */
export function mergeAgentsMd(workspacePath: string, pluginDir: string): boolean {
  const result = ensureAgentsMerged(workspacePath, pluginDir)
  return result.status !== "failed"
}

/**
 * Unmerge (remove) block from AGENTS.md
 */
export function unmergeAgentsMd(workspacePath: string): boolean {
  const targetPath = path.join(workspacePath, "AGENTS.md")

  if (!fs.existsSync(targetPath)) {
    return true
  }

  const existing = fs.readFileSync(targetPath, "utf-8")

  if (!existing.includes(BLOCK_MARKERS.begin)) {
    return true
  }

  const blockRegex = new RegExp(
    `\\n*${escapeRegex(BLOCK_MARKERS.begin)}[\\s\\S]*?${escapeRegex(BLOCK_MARKERS.end)}\\n*`,
    "m"
  )
  const cleaned = existing.replace(blockRegex, "\n").trim()

  atomicWrite(targetPath, cleaned)
  return true
}

// Re-exports from inject-manager
export { ensureAllInjected, uninjectAll, checkInjected, INJECT_SOURCES }
