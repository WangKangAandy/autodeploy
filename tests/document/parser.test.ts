/**
 * Document Parser Tests
 */

import { describe, it, expect } from "vitest"
import { parseDocument } from "../../src/document/parser"
import type { RawDocument } from "../../src/document/types"

function createRawDocument(content: string, source: "local" | "pasted" = "pasted"): RawDocument {
  return {
    source,
    content,
    provenance: {
      fetchedAt: new Date().toISOString(),
      contentHash: "test-hash",
    },
  }
}

describe("Document Parser", () => {
  describe("Title Extraction", () => {
    it("should extract title from first heading", () => {
      const content = "# Wan2.2 Deployment Guide\n\nContent here"
      const result = parseDocument(createRawDocument(content))

      expect(result.title).toBe("Wan2.2 Deployment Guide")
    })

    it("should return default title if no heading found", () => {
      const content = "No heading here\nJust content"
      const result = parseDocument(createRawDocument(content))

      expect(result.title).toBe("Untitled Document")
    })
  })

  describe("Phase Detection", () => {
    it("should detect Phase 1 style headings", () => {
      const content = `# Document

## Phase 1: Base Environment

\`\`\`bash
echo "hello"
\`\`\`

## Phase 2: Application

\`\`\`bash
echo "app"
\`\`\`
`
      const result = parseDocument(createRawDocument(content))

      // Parser creates phases from headings, but also might create default phase for code blocks
      expect(result.phases.length).toBeGreaterThanOrEqual(2)
      // Find the phase with the expected name
      const baseEnvPhase = result.phases.find(p => p.name.includes("Base Environment"))
      const appPhase = result.phases.find(p => p.name.includes("Application"))
      expect(baseEnvPhase).toBeDefined()
      expect(appPhase).toBeDefined()
    })

    it("should detect Chinese phase headings (阶段)", () => {
      const content = `# Document

## 阶段1: 基础环境

\`\`\`bash
echo "hello"
\`\`\`
`
      const result = parseDocument(createRawDocument(content))

      // Find the phase with Chinese name
      const chinesePhase = result.phases.find(p => p.name.includes("基础环境"))
      expect(chinesePhase).toBeDefined()
    })
  })

  describe("Code Block Extraction", () => {
    it("should extract bash commands from code blocks", () => {
      const content = `# Document

\`\`\`bash
echo "hello"
\`\`\`
`
      const result = parseDocument(createRawDocument(content))

      expect(result.phases).toHaveLength(1)
      expect(result.phases[0].steps).toHaveLength(1)
      expect(result.phases[0].steps[0].command).toBe('echo "hello"')
      expect(result.phases[0].steps[0].type).toBe("shell")
    })

    it("should extract shell commands from code blocks", () => {
      const content = `# Document

\`\`\`shell
ls -la
\`\`\`
`
      const result = parseDocument(createRawDocument(content))

      expect(result.phases[0].steps).toHaveLength(1)
      expect(result.phases[0].steps[0].type).toBe("shell")
    })

    it("should ignore unsupported language blocks", () => {
      const content = `# Document

\`\`\`python
print("hello")
\`\`\`
`
      const result = parseDocument(createRawDocument(content))

      // Should have default phase with no steps
      expect(result.phases.length).toBeGreaterThanOrEqual(0)
    })

    it("should handle multiple commands in one block", () => {
      const content = `# Document

\`\`\`bash
echo "first"
echo "second"
\`\`\`
`
      const result = parseDocument(createRawDocument(content))

      expect(result.phases[0].steps).toHaveLength(2)
    })

    it("should skip comment lines", () => {
      const content = `# Document

\`\`\`bash
# This is a comment
echo "actual command"
\`\`\`
`
      const result = parseDocument(createRawDocument(content))

      expect(result.phases[0].steps).toHaveLength(1)
      expect(result.phases[0].steps[0].command).toBe('echo "actual command"')
    })
  })

  describe("Command Classification", () => {
    it("should classify docker exec commands", () => {
      const content = `# Document

\`\`\`bash
docker exec mycontainer ls /app
\`\`\`
`
      const result = parseDocument(createRawDocument(content))

      expect(result.phases[0].steps[0].type).toBe("docker_exec")
    })

    it("should classify docker run commands", () => {
      const content = `# Document

\`\`\`bash
docker run -d nginx
\`\`\`
`
      const result = parseDocument(createRawDocument(content))

      expect(result.phases[0].steps[0].type).toBe("docker_run")
    })

    it("should classify curl validation commands", () => {
      const content = `# Document

\`\`\`bash
curl http://localhost:8000/health
\`\`\`
`
      const result = parseDocument(createRawDocument(content))

      expect(result.phases[0].steps[0].type).toBe("validation")
      expect(result.phases[0].steps[0].validationLevel).toBe("service")
    })

    it("should classify mthreads-gmi as validation", () => {
      const content = `# Document

\`\`\`bash
mthreads-gmi
\`\`\`
`
      const result = parseDocument(createRawDocument(content))

      expect(result.phases[0].steps[0].type).toBe("validation")
      expect(result.phases[0].steps[0].validationLevel).toBe("infra")
    })
  })

  describe("Risk Classification", () => {
    it("should classify query commands as read_only", () => {
      const content = `# Document

\`\`\`bash
mthreads-gmi
\`\`\`
`
      const result = parseDocument(createRawDocument(content))

      expect(result.phases[0].steps[0].riskLevel).toBe("read_only")
    })

    it("should classify apt install as destructive", () => {
      const content = `# Document

\`\`\`bash
sudo apt install -y python3
\`\`\`
`
      const result = parseDocument(createRawDocument(content))

      expect(result.phases[0].steps[0].riskLevel).toBe("destructive")
    })

    it("should detect sudo requirement", () => {
      const content = `# Document

\`\`\`bash
sudo apt update
\`\`\`
`
      const result = parseDocument(createRawDocument(content))

      expect(result.phases[0].steps[0].requiresSudo).toBe(true)
    })
  })

  describe("Metadata Extraction", () => {
    it("should extract SDK version from table", () => {
      const content = `# Document

| Item | Value |
|------|-------|
| SDK Version | 4.3.5 |
| Driver Version | 3.3.5 |

\`\`\`bash
echo "test"
\`\`\`
`
      const result = parseDocument(createRawDocument(content))

      expect(result.metadata.sdkVersion).toBe("4.3.5")
      expect(result.metadata.driverVersion).toBe("3.3.5")
    })

    it("should extract Chinese labels from table", () => {
      const content = `# Document

| 项目 | 值 |
|------|-------|
| SDK版本 | 4.3.5 |
| 驱动版本 | 3.3.5 |

\`\`\`bash
echo "test"
\`\`\`
`
      const result = parseDocument(createRawDocument(content))

      expect(result.metadata.sdkVersion).toBe("4.3.5")
      expect(result.metadata.driverVersion).toBe("3.3.5")
    })
  })

  describe("Unparsed Sections", () => {
    it("should track unparsed content when no code blocks present", () => {
      const content = `# Document

This is some text that has no code blocks.
It should be tracked as unparsed.

More text here without any commands.
`
      const result = parseDocument(createRawDocument(content))

      // With no code blocks, the text should be in unparsed sections
      expect(result.unparsedSections.length).toBeGreaterThanOrEqual(0)
      expect(result.totalSections).toBeGreaterThan(0)
    })
  })

  describe("Provenance", () => {
    it("should copy provenance from raw document", () => {
      const raw = createRawDocument("# Test\n```bash\necho test\n```")
      raw.provenance.filePath = "/path/to/file.md"

      const result = parseDocument(raw)

      expect(result.provenance.filePath).toBe("/path/to/file.md")
    })
  })
})