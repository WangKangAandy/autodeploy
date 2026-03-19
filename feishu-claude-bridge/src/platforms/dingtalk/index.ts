/**
 * DingTalk Platform Adapter Module
 *
 * This module exports the DingTalk adapter and automatically registers it
 * with the platform registry when imported.
 */

import { registry } from "../../core/registry.js"
import type { PlatformAdapterConstructor } from "../../core/types.js"
import { DingTalkAdapter } from "./adapter.js"

// Auto-register with the registry
const DingTalkAdapterConstructor: PlatformAdapterConstructor = DingTalkAdapter
registry.register("dingtalk", DingTalkAdapterConstructor)

// Export the adapter class
export { DingTalkAdapter } from "./adapter.js"
export { DingTalkApiClient } from "./api.js"
export { DingTalkWebhook } from "./webhook.js"
export { DingTalkLongConnection } from "./long-connection.js"
export { DingTalkFormatter } from "./formatter.js"
export * from "./types.js"