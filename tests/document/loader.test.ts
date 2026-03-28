/**
 * Document Loader Tests
 */

import { describe, it, expect, beforeEach } from "vitest"
import { documentLoader, DocumentLoaderImpl } from "../../src/document/loader"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

describe("Document Loader", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-loader-test-"))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe("loadFromLocal", () => {
    it("should load local markdown file", async () => {
      const filePath = path.join(tempDir, "test.md")
      const content = "# Test Document\n\nThis is a test."
      fs.writeFileSync(filePath, content)

      const result = await documentLoader.loadFromLocal(filePath)

      expect(result.source).toBe("local")
      expect(result.content).toBe(content)
      expect(result.provenance.filePath).toBe(filePath)
      expect(result.provenance.contentHash).toBeDefined()
    })

    it("should throw error for non-existent file", async () => {
      await expect(
        documentLoader.loadFromLocal("/non/existent/file.md")
      ).rejects.toThrow("File not found")
    })

    it("should compute content hash", async () => {
      const filePath = path.join(tempDir, "test.md")
      fs.writeFileSync(filePath, "test content")

      const result = await documentLoader.loadFromLocal(filePath)

      expect(result.provenance.contentHash).toMatch(/^[a-f0-9]{16}$/)
    })

    it("should detect markdown format", async () => {
      const filePath = path.join(tempDir, "doc.md")
      fs.writeFileSync(filePath, "# Markdown")

      const result = await documentLoader.loadFromLocal(filePath)

      expect(result.originalFormat).toBe("markdown")
    })

    it("should detect HTML format", async () => {
      const filePath = path.join(tempDir, "doc.html")
      fs.writeFileSync(filePath, "<html></html>")

      const result = await documentLoader.loadFromLocal(filePath)

      expect(result.originalFormat).toBe("html")
    })
  })

  describe("loadFromPasted", () => {
    it("should load pasted content", async () => {
      const content = "# Pasted Document\n\nContent from clipboard."

      const result = await documentLoader.loadFromPasted(content)

      expect(result.source).toBe("pasted")
      expect(result.content).toBe(content)
      expect(result.originalFormat).toBe("markdown")
    })

    it("should compute hash for pasted content", async () => {
      const result = await documentLoader.loadFromPasted("test")

      expect(result.provenance.contentHash).toBeDefined()
      expect(result.provenance.fetchedAt).toBeDefined()
    })
  })

  describe("External sources (Stage 1B)", () => {
    it("should reject Feishu URL in Stage 1A", async () => {
      await expect(
        documentLoader.load("https://feishu.cn/docx/test")
      ).rejects.toThrow("Feishu document loading not supported in Stage 1A")
    })

    it("should reject Dingding URL in Stage 1A", async () => {
      await expect(
        documentLoader.load("https://dingtalk.com/document/test")
      ).rejects.toThrow("Dingding document loading not supported in Stage 1A")
    })

    it("should reject unsupported URLs", async () => {
      await expect(
        documentLoader.load("https://example.com/doc")
      ).rejects.toThrow("Unsupported URL")
    })
  })
})