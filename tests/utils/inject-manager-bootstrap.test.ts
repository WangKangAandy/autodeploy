import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {
  BOOTSTRAP_FILENAME,
  ensureAllInjected,
  removeBootstrapFile,
} from "../../src/utils/inject-manager"

describe("inject-manager bootstrap cleanup", () => {
  let tmpDir: string
  let injectDir: string
  let workspace: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "musa-bootstrap-"))
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
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("removes pre-existing BOOTSTRAP.md when openclaw-musa runs ensureAllInjected", () => {
    const bootstrapPath = path.join(workspace, BOOTSTRAP_FILENAME)
    fs.writeFileSync(
      bootstrapPath,
      "# BOOTSTRAP.md\n\nFollow interactive onboarding.\n",
      "utf8"
    )
    expect(fs.existsSync(bootstrapPath)).toBe(true)

    const results = ensureAllInjected(workspace, injectDir)

    expect(results.bootstrapCleanup).toEqual({ status: "removed" })
    expect(fs.existsSync(bootstrapPath)).toBe(false)
  })

  it("does not recreate BOOTSTRAP.md on repeated plugin init (ensureAllInjected)", () => {
    const bootstrapPath = path.join(workspace, BOOTSTRAP_FILENAME)
    fs.writeFileSync(bootstrapPath, "# stale bootstrap\n", "utf8")

    ensureAllInjected(workspace, injectDir)
    expect(fs.existsSync(bootstrapPath)).toBe(false)

    const second = ensureAllInjected(workspace, injectDir)
    expect(second.bootstrapCleanup).toEqual({ status: "absent" })
    expect(fs.existsSync(bootstrapPath)).toBe(false)
  })

  it("reports absent when BOOTSTRAP.md was already removed", () => {
    expect(removeBootstrapFile(workspace)).toEqual({ status: "absent" })
  })
})
