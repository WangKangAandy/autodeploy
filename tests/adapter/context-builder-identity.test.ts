import { describe, it, expect } from "vitest"
import { WORKSPACE_IDENTITY_PROMPT } from "../../src/adapter/context-builder"

describe("context-builder identity prepend", () => {
  it("mandates IDENTITY Name/Role on who-you-are without hardcoded name", () => {
    expect(WORKSPACE_IDENTITY_PROMPT.split("\n")).toHaveLength(1)
    expect(WORKSPACE_IDENTITY_PROMPT).toContain("IDENTITY.md")
    expect(WORKSPACE_IDENTITY_PROMPT).toMatch(/Who-you-are:/)
    expect(WORKSPACE_IDENTITY_PROMPT).not.toMatch(/你是谁/)
    expect(WORKSPACE_IDENTITY_PROMPT).toContain("generic OpenClaw AI assistant intro")
    expect(WORKSPACE_IDENTITY_PROMPT).not.toMatch(/MUSA-Claw/)
    expect(WORKSPACE_IDENTITY_PROMPT).not.toContain("Role: MUSA software stack")
  })
})
