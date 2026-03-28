/**
 * Document Loader
 *
 * Stage 1A: 只支持本地/粘贴文档
 * Stage 1B: 支持飞书/钉钉文档拉取
 */

import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"

import type {
  DocumentLoader,
  RawDocument,
  DocumentProvenance,
  FeishuCredentials,
  DingdingCredentials,
} from "./types"

// ============================================================================
// Retry Configuration
// ============================================================================

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  retryableErrors: ["ECONNRESET", "ETIMEDOUT", "RATE_LIMITED"],
}

// ============================================================================
// Document Loader Implementation
// ============================================================================

/**
 * Document Loader for fetching documents from various sources
 */
export class DocumentLoaderImpl implements DocumentLoader {
  /**
   * Load document from URL (auto-detect source)
   * Stage 1B: Will support Feishu/Dingding URLs
   */
  async load(url: string): Promise<RawDocument> {
    if (url.includes("feishu.cn")) {
      throw new Error("Feishu document loading not supported in Stage 1A. Use Stage 1B.")
    }
    if (url.includes("dingtalk.com")) {
      throw new Error("Dingding document loading not supported in Stage 1A. Use Stage 1B.")
    }
    throw new Error(`Unsupported URL: ${url}`)
  }

  /**
   * Load document from Feishu
   * Stage 1B: To be implemented
   */
  async loadFromFeishu(_token: string, _credentials: FeishuCredentials): Promise<RawDocument> {
    throw new Error("Feishu document loading not supported in Stage 1A. Use Stage 1B.")
  }

  /**
   * Load document from Dingding
   * Stage 1B: To be implemented
   */
  async loadFromDingding(_token: string, _credentials: DingdingCredentials): Promise<RawDocument> {
    throw new Error("Dingding document loading not supported in Stage 1A. Use Stage 1B.")
  }

  /**
   * Load document from local file
   * Stage 1A: Supported
   */
  async loadFromLocal(filePath: string): Promise<RawDocument> {
    // Validate file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    // Read file content
    const content = await fs.promises.readFile(filePath, "utf-8")

    // Compute content hash
    const contentHash = computeHash(content)

    // Build provenance
    const provenance: DocumentProvenance = {
      filePath,
      fetchedAt: new Date().toISOString(),
      contentHash,
    }

    // Determine original format
    const ext = path.extname(filePath).toLowerCase()
    const originalFormat: "markdown" | "html" | "docx" | undefined =
      ext === ".md" ? "markdown" :
      ext === ".html" || ext === ".htm" ? "html" :
      ext === ".docx" ? "docx" : undefined

    return {
      source: "local",
      content,
      provenance,
      originalFormat,
    }
  }

  /**
   * Load document from pasted content
   * Stage 1A: Supported
   */
  async loadFromPasted(content: string): Promise<RawDocument> {
    // Compute content hash
    const contentHash = computeHash(content)

    // Build provenance
    const provenance: DocumentProvenance = {
      fetchedAt: new Date().toISOString(),
      contentHash,
    }

    return {
      source: "pasted",
      content,
      provenance,
      originalFormat: "markdown",
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Compute SHA-256 hash of content
 */
function computeHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").substring(0, 16)
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const documentLoader = new DocumentLoaderImpl()