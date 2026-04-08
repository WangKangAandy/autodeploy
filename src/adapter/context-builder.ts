/**
 * Dynamic Context Builder
 *
 * Generates runtime context snapshot for injection into prompt via before_prompt_build hook.
 *
 * Token Budget: Only injects essential info to avoid prompt bloat.
 * - Current mode + default host
 * - Active operation status
 * - Max 3 online hosts (to prevent token explosion)
 * - Recent tool executions
 */

import type { StateManager, ContextSnapshot, HostState } from "../core/state-manager.js"

const CONTEXT_LIMITS = {
  MAX_HOSTS: 3,
}

/**
 * Build dynamic context string for prompt injection
 */
export async function buildDynamicContext(stateManager: StateManager): Promise<string> {
  const snapshot = await stateManager.loadSnapshot()

  const lines: string[] = [
    "## MUSA Runtime Context",
    "",
    `- **Mode**: ${snapshot.mode}`,
    `- **Default Host**: ${snapshot.defaultHost || "not configured"}`,
  ]

  // Online hosts (sorted by relevance, truncated)
  const allOnlineHosts = snapshot.hosts.filter(h => h.status === "online")
  const sortedHosts = sortByRelevance(allOnlineHosts, snapshot.defaultHost)
  const displayedHosts = sortedHosts.slice(0, CONTEXT_LIMITS.MAX_HOSTS)

  if (displayedHosts.length > 0) {
    lines.push("", "## Online Hosts")
    for (const host of displayedHosts) {
      const marker = host.host === snapshot.defaultHost ? " (default)" : ""
      lines.push(`- ✓ ${host.host} (${host.gpu?.type || "unknown"})${marker}`)
    }
    if (allOnlineHosts.length > CONTEXT_LIMITS.MAX_HOSTS) {
      lines.push(`- ... and ${allOnlineHosts.length - CONTEXT_LIMITS.MAX_HOSTS} more hosts online`)
    }
  }

  // Recent tool executions
  try {
    const recentExecs = await stateManager.getRecentToolExecutions(5)
    if (recentExecs.length > 0) {
      lines.push("", "## Recent Tool Executions")
      for (const exec of recentExecs) {
        const icon = exec.success ? "✓" : "✗"
        const cmd = exec.command.length > 80 ? exec.command.substring(0, 77) + "..." : exec.command
        lines.push(`- ${icon} \`${cmd}\` (${exec.durationMs}ms)`)
      }
    }
  } catch {
    // Silently skip if tool executions not available
  }

  return lines.join("\n")
}

/**
 * Sort hosts: default host first, then alphabetical
 */
function sortByRelevance(hosts: HostState[], defaultHost: string | null): HostState[] {
  return [...hosts].sort((a, b) => {
    const aDefault = defaultHost && a.host === defaultHost ? 1 : 0
    const bDefault = defaultHost && b.host === defaultHost ? 1 : 0
    return bDefault - aDefault
  })
}
