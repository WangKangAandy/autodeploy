/**
 * Feishu Platform Adapter Module
 *
 * This module exports the Feishu adapter and automatically registers it
 * with the platform registry when imported.
 *
 * Supports two connection modes:
 * - webhook: Receive events via HTTP webhook (requires public domain)
 * - long-connection: Receive events via WebSocket (no public domain needed)
 */

import { registry } from "../../core/registry.js"
import type { PlatformAdapterConstructor } from "../../core/types.js"
import { FeishuAdapter } from "./adapter.js"

// Auto-register with the registry
const FeishuAdapterConstructor: PlatformAdapterConstructor = FeishuAdapter
registry.register("feishu", FeishuAdapterConstructor)

// Export the adapter class and types
export { FeishuAdapter, type FeishuConnectionMode } from "./adapter.js"
export { FeishuApiClient } from "./api.js"
export { FeishuWebhook } from "./webhook.js"
export { FeishuLongConnection } from "./long-connection.js"
export { FeishuFormatter } from "./formatter.js"
export * from "./types.js"