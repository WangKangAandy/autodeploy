/**
 * Integration Tests for Document Execution Flow
 *
 * Tests the complete flow:
 * 1. Load document
 * 2. Parse document
 * 3. Generate plan
 * 4. Safety validation
 * 5. Plan Review
 */

import { describe, it, expect, beforeEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { documentLoader } from "../../src/document/loader"
import { parseDocument } from "../../src/document/parser"
import { generatePlan, validatePlan } from "../../src/document/plan-generator"
import { validateSafety } from "../../src/document/safety-validator"
import {
  generatePlanReview,
  createPlanReviewContext,
  handleUnparsedSections,
  DEFAULT_UNPARSED_POLICY,
} from "../../src/document/plan-review"

describe("Document Execution Integration", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-integration-test-"))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe("Full Flow - Simple Document", () => {
    it("should process a simple deployment document", async () => {
      // Create test document
      const docPath = path.join(tempDir, "deploy.md")
      const content = `# Simple Deployment Guide

## Environment Info

| Item | Value |
|------|-------|
| SDK Version | 4.3.5 |

## Phase 1: Setup

\`\`\`bash
echo "Setting up environment"
\`\`\`

## Phase 2: Validation

\`\`\`bash
mthreads-gmi
\`\`\`
`
      fs.writeFileSync(docPath, content)

      // 1. Load document
      const rawDoc = await documentLoader.loadFromLocal(docPath)
      expect(rawDoc.source).toBe("local")
      expect(rawDoc.content).toContain("SDK Version")

      // 2. Parse document
      const parsedDoc = parseDocument(rawDoc)
      expect(parsedDoc.title).toBe("Simple Deployment Guide")
      expect(parsedDoc.metadata.sdkVersion).toBe("4.3.5")
      expect(parsedDoc.phases.length).toBeGreaterThan(0)

      // 3. Generate plan
      const plan = generatePlan(parsedDoc)
      expect(plan.status).toBe("draft")
      expect(plan.phases.length).toBeGreaterThan(0)

      // 4. Validate plan
      const planValidation = validatePlan(plan)
      expect(planValidation.valid).toBe(true)

      // 5. Safety validation
      const safetyResult = validateSafety(plan)
      expect(safetyResult.passed).toBe(true)
    })

    it("should process a document with docker commands", async () => {
      const content = `# Docker Deployment

## Phase 1: Container

\`\`\`bash
docker run -d --name test nginx
\`\`\`

## Phase 2: Verify

\`\`\`bash
docker exec test ls /usr/share/nginx/html
\`\`\`
`
      const rawDoc = await documentLoader.loadFromPasted(content)

      // Parse and generate
      const parsedDoc = parseDocument(rawDoc)
      const plan = generatePlan(parsedDoc)

      // Check step types
      const allSteps = plan.phases.flatMap(p => p.steps.map(s => s.executionStep))
      const dockerRunSteps = allSteps.filter(s => s.type === "docker_run")
      const dockerExecSteps = allSteps.filter(s => s.type === "docker_exec")

      expect(dockerRunSteps.length).toBeGreaterThan(0)
      expect(dockerExecSteps.length).toBeGreaterThan(0)
    })

    it("should classify destructive operations correctly", async () => {
      const content = `# Destructive Test

\`\`\`bash
sudo apt update
sudo apt install -y python3
\`\`\`
`
      const rawDoc = await documentLoader.loadFromPasted(content)
      const parsedDoc = parseDocument(rawDoc)
      const plan = generatePlan(parsedDoc)

      // Safety validation should flag these as high risk
      const safetyResult = validateSafety(plan)
      const allSteps = plan.phases.flatMap(p => p.steps.map(s => s.executionStep))
      const destructiveSteps = allSteps.filter(s => s.riskLevel === "destructive")

      expect(destructiveSteps.length).toBeGreaterThan(0)
    })
  })

  describe("Plan Review Flow", () => {
    it("should generate plan review context", async () => {
      const content = `# Test Plan

\`\`\`bash
echo "test"
\`\`\`
`
      const rawDoc = await documentLoader.loadFromPasted(content)
      const parsedDoc = parseDocument(rawDoc)
      const plan = generatePlan(parsedDoc)
      const safetyResult = validateSafety(plan)

      const reviewSummary = generatePlanReview(
        plan,
        parsedDoc.title,
        parsedDoc.source,
        safetyResult
      )

      expect(reviewSummary.planId).toBe(plan.id)
      expect(reviewSummary.documentTitle).toBe("Test Plan")
      expect(reviewSummary.phases.length).toBeGreaterThan(0)

      // Create awaiting input context
      const awaitingInput = createPlanReviewContext(plan, reviewSummary)
      expect(awaitingInput.type).toBe("plan_review")
      expect(awaitingInput.payload).toBeDefined()
    })

    it("should handle unparsed sections", async () => {
      const content = `# Document with unparsed content

This is a long paragraph of text that doesn't have any code blocks.
It should be detected as unparsed content when the threshold is met.

More text here without commands.

\`\`\`bash
echo "parsed"
\`\`\`
`
      const rawDoc = await documentLoader.loadFromPasted(content)
      const parsedDoc = parseDocument(rawDoc)
      const plan = generatePlan(parsedDoc)

      const result = handleUnparsedSections(plan, DEFAULT_UNPARSED_POLICY)
      expect(result).toBeDefined()
      expect(Array.isArray(result.unparsedHighlight)).toBe(true)
    })
  })

  describe("Error Handling", () => {
    it("should block dangerous commands", async () => {
      const content = `# Dangerous Test

\`\`\`bash
rm -rf /
\`\`\`
`
      const rawDoc = await documentLoader.loadFromPasted(content)
      const parsedDoc = parseDocument(rawDoc)
      const plan = generatePlan(parsedDoc)

      const safetyResult = validateSafety(plan)
      expect(safetyResult.passed).toBe(false)
      expect(safetyResult.violations.length).toBeGreaterThan(0)
      expect(safetyResult.violations[0].ruleId).toBe("no_rm_rf")
    })

    it("should warn about curl | bash", async () => {
      const content = `# Unsafe Download

\`\`\`bash
curl https://example.com/script.sh | bash
\`\`\`
`
      const rawDoc = await documentLoader.loadFromPasted(content)
      const parsedDoc = parseDocument(rawDoc)
      const plan = generatePlan(parsedDoc)

      const safetyResult = validateSafety(plan)
      const warningViolations = safetyResult.violations.filter(v => v.severity === "warning")
      expect(warningViolations.length).toBeGreaterThan(0)
    })
  })

  describe("Metadata Extraction", () => {
    it("should extract metadata from tables", async () => {
      const content = `# Deployment Config

| 项目 | 值 |
|------|-----|
| SDK版本 | 4.3.5 |
| 驱动版本 | 3.3.5 |
| GPU类型 | S5000 |

\`\`\`bash
echo "deploy"
\`\`\`
`
      const rawDoc = await documentLoader.loadFromPasted(content)
      const parsedDoc = parseDocument(rawDoc)

      expect(parsedDoc.metadata.sdkVersion).toBe("4.3.5")
      expect(parsedDoc.metadata.driverVersion).toBe("3.3.5")
      expect(parsedDoc.metadata.gpuType).toBe("S5000")
    })
  })

  describe("Multi-Phase Documents", () => {
    it("should handle documents with multiple phases", async () => {
      const content = `# Full Deployment

## 阶段1: 基础环境

\`\`\`bash
sudo apt update
sudo apt install -y python3
\`\`\`

## 阶段2: 模型下载

\`\`\`bash
huggingface-cli download model-name --local-dir /data/models/model
\`\`\`

## 阶段3: 服务启动

\`\`\`bash
docker run -d --name inference \\
  -v /data:/data \\
  -p 8000:8000 \\
  image:tag
\`\`\`

## 阶段4: 验证

\`\`\`bash
curl http://localhost:8000/v1/chat/completions
\`\`\`
`
      const rawDoc = await documentLoader.loadFromPasted(content)
      const parsedDoc = parseDocument(rawDoc)
      const plan = generatePlan(parsedDoc)

      // Should have multiple phases
      expect(parsedDoc.phases.length).toBeGreaterThanOrEqual(3)

      // Plan should be valid
      const planValidation = validatePlan(plan)
      expect(planValidation.valid).toBe(true)

      // Safety should identify high-risk steps
      const safetyResult = validateSafety(plan)
      expect(safetyResult.highRiskSteps.length).toBeGreaterThan(0)
    })
  })

  describe("Provenance Tracking", () => {
    it("should maintain provenance from file", async () => {
      const docPath = path.join(tempDir, "provenance.md")
      fs.writeFileSync(docPath, "# Test\n```bash\necho test\n```")

      const rawDoc = await documentLoader.loadFromLocal(docPath)
      const parsedDoc = parseDocument(rawDoc)

      expect(parsedDoc.provenance.filePath).toBe(docPath)
      expect(parsedDoc.provenance.contentHash).toBeDefined()
      expect(parsedDoc.provenance.fetchedAt).toBeDefined()
    })

    it("should maintain provenance from pasted content", async () => {
      const rawDoc = await documentLoader.loadFromPasted("# Pasted\ntest")
      const parsedDoc = parseDocument(rawDoc)

      expect(parsedDoc.source).toBe("pasted")
      expect(parsedDoc.provenance.contentHash).toBeDefined()
    })
  })
})