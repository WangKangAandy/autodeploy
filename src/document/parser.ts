/**
 * Document Parser
 *
 * V1 只支持高确定性内容：
 * - 代码块提取：只解析带语言标识的代码块（```bash, ```shell）
 * - 阶段识别：`## Phase N` 或 `## 阶段N` 作为阶段边界
 * - 命令分类：docker exec/run, curl validation, shell
 */

import * as crypto from "crypto"

import type {
  ParsedDocument,
  DocumentProvenance,
  DocumentMetadata,
  ExecutionPhase,
  ExecutionStep,
  ValidationEndpoint,
  RawDocument,
} from "./types"

// ============================================================================
// Parser Configuration
// ============================================================================

/**
 * Phase detection patterns
 */
const PHASE_PATTERNS = {
  // "## Phase 1", "## Phase 1:", "## 阶段1", "## 阶段一"
  heading: /^#+\s*(?:Phase|阶段|Step)?\s*(\d*)[:：]?\s*(.*)$/i,
}

/**
 * Code block pattern with language hint
 */
const CODE_BLOCK_PATTERN = /```(\w+)\n([\s\S]*?)```/g

/**
 * Supported code block languages for command extraction
 */
const SUPPORTED_LANGUAGES = ["bash", "shell", "sh", "zsh"]

// ============================================================================
// Parser Implementation
// ============================================================================

/**
 * Parse raw document into structured format
 */
export function parseDocument(raw: RawDocument): ParsedDocument {
  const documentId = generateId("doc")
  const content = raw.content

  // Extract title (first # heading)
  const title = extractTitle(content)

  // Extract phases and steps
  const { phases, validationEndpoints } = extractPhasesAndSteps(content)

  // Extract metadata from tables or key-value pairs
  const metadata = extractMetadata(content)

  // Find unparsed sections
  const unparsedSections = findUnparsedSections(content, phases)

  // Calculate total sections
  const totalSections = countTotalSections(content)

  // Build provenance
  const provenance: DocumentProvenance = {
    ...raw.provenance,
    contentHash: computeHash(content),
  }

  return {
    id: documentId,
    source: raw.source,
    title,
    provenance,
    metadata,
    phases,
    validationEndpoints,
    unparsedSections,
    totalSections,
  }
}

// ============================================================================
// Title Extraction
// ============================================================================

function extractTitle(content: string): string {
  const lines = content.split("\n")
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)$/)
    if (match) {
      return match[1].trim()
    }
  }
  return "Untitled Document"
}

// ============================================================================
// Phase & Step Extraction
// ============================================================================

interface ExtractionResult {
  phases: ExecutionPhase[]
  validationEndpoints: ValidationEndpoint[]
}

function extractPhasesAndSteps(content: string): ExtractionResult {
  const phases: ExecutionPhase[] = []
  const validationEndpoints: ValidationEndpoint[] = []
  const lines = content.split("\n")

  let currentPhase: ExecutionPhase | null = null
  let phaseCounter = 0
  let stepCounter = 0

  // Track if we're inside a code block
  let inCodeBlock = false
  let codeBlockLang = ""
  let codeBlockContent: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Check for code block start/end
    const codeBlockStart = line.match(/^```(\w*)$/)
    if (codeBlockStart && !inCodeBlock) {
      inCodeBlock = true
      codeBlockLang = codeBlockStart[1] || ""
      codeBlockContent = []
      continue
    }

    if (line === "```" && inCodeBlock) {
      // End of code block
      inCodeBlock = false

      // Process code block if supported language
      if (SUPPORTED_LANGUAGES.includes(codeBlockLang) && codeBlockContent.length > 0) {
        const commands = codeBlockContent.join("\n")

        // Split multi-line commands into individual steps
        const individualCommands = commands.split("\n").filter(cmd => cmd.trim().length > 0)

        for (const cmd of individualCommands) {
          const trimmedCmd = cmd.trim()
          if (!trimmedCmd || trimmedCmd.startsWith("#")) continue

          const step = createExecutionStep(trimmedCmd, ++stepCounter)

          if (step) {
            if (!currentPhase) {
              // Create default phase if none exists
              currentPhase = {
                id: `phase_${++phaseCounter}`,
                name: "Default Phase",
                steps: [],
              }
              phases.push(currentPhase)
            }
            currentPhase.steps.push(step)

            // Check if it's a validation endpoint
            if (step.type === "validation") {
              validationEndpoints.push({
                id: `val_${step.id}`,
                description: step.description,
                command: step.command!,
                expectedOutput: step.expectedOutput,
                isTerminal: false,
              })
            }
          }
        }
      }

      codeBlockLang = ""
      codeBlockContent = []
      continue
    }

    if (inCodeBlock) {
      codeBlockContent.push(line)
      continue
    }

    // Check for phase heading
    const phaseMatch = line.match(PHASE_PATTERNS.heading)
    if (phaseMatch) {
      const phaseNum = phaseMatch[1]
      const phaseName = phaseMatch[2].trim() || `Phase ${phaseNum}`

      currentPhase = {
        id: `phase_${++phaseCounter}`,
        name: phaseName,
        steps: [],
      }
      phases.push(currentPhase)
      continue
    }

    // Check for inline code (single backtick commands)
    const inlineCodeMatch = line.match(/`([^`]+)`/)
    if (inlineCodeMatch && looksLikeCommand(inlineCodeMatch[1])) {
      const cmd = inlineCodeMatch[1].trim()
      const step = createExecutionStep(cmd, ++stepCounter)

      if (step) {
        if (!currentPhase) {
          currentPhase = {
            id: `phase_${++phaseCounter}`,
            name: "Default Phase",
            steps: [],
          }
          phases.push(currentPhase)
        }
        currentPhase.steps.push(step)
      }
    }
  }

  return { phases, validationEndpoints }
}

// ============================================================================
// Step Creation
// ============================================================================

function createExecutionStep(command: string, order: number): ExecutionStep | null {
  const trimmedCmd = command.trim()
  if (!trimmedCmd) return null

  const id = `step_${order}`
  const stepType = classifyCommand(trimmedCmd)
  const riskLevel = classifyStepRisk(trimmedCmd)
  const requiresSudo = detectSudo(trimmedCmd)
  const description = generateStepDescription(trimmedCmd, stepType)

  const step: ExecutionStep = {
    id,
    type: stepType,
    command: trimmedCmd,
    description,
    riskLevel,
    requiresSudo,
  }

  // Add validation-specific fields
  if (stepType === "validation") {
    step.validationLevel = detectValidationLevel(trimmedCmd)
  }

  return step
}

/**
 * Classify command type
 */
function classifyCommand(cmd: string): ExecutionStep["type"] {
  if (cmd.startsWith("docker exec ")) return "docker_exec"
  if (cmd.startsWith("docker run ")) return "docker_run"
  if (cmd.match(/^(curl|wget)\s+/) && cmd.includes("http")) return "validation"
  if (cmd.match(/mthreads-gmi|nvidia-smi|musaInfo/)) return "validation"
  return "shell"
}

/**
 * Classify step risk level
 */
function classifyStepRisk(cmd: string): "read_only" | "safe_write" | "destructive" {
  // Query commands
  if (cmd.match(/^(mthreads-gmi|nvidia-smi|docker (ps|images|logs|inspect)|curl|wget|cat|ls|echo)/)) {
    return "read_only"
  }

  // File operations
  if (cmd.match(/^(mkdir|cp|mv|rsync|huggingface-cli|pip install|npm install)/)) {
    return "safe_write"
  }

  // System changes
  if (cmd.match(/^(apt|dpkg|systemctl|modprobe|docker (run|exec|rm|rmi))/)) {
    return "destructive"
  }

  // Default to destructive for safety
  return "destructive"
}

/**
 * Detect if command requires sudo
 */
function detectSudo(cmd: string): boolean {
  return cmd.includes("sudo ") || cmd.startsWith("sudo")
}

/**
 * Generate human-readable step description
 */
function generateStepDescription(cmd: string, type: ExecutionStep["type"]): string {
  const parts = cmd.split(/\s+/)
  const mainCmd = parts[0]

  switch (type) {
    case "docker_exec":
      return `Execute in container: ${parts.slice(2).join(" ").substring(0, 50)}`
    case "docker_run":
      return `Run container with image: ${parts.find(p => !p.startsWith("-")) || "unknown"}`
    case "validation":
      return `Validate: ${cmd.substring(0, 50)}`
    default:
      return `Run: ${mainCmd}`
  }
}

/**
 * Detect validation level based on command
 */
function detectValidationLevel(cmd: string): "infra" | "service" | "business" {
  // GPU/driver validation -> infra
  if (cmd.match(/mthreads-gmi|nvidia-smi|musaInfo/)) {
    return "infra"
  }

  // HTTP endpoint validation -> service
  if (cmd.match(/curl.*http|wget.*http/)) {
    // Check if it's a business logic endpoint
    if (cmd.match(/chat|completions|inference|predict/)) {
      return "business"
    }
    return "service"
  }

  // Default to infra
  return "infra"
}

/**
 * Check if string looks like a shell command
 */
function looksLikeCommand(s: string): boolean {
  const cmdPrefixes = [
    "docker", "kubectl", "curl", "wget", "apt", "dpkg", "pip", "npm",
    "python", "bash", "sh", "mkdir", "cp", "mv", "rm", "cat", "ls",
    "git", "huggingface-cli", "mthreads-gmi", "nvidia-smi",
  ]

  return cmdPrefixes.some(prefix => s.startsWith(prefix))
}

// ============================================================================
// Metadata Extraction
// ============================================================================

function extractMetadata(content: string): DocumentMetadata {
  const metadata: DocumentMetadata = {
    customVars: {},
  }

  // Extract from tables (simple key | value pattern)
  const tablePattern = /\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g
  let match

  while ((match = tablePattern.exec(content)) !== null) {
    const key = match[1].trim().toLowerCase()
    const value = match[2].trim()

    switch (key) {
      case "sdk version":
      case "sdk版本":
        metadata.sdkVersion = value
        break
      case "driver version":
      case "驱动版本":
        metadata.driverVersion = value
        break
      case "gpu type":
      case "gpu类型":
        metadata.gpuType = value
        break
      case "docker image":
      case "镜像":
        metadata.dockerImage = value
        break
      default:
        // Store as custom var if not already captured
        if (!metadata.customVars[key]) {
          metadata.customVars[key] = value
        }
    }
  }

  return metadata
}

// ============================================================================
// Unparsed Sections Detection
// ============================================================================

function findUnparsedSections(content: string, phases: ExecutionPhase[]): string[] {
  const unparsed: string[] = []
  const lines = content.split("\n")

  let currentSection: string[] = []
  let inCodeBlock = false
  let hasCodeInCurrentSection = false

  for (const line of lines) {
    // Track code blocks
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock
      if (inCodeBlock) {
        hasCodeInCurrentSection = true
      }
      continue
    }

    // Skip code block content
    if (inCodeBlock) continue

    // Check for section boundaries (headings)
    if (line.match(/^#+\s/)) {
      // Save previous section if it has no code
      if (currentSection.length > 0 && !hasCodeInCurrentSection) {
        const sectionText = currentSection.join("\n").trim()
        if (sectionText.length > 20) {  // Ignore very short sections
          unparsed.push(sectionText)
        }
      }
      currentSection = [line]
      hasCodeInCurrentSection = false
    } else {
      currentSection.push(line)
    }
  }

  // Check last section
  if (currentSection.length > 0 && !hasCodeInCurrentSection) {
    const sectionText = currentSection.join("\n").trim()
    if (sectionText.length > 20) {
      unparsed.push(sectionText)
    }
  }

  return unparsed
}

function countTotalSections(content: string): number {
  // Count all sections (phases + paragraphs with content)
  const phases = (content.match(/^#+\s/gm) || []).length
  const codeBlocks = (content.match(/```/g) || []).length / 2
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 20).length

  return Math.max(phases + Math.floor(codeBlocks) + paragraphs, 1)
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

function computeHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").substring(0, 16)
}