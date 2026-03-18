/**
 * Feishu Platform Adapter Module
 *
 * This module exports the Feishu adapter and automatically registers it
 * with the platform registry when imported.
 */

import { registry } from "../../core/registry.js"
import type { PlatformAdapterConstructor } from "../../core/types.js"
import { FeishuAdapter } from "./adapter.js"

// Auto-register with the registry
const FeishuAdapterConstructor: PlatformAdapterConstructor = FeishuAdapter
registry.register("feishu", FeishuAdapterConstructor)

// Export the adapter class
export { FeishuAdapter } from "./adapter.js"
export { FeishuApiClient } from "./api.js"
export { FeishuWebhook } from "./webhook.js"
export { FeishuFormatter } from "./formatter.js"
export * from "./types.js"