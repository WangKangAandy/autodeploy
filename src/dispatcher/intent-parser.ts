/**
 * Intent Parser
 *
 * Classifies user intent from natural language queries.
 *
 * Three-layer recognition:
 * 1. Strong structural signals (path, content, markdown detection)
 * 2. Skill triggers from registry (string matching)
 * 3. Pattern fallback (regex)
 */

import type { Intent } from "../core/state-manager"
import { getSkillByIntent, getIntentToSkillMap, loadRegistry } from "./skill-registry"

/**
 * Intent patterns for classification (Layer 3 fallback)
 */
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
    // Layer 3 patterns - only used if Layer 1 & 2 don't match
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

/**
 * Markdown detection patterns
 */
const MARKDOWN_PATTERNS = [
  /^#{1,6}\s+/m,           // Heading
  /^```/m,                  // Code fence
  /^\s*[-*+]\s+/m,         // List
  /^\s*\d+\.\s+/m,         // Numbered list
  /\[.+\]\(.+\)/,          // Link
  /\*\*.+\*\*/,            // Bold
]

/**
 * Check if content looks like markdown
 */
function looksLikeMarkdown(content: string): boolean {
  // Check at least 2 markdown patterns
  let matchCount = 0
  for (const pattern of MARKDOWN_PATTERNS) {
    if (pattern.test(content)) {
      matchCount++
      if (matchCount >= 2) return true
    }
  }
  return false
}

/**
 * Check if string is a path ending with .md
 */
function isMarkdownPath(str: string): boolean {
  // Match absolute paths, relative paths, or just filenames ending with .md
  return /\.(md|markdown)$/i.test(str.trim())
}

/**
 * Extract potential document paths from query
 */
function extractDocumentPaths(query: string): string[] {
  const paths: string[] = []

  // Absolute paths (Unix-style)
  const absPathMatch = query.match(/(?:^|\s)(\/[^\s]+\.md(?:\.markdown)?)/gi)
  if (absPathMatch) {
    paths.push(...absPathMatch.map(m => m.trim()))
  }

  // Relative paths or filenames
  const relPathMatch = query.match(/(?:^|\s)(?:\.\/)?[^\s]+\.md(?:\.markdown)?/gi)
  if (relPathMatch) {
    paths.push(...relPathMatch.map(m => m.trim()).filter(p => !paths.includes(p)))
  }

  return paths
}

/**
 * Layer 1: Check strong structural signals for execute_document
 *
 * Returns true if any of these conditions are met:
 * - context.path exists and ends with .md
 * - context.content exists and looks like markdown
 * - query contains an absolute path ending with .md
 * - query contains any path ending with .md
 */
function checkDocumentStructuralSignals(
  query: string,
  context?: Record<string, unknown>
): boolean {
  // 1. context.path with .md extension
  if (context?.path && typeof context.path === "string") {
    if (isMarkdownPath(context.path)) {
      return true
    }
  }

  // 2. context.content looks like markdown
  if (context?.content && typeof context.content === "string") {
    if (looksLikeMarkdown(context.content)) {
      return true
    }
  }

  // 3. Query contains document paths
  const docPaths = extractDocumentPaths(query)
  if (docPaths.length > 0) {
    return true
  }

  return false
}

/**
 * Parse intent with context (three-layer recognition)
 *
 * Priority:
 * 1. Strong structural signals (execute_document detection)
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

  // Layer 1: Strong structural signals for execute_document
  // This takes highest priority because it's based on explicit signals
  if (checkDocumentStructuralSignals(query, context)) {
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
 *
 * For use when context is not available.
 * Delegates to parseIntentWithContext with undefined context.
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
 *
 * Uses skill.description from registry for skill-backed intents.
 * Falls back to hardcoded descriptions for non-skill intents.
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
 * Looks up skill by dispatch_intent from registry
 */
export function getIntentSkillPath(intent: Intent): string | null {
  const skill = getSkillByIntent(intent)
  if (skill && skill.path) {
    return `skills/${skill.path}`
  }
  return null
}