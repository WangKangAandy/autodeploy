/**
 * LarkTicket Integration
 *
 * Unified accessor for openclaw-lark's AsyncLocalStorage ticket.
 * Works when called within the async context of a Feishu message handler.
 */

import * as path from "path"
import * as os from "os"

/**
 * LarkTicket from openclaw-lark plugin
 * Available via AsyncLocalStorage in the same async call chain
 */
export interface LarkTicket {
  messageId: string
  chatId: string
  accountId: string
  startTime: number
  senderOpenId?: string
  chatType?: "p2p" | "group"
  threadId?: string
}

// Cache the require result to avoid repeated path resolution
let larkTicketModule: { getTicket: () => LarkTicket | undefined } | null = null
let larkTicketModuleChecked = false

/**
 * Get the path to openclaw-lark's lark-ticket module
 */
function getLarkTicketModulePath(): string {
  return path.join(
    os.homedir(),
    ".openclaw/extensions/openclaw-lark/src/core/lark-ticket.js"
  )
}

/**
 * Load the lark-ticket module (cached)
 */
function loadLarkTicketModule(): { getTicket: () => LarkTicket | undefined } | null {
  if (larkTicketModuleChecked) {
    return larkTicketModule
  }

  larkTicketModuleChecked = true

  try {
    const modulePath = getLarkTicketModulePath()
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    larkTicketModule = require(modulePath)
    return larkTicketModule
  } catch {
    // Module not available - not running in openclaw-lark context
    return null
  }
}

/**
 * Get the current LarkTicket from AsyncLocalStorage
 * Returns undefined if not in a Lark async context
 *
 * @example
 * ```ts
 * const ticket = getLarkTicket()
 * if (ticket) {
 *   console.log(`Message: ${ticket.messageId} from ${ticket.senderOpenId}`)
 * }
 * ```
 */
export function getLarkTicket(): LarkTicket | undefined {
  const module = loadLarkTicketModule()
  if (!module?.getTicket) {
    return undefined
  }
  return module.getTicket()
}

/**
 * Check if we're in a Lark context
 */
export function isInLarkContext(): boolean {
  return !!getLarkTicket()
}

/**
 * Get trace ID from LarkTicket (messageId)
 * Returns undefined if not in Lark context
 */
export function getLarkTraceId(): string | undefined {
  return getLarkTicket()?.messageId
}

/**
 * Get formatted trace prefix for logging
 * Format: [TRACE:messageId]
 */
export function formatLarkTracePrefix(): string {
  const ticket = getLarkTicket()
  if (!ticket) {
    return ""
  }
  return `[TRACE:${ticket.messageId}]`
}