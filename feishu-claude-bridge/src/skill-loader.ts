/**
 * Skill Loader - Loads skills from the repository's skills directory
 */
import * as fs from "fs"
import * as path from "path"
import { logger } from "./utils/logger.js"

export interface Skill {
  name: string
  description: string
  path: string
  content: string
}

/**
 * Parse frontmatter from markdown content
 */
function parseFrontmatter(content: string): { name: string; description: string } | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!frontmatterMatch) return null

  const frontmatter = frontmatterMatch[1]
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m)

  return {
    name: nameMatch ? nameMatch[1].trim() : "",
    description: descMatch ? descMatch[1].trim() : "",
  }
}

/**
 * Find the repository root by looking for skills directory
 */
function findRepoRoot(): string | null {
  let currentDir = process.cwd()

  // Go up the directory tree looking for skills directory
  for (let i = 0; i < 10; i++) {
    const skillsPath = path.join(currentDir, "skills")
    if (fs.existsSync(skillsPath)) {
      return currentDir
    }
    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  return null
}

/**
 * Load all skills from the repository
 */
export function loadSkills(): Skill[] {
  const skills: Skill[] = []

  try {
    const repoRoot = findRepoRoot()
    if (!repoRoot) {
      logger.warn("Could not find repository root with skills directory")
      return skills
    }

    const skillsDir = path.join(repoRoot, "skills")
    if (!fs.existsSync(skillsDir)) {
      logger.warn("Skills directory not found")
      return skills
    }

    // Find all SKILL.md files
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)

    for (const skillDir of skillDirs) {
      const skillPath = path.join(skillsDir, skillDir, "SKILL.md")
      if (fs.existsSync(skillPath)) {
        const content = fs.readFileSync(skillPath, "utf-8")
        const meta = parseFrontmatter(content)

        if (meta) {
          skills.push({
            name: meta.name,
            description: meta.description,
            path: skillPath,
            content: content,
          })
          logger.info(`Loaded skill: ${meta.name}`)
        }
      }
    }
  } catch (error) {
    logger.error(`Failed to load skills: ${error}`)
  }

  return skills
}

/**
 * Generate a system prompt with skills information
 */
export function generateSystemPromptWithSkills(basePrompt: string): string {
  const skills = loadSkills()

  if (skills.length === 0) {
    return basePrompt
  }

  const skillsSection = `
## 可用技能 (Skills)

你拥有以下专业技能，可以在用户需要时使用：

${skills.map(skill => `### ${skill.name}
${skill.description}`).join("\n\n")}

当用户询问你能做什么或需要帮助时，根据问题内容主动推荐相关技能。
当用户明确要求执行某个技能时，按照技能文档中的步骤执行。
`

  return basePrompt + skillsSection
}

/**
 * Get a skill by name
 */
export function getSkillByName(name: string): Skill | null {
  const skills = loadSkills()
  return skills.find(s => s.name === name) || null
}

/**
 * Get skill content for tool use
 */
export function getSkillContent(skillName: string): string | null {
  const skill = getSkillByName(skillName)
  return skill?.content || null
}