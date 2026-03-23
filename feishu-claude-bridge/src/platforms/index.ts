/**
 * Platform Adapters
 *
 * This module imports all platform adapters, which automatically register
 * themselves with the platform registry.
 *
 * To add a new platform:
 * 1. Create a new directory under platforms/ (e.g., wecom/)
 * 2. Implement the adapter extending BaseAdapter
 * 3. Export it from an index.ts that auto-registers
 * 4. Import it here
 */

// Import Feishu adapter (auto-registers)
import "./feishu/index.js"

// Import DingTalk adapter (auto-registers)
import "./dingtalk/index.js"

// Re-export types and base class for convenience
export { BaseAdapter } from "./base.js"
export type { PlatformAdapter, PlatformAdapterConstructor } from "../core/types.js"

// Re-export platform-specific modules
export * from "./feishu/index.js"
export * from "./dingtalk/index.js"