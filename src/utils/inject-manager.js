/**
 * Inject Manager - Declarative Document Injection
 *
 * Manages block merge of multiple source files into OpenClaw workspace targets.
 * Uses a declarative source list + idempotent merge logic.
 *
 * Design principles:
 * - Declarative: INJECT_SOURCES array drives all injection logic
 * - Idempotent: safe to call multiple times, only updates when needed
 * - Atomic: uses temp file + rename for safe writes
 * - Concurrent-safe: file lock with stale detection
 * - Never throws: returns { status, reason } objects
 */

const fs = require("fs");
const path = require("path");

// ============================================================================
// Declarative Injection Sources
// ============================================================================

/**
 * List of all injection sources.
 * Add new entries here to extend injection capability.
 */
const INJECT_SOURCES = [
  {
    key: "agents",
    sourceFile: "AGENTS.autodeploy.md",
    targetFile: "AGENTS.md",
    markers: {
      begin: "<!-- AUTODEPLOY:BEGIN -->",
      end: "<!-- AUTODEPLOY:END -->",
    },
    required: true,  // Source file must exist
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
];

// ============================================================================
// Constants (shared with agents-merge.js)
// ============================================================================

const LOCK_CONFIG = {
  staleThreshold: 10000,  // 10 seconds
  maxWait: 5000,          // Max wait for lock
  retryInterval: 100,     // Retry interval in ms
};

// ============================================================================
// Content Utilities (reused from agents-merge.js)
// ============================================================================

/**
 * Normalize content for comparison
 */
function normalizeContent(content) {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

/**
 * Escape special regex characters
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Atomic write using temp file + rename
 */
function atomicWrite(filePath, content) {
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
}

// ============================================================================
// Lock Management (reused from agents-merge.js)
// ============================================================================

/**
 * Synchronous file lock with stale detection
 */
function withLockSync(lockPath, fn) {
  const startTime = Date.now();

  while (Date.now() - startTime < LOCK_CONFIG.maxWait) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        const lockInfo = JSON.stringify({
          pid: process.pid,
          timestamp: Date.now(),
        });
        fs.writeSync(fd, lockInfo);
        fs.fsyncSync(fd);
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
        try {
          const lockContent = fs.readFileSync(lockPath, "utf-8");
          const lockInfo = JSON.parse(lockContent);
          const lockAge = Date.now() - lockInfo.timestamp;

          if (lockAge > LOCK_CONFIG.staleThreshold) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch {
          try {
            fs.unlinkSync(lockPath);
          } catch {
            // Ignore
          }
          continue;
        }

        const elapsed = Date.now() - startTime;
        if (elapsed >= LOCK_CONFIG.maxWait) {
          return { status: "failed", reason: "Lock acquisition timeout" };
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_CONFIG.retryInterval);
        continue;
      }
      return { status: "failed", reason: `Lock error: ${err.message}` };
    }
  }
  return { status: "failed", reason: "Lock acquisition timeout" };
}

// ============================================================================
// Block Operations
// ============================================================================

/**
 * Wrap content with block markers
 */
function wrapBlock(content, markers) {
  return `${markers.begin}\n${content}\n${markers.end}`;
}

/**
 * Append block to existing content
 */
function appendBlock(existingContent, block) {
  const normalized = existingContent.trimEnd();
  const separator = normalized ? "\n\n" : "";
  return normalized + separator + block + "\n";
}

/**
 * Replace existing block in content
 */
function replaceBlock(existingContent, block, markers) {
  const blockRegex = new RegExp(
    `\\n*${escapeRegex(markers.begin)}[\\s\\S]*?${escapeRegex(markers.end)}\\n*`,
    "m"
  );
  const cleaned = existingContent.replace(blockRegex, "\n").trimEnd();
  return appendBlock(cleaned, block);
}

/**
 * Check block status in target file
 */
function checkBlockStatus(targetPath, sourceContent, markers) {
  if (!fs.existsSync(targetPath)) {
    return { status: "missing_file" };
  }

  const existing = fs.readFileSync(targetPath, "utf-8");
  const blockRegex = new RegExp(
    `${escapeRegex(markers.begin)}([\\s\\S]*?)${escapeRegex(markers.end)}`,
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

// ============================================================================
// Injection Operations
// ============================================================================

/**
 * Perform injection for a single source
 */
function doInject(targetPath, sourceContent, statusResult, markers) {
  const wrappedBlock = wrapBlock(sourceContent, markers);

  if (statusResult.status === "missing_file") {
    atomicWrite(targetPath, wrappedBlock + "\n");
    return { status: "installed" };
  }

  if (statusResult.status === "missing_block") {
    const existing = fs.readFileSync(targetPath, "utf-8");
    const newContent = appendBlock(existing, wrappedBlock);
    atomicWrite(targetPath, newContent);
    return { status: "installed" };
  }

  if (statusResult.status === "outdated") {
    const existing = fs.readFileSync(targetPath, "utf-8");
    const newContent = replaceBlock(existing, wrappedBlock, markers);
    atomicWrite(targetPath, newContent);
    return { status: "updated" };
  }

  return { status: "up_to_date" };
}

/**
 * Inject a single source
 *
 * @param {string} workspacePath - Target workspace (e.g., ~/.openclaw/workspace)
 * @param {string} injectDir - Source directory containing injection files
 * @param {object} source - Source configuration from INJECT_SOURCES
 * @returns {object} { status: "up_to_date" | "installed" | "updated" | "skipped" | "failed", reason?: string }
 */
function injectSource(workspacePath, injectDir, source) {
  try {
    const sourcePath = path.join(injectDir, source.sourceFile);
    const targetPath = path.join(workspacePath, source.targetFile);
    const lockPath = path.join(workspacePath, `.inject.${source.key}.lock`);

    // Check source file exists
    if (!fs.existsSync(sourcePath)) {
      if (source.required) {
        return { status: "failed", reason: `Required source file not found: ${source.sourceFile}` };
      }
      return { status: "skipped", reason: `Optional source file not found: ${source.sourceFile}` };
    }

    const sourceContent = fs.readFileSync(sourcePath, "utf-8");

    // Execute injection under lock
    return withLockSync(lockPath, () => {
      const statusResult = checkBlockStatus(targetPath, sourceContent, source.markers);

      if (statusResult.status === "up_to_date") {
        return { status: "up_to_date" };
      }

      return doInject(targetPath, sourceContent, statusResult, source.markers);
    });
  } catch (err) {
    return { status: "failed", reason: err.message };
  }
}

/**
 * Ensure all sources are injected
 *
 * Processes all sources in INJECT_SOURCES array order.
 * Returns results object with status for each source key.
 *
 * @param {string} workspacePath - Target workspace (e.g., ~/.openclaw/workspace)
 * @param {string} injectDir - Source directory (e.g., pluginDir/inject)
 * @returns {object} { [key]: { status, reason? } }
 */
function ensureAllInjected(workspacePath, injectDir) {
  // Ensure workspace directory exists
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }

  const results = {};

  for (const source of INJECT_SOURCES) {
    results[source.key] = injectSource(workspacePath, injectDir, source);
  }

  return results;
}

/**
 * Remove all injection blocks from workspace
 *
 * @param {string} workspacePath - Target workspace
 * @returns {object} { [key]: { status: "removed" | "skipped" } }
 */
function uninjectAll(workspacePath) {
  const results = {};

  for (const source of INJECT_SOURCES) {
    const targetPath = path.join(workspacePath, source.targetFile);

    if (!fs.existsSync(targetPath)) {
      results[source.key] = { status: "skipped", reason: "Target file not found" };
      continue;
    }

    const existing = fs.readFileSync(targetPath, "utf-8");

    if (!existing.includes(source.markers.begin)) {
      results[source.key] = { status: "skipped", reason: "Block not found" };
      continue;
    }

    // Remove block with surrounding whitespace
    const blockRegex = new RegExp(
      `\\n*${escapeRegex(source.markers.begin)}[\\s\\S]*?${escapeRegex(source.markers.end)}\\n*`,
      "m"
    );
    const cleaned = existing.replace(blockRegex, "\n").trim();

    atomicWrite(targetPath, cleaned);
    results[source.key] = { status: "removed" };
  }

  return results;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if any injection blocks exist in workspace
 */
function checkInjected(workspacePath) {
  const status = {};

  for (const source of INJECT_SOURCES) {
    const targetPath = path.join(workspacePath, source.targetFile);
    if (!fs.existsSync(targetPath)) {
      status[source.key] = false;
      continue;
    }
    const content = fs.readFileSync(targetPath, "utf-8");
    status[source.key] = content.includes(source.markers.begin);
  }

  return status;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  INJECT_SOURCES,
  ensureAllInjected,
  injectSource,
  uninjectAll,
  checkInjected,
  checkBlockStatus,
  normalizeContent,
  atomicWrite,
  withLockSync,
};