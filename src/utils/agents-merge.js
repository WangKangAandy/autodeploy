/**
 * AGENTS.md Merge Utilities
 *
 * Handles block merge of AGENTS.autodeploy.md into workspace AGENTS.md.
 * Supports install, upgrade, and idempotent scenarios.
 *
 * Design principles:
 * - All functions are synchronous (for register() context)
 * - Never throw exceptions - return { status: "failed", reason } instead
 * - Atomic write with temp file + rename
 * - Concurrent-safe with file lock + stale detection
 */

const fs = require("fs");
const path = require("path");

// ============================================================================
// Constants
// ============================================================================

const BLOCK_MARKERS = {
  begin: "<!-- AUTODEPLOY:BEGIN -->",
  end: "<!-- AUTODEPLOY:END -->",
};

const LOCK_CONFIG = {
  staleThreshold: 10000,  // 10 seconds - locks older than this are stale
  maxWait: 5000,          // Max wait time for lock acquisition
  retryInterval: 100,     // Retry interval in ms
};

// ============================================================================
// Content Normalization
// ============================================================================

/**
 * Normalize content for comparison
 * - Unified newlines to \n
 * - Remove leading/trailing whitespace (for block comparison)
 */
function normalizeContent(content) {
  return content
    .replace(/\r\n/g, "\n")  // CRLF → LF
    .replace(/\r/g, "\n")    // CR → LF
    .trim();                  // Remove both leading and trailing whitespace
}

// ============================================================================
// Block Status Check
// ============================================================================

/**
 * Check block status in target file
 *
 * @returns {object} { status: "up_to_date" | "missing_file" | "missing_block" | "outdated" }
 */
function checkBlockStatus(targetPath, sourceContent) {
  // Target file does not exist
  if (!fs.existsSync(targetPath)) {
    return { status: "missing_file" };
  }

  const existing = fs.readFileSync(targetPath, "utf-8");
  const blockRegex = new RegExp(
    `${escapeRegex(BLOCK_MARKERS.begin)}([\\s\\S]*?)${escapeRegex(BLOCK_MARKERS.end)}`,
    "m"
  );
  const blockMatch = existing.match(blockRegex);

  if (!blockMatch) {
    return { status: "missing_block" };
  }

  const existingBlock = normalizeContent(blockMatch[1]);
  const sourceBlock = normalizeContent(sourceContent);

  if (existingBlock === sourceBlock) {
    return { status: "up_to_date" };
  }

  return { status: "outdated" };
}

/**
 * Check if static rules exist in AGENTS.md
 */
function checkStaticRules(workspacePath) {
  const agentsPath = path.join(workspacePath, "AGENTS.md");
  if (!fs.existsSync(agentsPath)) {
    return false;
  }
  const content = fs.readFileSync(agentsPath, "utf-8");
  return content.includes(BLOCK_MARKERS.begin);
}

// ============================================================================
// Lock Management
// ============================================================================

/**
 * Escape special regex characters
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Synchronous file lock with stale detection
 * - Writes pid + timestamp to lock file
 * - Automatically cleans up stale locks (>10s old)
 * - Never throws - returns { status: "failed" } on error
 *
 * @param {string} lockPath - Path to lock file
 * @param {function} fn - Function to execute under lock
 * @returns {object} Result of fn() or { status: "failed", reason }
 */
function withLockSync(lockPath, fn) {
  const startTime = Date.now();

  while (Date.now() - startTime < LOCK_CONFIG.maxWait) {
    try {
      // Try to create lock file (exclusive)
      const fd = fs.openSync(lockPath, "wx");
      try {
        // Write pid + timestamp for diagnostics and stale detection
        const lockInfo = JSON.stringify({
          pid: process.pid,
          timestamp: Date.now(),
        });
        fs.writeSync(fd, lockInfo);
        fs.fsyncSync(fd);

        // Execute actual operation
        return fn();
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Ignore cleanup failure
        }
      }
    } catch (err) {
      if (err.code === "EEXIST") {
        // Lock file exists, check if stale
        try {
          const lockContent = fs.readFileSync(lockPath, "utf-8");
          const lockInfo = JSON.parse(lockContent);
          const lockAge = Date.now() - lockInfo.timestamp;

          if (lockAge > LOCK_CONFIG.staleThreshold) {
            // Stale lock, force cleanup and retry
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch {
          // Lock file corrupted or unreadable, cleanup and retry
          try {
            fs.unlinkSync(lockPath);
          } catch {
            // Ignore
          }
          continue;
        }

        // Lock still valid, wait and retry
        const elapsed = Date.now() - startTime;
        if (elapsed >= LOCK_CONFIG.maxWait) {
          return { status: "failed", reason: "Lock acquisition timeout" };
        }
        // Busy wait (sync)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_CONFIG.retryInterval);
        continue;
      }
      // Other errors - return failure without throwing
      return { status: "failed", reason: `Lock error: ${err.message}` };
    }
  }
  return { status: "failed", reason: "Lock acquisition timeout" };
}

// ============================================================================
// Atomic Write
// ============================================================================

/**
 * Atomic write using temp file + rename
 * POSIX guarantees rename is atomic
 */
function atomicWrite(filePath, content) {
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
}

// ============================================================================
// Merge Operations
// ============================================================================

/**
 * Wrap content with block markers
 */
function wrapBlock(content) {
  return `${BLOCK_MARKERS.begin}\n${content}\n${BLOCK_MARKERS.end}`;
}

/**
 * Append block to existing content
 * - Normalizes trailing whitespace
 * - Ensures proper separation with double newline
 */
function appendBlock(existingContent, block) {
  const normalized = existingContent.trimEnd();
  const separator = normalized ? "\n\n" : "";
  return normalized + separator + block + "\n";
}

/**
 * Replace existing block in content
 */
function replaceBlock(existingContent, newBlock) {
  const blockRegex = new RegExp(
    `\\n*${escapeRegex(BLOCK_MARKERS.begin)}[\\s\\S]*?${escapeRegex(BLOCK_MARKERS.end)}\\n*`,
    "m"
  );
  // Remove old block and insert new one
  const cleaned = existingContent.replace(blockRegex, "\n").trimEnd();
  return appendBlock(cleaned, newBlock);
}

/**
 * Perform the actual merge operation
 *
 * @param {string} targetPath - Path to AGENTS.md
 * @param {string} sourceContent - Content of AGENTS.autodeploy.md
 * @param {object} statusResult - Result from checkBlockStatus()
 * @returns {object} { status: "installed" | "updated" }
 */
function doMerge(targetPath, sourceContent, statusResult) {
  const wrappedBlock = wrapBlock(sourceContent);

  if (statusResult.status === "missing_file") {
    // Create new file with just the block
    atomicWrite(targetPath, wrappedBlock + "\n");
    return { status: "installed" };
  }

  if (statusResult.status === "missing_block") {
    // Append block to existing file
    const existing = fs.readFileSync(targetPath, "utf-8");
    const newContent = appendBlock(existing, wrappedBlock);
    atomicWrite(targetPath, newContent);
    return { status: "installed" };
  }

  if (statusResult.status === "outdated") {
    // Replace existing block
    const existing = fs.readFileSync(targetPath, "utf-8");
    const newContent = replaceBlock(existing, wrappedBlock);
    atomicWrite(targetPath, newContent);
    return { status: "updated" };
  }

  // Should not reach here, but handle gracefully
  return { status: "failed", reason: `Unknown status: ${statusResult.status}` };
}

/**
 * Main entry point - ensure AGENTS.md is merged
 *
 * Guarantees:
 * - Never throws exceptions
 * - Returns { status: "up_to_date" | "installed" | "updated" | "skipped" | "failed" }
 * - Safe to call from synchronous context
 *
 * @param {string} workspacePath - OpenClaw workspace path (e.g., ~/.openclaw/workspace)
 * @param {string} pluginDir - Plugin directory containing AGENTS.autodeploy.md
 * @returns {object} { status: string, reason?: string }
 */
function ensureAgentsMerged(workspacePath, pluginDir) {
  // Outer catch ensures we never throw
  try {
    // Ensure workspace directory exists
    if (!fs.existsSync(workspacePath)) {
      fs.mkdirSync(workspacePath, { recursive: true });
    }

    const lockPath = path.join(workspacePath, ".agents.merge.lock");
    const sourcePath = path.join(pluginDir, "AGENTS.autodeploy.md");
    const targetPath = path.join(workspacePath, "AGENTS.md");

    // Check source file exists
    if (!fs.existsSync(sourcePath)) {
      return { status: "failed", reason: "Source AGENTS.autodeploy.md not found" };
    }

    const sourceContent = fs.readFileSync(sourcePath, "utf-8");

    // Execute merge under lock
    return withLockSync(lockPath, () => {
      const statusResult = checkBlockStatus(targetPath, sourceContent);

      if (statusResult.status === "up_to_date") {
        return { status: "up_to_date" };
      }

      return doMerge(targetPath, sourceContent, statusResult);
    });
  } catch (err) {
    // Fallback: any unexpected exception becomes a failed result
    return { status: "failed", reason: err.message };
  }
}

/**
 * Legacy merge function for scripts/install.js compatibility
 *
 * @param {string} workspacePath - Target workspace
 * @param {string} pluginDir - Plugin directory
 * @returns {boolean} Success
 */
function mergeAgentsMd(workspacePath, pluginDir) {
  const result = ensureAgentsMerged(workspacePath, pluginDir);
  return result.status !== "failed";
}

/**
 * Unmerge (remove) block from AGENTS.md
 *
 * @param {string} workspacePath - Target workspace
 * @returns {boolean} Success
 */
function unmergeAgentsMd(workspacePath) {
  const targetPath = path.join(workspacePath, "AGENTS.md");

  if (!fs.existsSync(targetPath)) {
    return true;
  }

  const existing = fs.readFileSync(targetPath, "utf-8");

  if (!existing.includes(BLOCK_MARKERS.begin)) {
    return true;
  }

  // Remove block with surrounding whitespace
  const blockRegex = new RegExp(
    `\\n*${escapeRegex(BLOCK_MARKERS.begin)}[\\s\\S]*?${escapeRegex(BLOCK_MARKERS.end)}\\n*`,
    "m"
  );
  const cleaned = existing.replace(blockRegex, "\n").trim();

  atomicWrite(targetPath, cleaned);
  return true;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  BLOCK_MARKERS,
  ensureAgentsMerged,
  mergeAgentsMd,
  unmergeAgentsMd,
  checkBlockStatus,
  checkStaticRules,
  normalizeContent,
  atomicWrite,
  withLockSync,
};