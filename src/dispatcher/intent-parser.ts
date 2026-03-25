/**
 * Intent Parser
 *
 * Classifies user intent from natural language queries.
 */

import type { Intent } from "../core/state-manager"

/**
 * Intent patterns for classification
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
    /下载/i,
    /transfer/i,
    /同步/i,
    /拷贝/i,
  ],
  execute_document: [
    // 保守触发：需要显式动作词，URL 只是候选信号
    /按文档.*(部署|执行|安装)/i,
    /执行.*文档/i,
    /根据文档.*部署/i,
    /按照.*文档.*操作/i,
    /文档驱动/i,
    /document.*execution/i,
    /execute.*from.*document/i,
  ],
  auto: [],
}

/**
 * Parse intent from a natural language query
 */
export function parseIntent(query: string): Intent {
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS) as [Intent, RegExp[]][]) {
    if (intent === "auto") continue

    for (const pattern of patterns) {
      if (pattern.test(query)) {
        return intent
      }
    }
  }

  // Default to auto for unknown queries
  return "auto"
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
  switch (intent) {
    case "deploy_env":
      return "Deploy complete MUSA environment (dependencies, driver, toolkit, container)"
    case "update_driver":
      return "Update or reinstall GPU driver"
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
      return "Unknown intent"
  }
}

/**
 * Get skill path for intent
 */
export function getIntentSkillPath(intent: Intent): string | null {
  switch (intent) {
    case "deploy_env":
      return "skills/deploy_musa_base_env/SKILL.md"
    case "update_driver":
      return "skills/update_musa_driver/SKILL.md"
    default:
      return null
  }
}