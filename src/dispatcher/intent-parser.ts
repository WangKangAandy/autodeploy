/**
 * Intent Parser
 *
 * Classifies user intent from natural language queries.
 *
 * Three-layer recognition:
 * 1. Scoring system for execute_document (path type + action type)
 * 2. Skill triggers from registry (string matching)
 * 3. Pattern fallback (regex)
 */

import type { Intent } from "../core/state-manager"
import { getSkillByIntent, getIntentToSkillMap, loadRegistry } from "./skill-registry"

// =============================================================================
// Constants for execute_document detection
// =============================================================================

/**
 * Markdown file extension pattern (unified)
 */
const MARKDOWN_EXT_PATTERN = /\.(?:md|markdown)$/i

/**
 * Strong execution action patterns
 * These directly indicate execution intent
 */
const STRONG_EXEC_ACTIONS = [
  /执行/i,
  /部署/i,
  /安装/i,
  /运行/i,
  /execute/i,
  /deploy/i,
  /install/i,
  /run/i,
  /apply/i,
]

/**
 * Weak guide words (reference indicators)
 * These need to be combined with execution-related words
 */
const WEAK_GUIDE_WORDS = [
  /根据/i,
  /按照/i,
]

/**
 * Execution-related words that can combine with weak guide words
 */
const EXEC_RELATED_WORDS = [
  /部署/i,
  /执行/i,
  /安装/i,
  /运行/i,
  /操作/i,
  /配置/i,
  /环境/i,
  /步骤/i,
  /流程/i,
  /deploy/i,
  /execute/i,
  /install/i,
  /setup/i,
  /run/i,
]

/**
 * Scoring thresholds
 */
const SCORE_THRESHOLD = 5  // Need at least 5 points to trigger execute_document

/**
 * Score weights
 */
const SCORE_WEIGHTS = {
  // Path types
  ABSOLUTE_PATH: 3,      // /tmp/guide.md
  RELATIVE_PATH: 2,      // ./docs/guide.md or ../guide.md
  BARE_FILENAME: 1,      // guide.md (just filename, no path prefix)

  // Content types
  MARKDOWN_CONTENT: 2,   // context.content looks like markdown

  // Action types
  STRONG_ACTION: 3,      // 执行/部署/安装/运行
  WEAK_GUIDE: 1,         // 根据/按照 (needs exec-related word)
  EXEC_RELATED: 2,       // 部署/执行/安装 (when combined with weak guide)
}

// =============================================================================
// Intent patterns for Layer 3 fallback
// =============================================================================

const INTENT_PATTERNS: Record<Intent, RegExp[]> = {
  deploy_env: [
    /部署.*环境/i,
    /install.*musa/i,
    /setup.*musa/i,
    /完整环境/i,
    /full.*setup/i,
    /安装.*musa/i,
    /初始化.*环境/i,
  ],
  update_driver: [
    /更新驱动/i,
    /upgrade.*driver/i,
    /reinstall.*driver/i,
    /切换驱动/i,
    /driver.*version/i,
    /升级驱动/i,
    /降级驱动/i,
    /重装驱动/i,
  ],
  gpu_status: [
    /gpu.*状态/i,
    /mthreads-gmi/i,
    /check.*gpu/i,
    /gpu.*info/i,
    /驱动状态/i,
    /显卡状态/i,
    /gpu状态/i,
    /查看.*gpu/i,
  ],
  run_container: [
    /run.*container/i,
    /启动容器/i,
    /docker.*run/i,
    /容器运行/i,
    /运行容器/i,
  ],
  validate: [
    /验证/i,
    /validate/i,
    /test.*musa/i,
    /torch.*musa/i,
    /检查环境/i,
    /环境验证/i,
  ],
  sync: [
    /sync/i,
    /传输/i,
    /上传/i,
    /下载.*文件/i,
    /transfer/i,
    /同步/i,
    /拷贝/i,
    /文件.*同步/i,
  ],
  execute_document: [
    /按文档.*(部署|执行|安装)/i,
    /执行.*部署.*文档/i,
    /执行.*文档/i,
    /根据文档.*部署/i,
    /按照.*文档.*操作/i,
    /文档驱动/i,
    /部署文档/i,
    /执行部署/i,
    /document.*execution/i,
    /execute.*from.*document/i,
    /run.*deployment.*document/i,
  ],
  prepare_model: [
    /下载.*模型/i,
    /准备.*模型/i,
    /pull.*model/i,
    /download.*model/i,
    /get.*model/i,
    /模型.*准备/i,
    /huggingface.*model/i,
    /modelscope.*model/i,
  ],
  prepare_dataset: [
    /下载.*数据集/i,
    /准备.*数据集/i,
    /pull.*dataset/i,
    /download.*dataset/i,
    /get.*dataset/i,
    /数据集.*准备/i,
    /huggingface.*dataset/i,
  ],
  prepare_package: [
    /下载.*驱动包/i,
    /准备.*驱动包/i,
    /下载.*musa.*包/i,
    /准备.*musa.*包/i,
    /get.*musa.*package/i,
    /download.*driver.*package/i,
    /准备.*toolkit/i,
    /下载.*toolkit/i,
  ],
  manage_images: [
    /拉取.*镜像/i,
    /推送.*镜像/i,
    /docker.*pull/i,
    /docker.*push/i,
    /导出.*镜像/i,
    /导入.*镜像/i,
    /镜像.*管理/i,
    /pull.*image/i,
    /push.*image/i,
    /list.*image/i,
  ],
  prepare_repo: [
    /克隆.*仓库/i,
    /准备.*代码/i,
    /clone.*repo/i,
    /git.*clone/i,
    /setup.*repo/i,
    /代码.*准备/i,
  ],
  auto: [],
}

// =============================================================================
// Helper functions
// =============================================================================

/**
 * Markdown content detection patterns
 */
const MARKDOWN_CONTENT_PATTERNS = [
  /^#{1,6}\s+/m,           // Heading
  /^```/m,                  // Code fence
  /^\s*[-*+]\s+/m,         // List
  /^\s*\d+\.\s+/m,         // Numbered list
  /\[.+\]\(.+\)/,          // Link
  /\*\*.+\*\*/,            // Bold
]

/**
 * Check if content looks like markdown (requires multiple signals)
 */
function looksLikeMarkdown(content: string): boolean {
  let matchCount = 0
  for (const pattern of MARKDOWN_CONTENT_PATTERNS) {
    if (pattern.test(content)) {
      matchCount++
      if (matchCount >= 2) return true
    }
  }
  return false
}

/**
 * Check if string is a markdown path (.md or .markdown)
 */
function isMarkdownPath(str: string): boolean {
  return MARKDOWN_EXT_PATTERN.test(str.trim())
}

/**
 * Path type classification
 */
type PathType = "absolute" | "relative" | "bare" | "none"

/**
 * Classify path type and extract the path
 * Returns the path and its type
 */
function classifyPath(path: string): { path: string; type: PathType } {
  const trimmed = path.trim()

  // Absolute path: starts with /
  if (trimmed.startsWith("/")) {
    return { path: trimmed, type: "absolute" }
  }

  // Relative path: starts with ./ or ../
  if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return { path: trimmed, type: "relative" }
  }

  // Bare filename
  return { path: trimmed, type: "bare" }
}

/**
 * Extract and classify markdown paths from query
 */
function extractMarkdownPaths(query: string): Array<{ path: string; type: PathType }> {
  const results: Array<{ path: string; type: PathType }> = []

  // Match paths with .md or .markdown extension
  // Pattern: optional path prefix + filename + .md/.markdown
  const pattern = /(?:^|\s)((?:\.?\.?\/)?[^\s]*?\.(?:md|markdown))(?=\s|$)/gi
  const matches = query.match(pattern)

  if (matches) {
    for (const match of matches) {
      const trimmed = match.trim()
      if (isMarkdownPath(trimmed)) {
        results.push(classifyPath(trimmed))
      }
    }
  }

  return results
}

/**
 * Remove markdown paths from query before checking action words
 * This prevents false positives like "/tmp/deploy.md" matching "deploy"
 */
function removeMarkdownPaths(text: string): string {
  return text.replace(/(?:\.?\.?\/)?[^\s]*?\.(?:md|markdown)/gi, "")
}

/**
 * Check for strong execution action in query (excluding path parts)
 */
function hasStrongExecAction(query: string): boolean {
  const textWithoutPaths = removeMarkdownPaths(query)
  return STRONG_EXEC_ACTIONS.some(p => p.test(textWithoutPaths))
}

/**
 * Check for weak guide word in query (excluding path parts)
 */
function hasWeakGuideWord(query: string): boolean {
  const textWithoutPaths = removeMarkdownPaths(query)
  return WEAK_GUIDE_WORDS.some(p => p.test(textWithoutPaths))
}

/**
 * Check for execution-related word in query (excluding path parts)
 */
function hasExecRelatedWord(query: string): boolean {
  const textWithoutPaths = removeMarkdownPaths(query)
  return EXEC_RELATED_WORDS.some(p => p.test(textWithoutPaths))
}

/**
 * Calculate execute_document score
 *
 * Scoring rules:
 * 1. MUST have action word (strong action OR weak guide + exec-related) to get any score
 * 2. Path scores are added on top of action score
 *
 * Action scores:
 * - Strong action (执行/部署/安装/运行): 3 points
 * - Weak guide (根据/按照) + exec-related (部署/执行/安装): 1 + 2 = 3 points
 * - Weak guide alone: 1 point (not enough by itself)
 *
 * Path scores (only counted if action score > 0):
 * - Absolute path (.md): +3
 * - Relative path (.md): +2
 * - Bare filename (.md): +1
 *
 * Content scores (only counted if action score > 0):
 * - Markdown content: +2
 *
 * Threshold: 5 points
 */
function calculateExecuteDocumentScore(
  query: string,
  context?: Record<string, unknown>
): number {
  // Step 1: Calculate action score
  let actionScore = 0

  if (hasStrongExecAction(query)) {
    actionScore = SCORE_WEIGHTS.STRONG_ACTION
  } else if (hasWeakGuideWord(query)) {
    actionScore = SCORE_WEIGHTS.WEAK_GUIDE
    if (hasExecRelatedWord(query)) {
      actionScore += SCORE_WEIGHTS.EXEC_RELATED
    }
  }

  // Step 2: If no action score, don't count path/content
  // This is the key change: path alone should NOT trigger execute_document
  if (actionScore === 0) {
    return 0
  }

  // Step 3: Calculate path/content score (as bonus to action)
  let bonusScore = 0

  // Path from query
  const paths = extractMarkdownPaths(query)
  for (const { type } of paths) {
    if (type === "absolute") {
      bonusScore += SCORE_WEIGHTS.ABSOLUTE_PATH
    } else if (type === "relative") {
      bonusScore += SCORE_WEIGHTS.RELATIVE_PATH
    } else {
      bonusScore += SCORE_WEIGHTS.BARE_FILENAME
    }
  }

  // Path from context
  if (context?.path && typeof context.path === "string") {
    if (isMarkdownPath(context.path)) {
      const { type } = classifyPath(context.path)
      if (type === "absolute") {
        bonusScore += SCORE_WEIGHTS.ABSOLUTE_PATH
      } else if (type === "relative") {
        bonusScore += SCORE_WEIGHTS.RELATIVE_PATH
      } else {
        bonusScore += SCORE_WEIGHTS.BARE_FILENAME
      }
    }
  }

  // Markdown content
  if (context?.content && typeof context.content === "string") {
    if (looksLikeMarkdown(context.content)) {
      bonusScore += SCORE_WEIGHTS.MARKDOWN_CONTENT
    }
  }

  return actionScore + bonusScore
}

/**
 * Layer 1: Score-based detection for execute_document
 *
 * Returns true if score meets threshold
 */
function shouldTriggerExecuteDocument(
  query: string,
  context?: Record<string, unknown>
): boolean {
  const score = calculateExecuteDocumentScore(query, context)
  return score >= SCORE_THRESHOLD
}

// =============================================================================
// Main export functions
// =============================================================================

/**
 * Parse intent with context (three-layer recognition)
 *
 * Priority:
 * 1. Scoring system for execute_document (path + action)
 * 2. Skill triggers from registry (string matching)
 * 3. INTENT_PATTERNS fallback
 * 4. "auto" as default
 */
export function parseIntentWithContext(
  query: string,
  context?: Record<string, unknown>
): Intent {
  loadRegistry()
  const intentToSkill = getIntentToSkillMap()
  const queryLower = query.toLowerCase()

  // Layer 1: Score-based execute_document detection
  if (shouldTriggerExecuteDocument(query, context)) {
    return "execute_document"
  }

  // Layer 2: Check skill triggers from registry (string matching)
  for (const [intent, skill] of intentToSkill.entries()) {
    if (skill.triggers) {
      for (const trigger of skill.triggers) {
        if (queryLower.includes(trigger.toLowerCase())) {
          return intent as Intent
        }
      }
    }
  }

  // Layer 3: Fallback to INTENT_PATTERNS for non-skill intents
  const nonSkillIntents: Intent[] = [
    "gpu_status", "validate", "sync", "run_container", "execute_document"
  ]

  for (const intent of nonSkillIntents) {
    const patterns = INTENT_PATTERNS[intent]
    if (patterns) {
      for (const pattern of patterns) {
        if (pattern.test(query)) {
          return intent
        }
      }
    }
  }

  // Default to auto
  return "auto"
}

/**
 * Parse intent from query only (backward compatible)
 */
export function parseIntent(query: string): Intent {
  return parseIntentWithContext(query, undefined)
}

/**
 * Parse intent from context keywords
 */
export function parseIntentFromKeywords(keywords: string[]): Intent {
  for (const keyword of keywords) {
    const intent = parseIntent(keyword)
    if (intent !== "auto") {
      return intent
    }
  }

  return "auto"
}

/**
 * Get intent description
 */
export function getIntentDescription(intent: Intent): string {
  const skill = getIntentToSkillMap().get(intent)
  if (skill?.description) {
    return skill.description
  }

  switch (intent) {
    case "gpu_status":
      return "Check GPU status with mthreads-gmi"
    case "run_container":
      return "Run a Docker container with GPU access"
    case "validate":
      return "Validate MUSA environment (toolkit, PyTorch MUSA)"
    case "sync":
      return "Sync files between local and remote hosts"
    case "execute_document":
      return "Execute deployment plan from document (parse document, generate plan, execute steps)"
    case "auto":
      return "Auto-detect intent from context"
    default:
      return `Execute ${intent} operation`
  }
}

/**
 * Get skill path for intent
 */
export function getIntentSkillPath(intent: Intent): string | null {
  const skill = getSkillByIntent(intent)
  if (skill && skill.path) {
    return `skills/${skill.path}`
  }
  return null
}