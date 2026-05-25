import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {
  ensureAllInjected,
  patchAgentsWorkspaceScaffold,
} from "../../src/utils/inject-manager"

const OPENCLAW_AGENTS_HEADER = `# AGENTS.md - Your Workspace

This folder is home. Treat it that way.

## First Run

If \`BOOTSTRAP.md\` exists, that's your birth certificate. Follow it, figure out who you are, then delete it. You won't need it again.

## Session Startup

Use runtime-provided startup context first.

That context may already include:

- \`AGENTS.md\`, \`SOUL.md\`, and \`USER.md\`
- recent daily memory such as \`memory/YYYY-MM-DD.md\`
`

describe("inject-manager AGENTS scaffold patch", () => {
  let tmpDir: string
  let injectDir: string
  let workspace: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "musa-agents-scaffold-"))
    injectDir = path.join(tmpDir, "inject")
    workspace = path.join(tmpDir, "workspace")
    fs.mkdirSync(injectDir, { recursive: true })
    fs.mkdirSync(workspace, { recursive: true })
    fs.copyFileSync(
      path.join(__dirname, "../../inject/IDENTITY.autodeploy.md"),
      path.join(injectDir, "IDENTITY.autodeploy.md")
    )
    fs.copyFileSync(
      path.join(__dirname, "../../inject/AGENTS.autodeploy.md"),
      path.join(injectDir, "AGENTS.autodeploy.md")
    )
    fs.writeFileSync(path.join(workspace, "AGENTS.md"), OPENCLAW_AGENTS_HEADER, "utf8")
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("replaces BOOTSTRAP First Run and adds IDENTITY.md to Session Startup list", () => {
    const result = patchAgentsWorkspaceScaffold(workspace)
    expect(result).toEqual({ status: "updated" })

    const content = fs.readFileSync(path.join(workspace, "AGENTS.md"), "utf8")
    expect(content).toContain("Identity is in `IDENTITY.md`.")
    expect(content).not.toContain("(openclaw-musa)")
    expect(content).not.toContain("birth certificate")
    expect(content).toContain("`IDENTITY.md`, `AGENTS.md`, `SOUL.md`, and `USER.md`")
  })

  it("is idempotent on repeated patch and ensureAllInjected", () => {
    patchAgentsWorkspaceScaffold(workspace)
    expect(patchAgentsWorkspaceScaffold(workspace)).toEqual({ status: "up_to_date" })

    const results = ensureAllInjected(workspace, injectDir)
    expect(results.agentsScaffold).toEqual({ status: "up_to_date" })
  })

  it("injects Runtime platform section in AUTODEPLOY block", () => {
    ensureAllInjected(workspace, injectDir)
    const content = fs.readFileSync(path.join(workspace, "AGENTS.md"), "utf8")
    expect(content).toContain("### Runtime platform")
    expect(content).toContain("not your self-intro Name")
    expect(content).not.toContain("### Platform Identity")
  })
})
