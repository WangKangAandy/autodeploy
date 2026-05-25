import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { ensureAllInjected, checkInjected } from "../../src/utils/inject-manager"

describe("inject-manager identity wholeFile", () => {
  let tmpDir: string
  let injectDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "musa-inject-"))
    injectDir = path.join(tmpDir, "inject")
    fs.mkdirSync(injectDir, { recursive: true })
    fs.copyFileSync(
      path.join(__dirname, "../../inject/IDENTITY.autodeploy.md"),
      path.join(injectDir, "IDENTITY.autodeploy.md")
    )
    fs.copyFileSync(
      path.join(__dirname, "../../inject/AGENTS.autodeploy.md"),
      path.join(injectDir, "AGENTS.autodeploy.md")
    )
    fs.copyFileSync(
      path.join(__dirname, "../../inject/BOOTSTRAP.autodeploy.md"),
      path.join(injectDir, "BOOTSTRAP.autodeploy.md")
    )
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("overwrites OpenClaw scaffold IDENTITY.md with MUSA-Claw source only", () => {
    const workspace = path.join(tmpDir, "workspace")
    fs.mkdirSync(workspace, { recursive: true })
    fs.writeFileSync(
      path.join(workspace, "IDENTITY.md"),
      "# IDENTITY.md - Who Am I?\n\n- **Name:**\n  _(pick something you like)_\n",
      "utf8"
    )

    const results = ensureAllInjected(workspace, injectDir)
    expect(results.identity.status).toBe("updated")

    const identity = fs.readFileSync(path.join(workspace, "IDENTITY.md"), "utf8")
    expect(identity).toContain("Name: MUSA-Claw")
    expect(identity).not.toContain("pick something you like")
    expect(identity).not.toContain("AUTODEPLOY:IDENTITY")
    expect(checkInjected(workspace).identity).toBe(true)
  })
})
