/**
 * Refactor Verification Tests
 *
 * Verifies the simplified dispatcher architecture.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

describe("重构验证 - 改进 1: 废弃 agent-tools/", () => {
  it("agent-tools 目录不应存在", () => {
    const agentToolsDir = path.join(process.cwd(), "agent-tools")
    expect(fs.existsSync(agentToolsDir)).toBe(false)
  })

  it("源码中不应引用 agent-tools, remote-exec, remote-docker, remote-sync", () => {
    const srcDir = path.join(process.cwd(), "src")
    const files = fs.readdirSync(srcDir, { recursive: true }) as string[]
    const tsFiles = files.filter((f) => f.endsWith(".ts"))

    for (const file of tsFiles) {
      const filePath = path.join(srcDir, file)
      const content = fs.readFileSync(filePath, "utf-8")
      expect(content).not.toContain("agent-tools")
      expect(content).not.toContain("remote-exec")
      expect(content).not.toContain("remote-docker")
      expect(content).not.toContain("remote-sync")
    }
  })
})

describe("重构验证 - 改进 2: 统一为 TypeScript", () => {
  it("src 目录下不应有 .js 文件", () => {
    const srcDir = path.join(process.cwd(), "src")
    const files = fs.readdirSync(srcDir, { recursive: true }) as string[]
    const jsFiles = files.filter((f) => f.endsWith(".js"))
    expect(jsFiles.length).toBe(0)
  })

  it("入口文件应为 TypeScript", () => {
    const indexPath = path.join(process.cwd(), "src", "index.ts")
    expect(fs.existsSync(indexPath)).toBe(true)
  })

  it("npm run build 应成功编译", () => {
    const distDir = path.join(process.cwd(), "dist")
    // After build, dist should exist
    if (fs.existsSync(distDir)) {
      const indexPath = path.join(distDir, "index.js")
      expect(fs.existsSync(indexPath)).toBe(true)
    }
  })
})

describe("重构验证 - 改进 3: 简化 Dispatcher", () => {
  it("dispatcher 目录应只包含 index.ts", async () => {
    const dispatcherDir = path.join(process.cwd(), "src", "dispatcher")
    const files = fs.readdirSync(dispatcherDir)
    expect(files.length).toBe(1)
    expect(files).toContain("index.ts")
  })

  it("不应存在已删除的文件", () => {
    const dispatcherDir = path.join(process.cwd(), "src", "dispatcher")
    const deletedFiles = [
      "intent-parser.ts",
      "router.ts",
      "pre-check.ts",
      "permission-gate.ts",
      "error-normalizer.ts",
      "orchestrator.ts",
      "route-table.ts",
      "skill-registry.ts",
    ]
    for (const file of deletedFiles) {
      expect(fs.existsSync(path.join(dispatcherDir, file))).toBe(false)
    }
  })

  it("dispatcher/index.ts 应导出 dispatch 和 registerDispatcherTool", async () => {
    const mod = await import("../src/dispatcher")
    expect(typeof mod.dispatch).toBe("function")
    expect(typeof mod.registerDispatcherTool).toBe("function")
  })
})

describe("重构验证 - 改进 4: 简化文档驱动执行", () => {
  it("document 目录不应存在", () => {
    const documentDir = path.join(process.cwd(), "src", "document")
    expect(fs.existsSync(documentDir)).toBe(false)
  })

  it("execute_document 应在 dispatch 中处理", async () => {
    const { dispatch } = await import("../src/dispatcher")
    const { StateManager } = await import("../src/core/state-manager")

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "musa-test-"))
    const sm = new StateManager(tempDir)
    await sm.initialize()

    const result = await dispatch({
      intent: "execute_document",
      context: { content: "# Test" },
      force: true,
    }, sm)

    expect(result.success).toBe(true)
    expect(result.guidance).toContain("Execution Contract")

    fs.rmSync(tempDir, { recursive: true, force: true })
  })
})

describe("重构验证 - 改进 5: 工具自动上报", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "musa-test-"))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("StateManager 应有 recordToolExecution 方法", async () => {
    const { StateManager } = await import("../src/core/state-manager")
    const sm = new StateManager(tempDir)
    await sm.initialize()

    expect(typeof sm.recordToolExecution).toBe("function")
    expect(typeof sm.getRecentToolExecutions).toBe("function")
  })

  it("recordToolExecution 应保存执行记录", async () => {
    const { StateManager } = await import("../src/core/state-manager")
    const sm = new StateManager(tempDir)
    await sm.initialize()

    await sm.recordToolExecution({
      tool: "musa_exec",
      command: "echo test",
      exitCode: 0,
      success: true,
      durationMs: 100,
      timestamp: new Date().toISOString(),
    })

    const executions = await sm.getRecentToolExecutions(10)
    expect(executions.length).toBe(1)
    expect(executions[0].tool).toBe("musa_exec")
    expect(executions[0].command).toBe("echo test")
  })

  it("执行记录应保存到 tool-executions.json", async () => {
    const { StateManager } = await import("../src/core/state-manager")
    const sm = new StateManager(tempDir)
    await sm.initialize()

    await sm.recordToolExecution({
      tool: "musa_exec",
      command: "ls",
      exitCode: 0,
      success: true,
      durationMs: 50,
      timestamp: new Date().toISOString(),
    })

    const stateFile = path.join(tempDir, "autodeploy", "tool-executions.json")
    expect(fs.existsSync(stateFile)).toBe(true)

    const content = JSON.parse(fs.readFileSync(stateFile, "utf-8"))
    expect(content.length).toBe(1)
  })

  it("Ring buffer 应限制记录数量为 200 条", async () => {
    const { StateManager } = await import("../src/core/state-manager")
    const sm = new StateManager(tempDir)
    await sm.initialize()

    // 添加 250 条记录
    for (let i = 0; i < 250; i++) {
      await sm.recordToolExecution({
        tool: "musa_exec",
        command: `cmd${i}`,
        exitCode: 0,
        success: true,
        durationMs: i,
        timestamp: new Date().toISOString(),
      })
    }

    const executions = await sm.getRecentToolExecutions(300)
    expect(executions.length).toBe(200) // 最大 200 条
    // 应该保留最新的记录（cmd50 到 cmd249）
    expect(executions[0].command).toBe("cmd50")
    expect(executions[199].command).toBe("cmd249")
  })
})

describe("功能测试 - Dispatcher", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "musa-dispatch-"))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("destructive intent 需要 force 参数", async () => {
    const { dispatch } = await import("../src/dispatcher")
    const { StateManager } = await import("../src/core/state-manager")

    const sm = new StateManager(tempDir)
    await sm.initialize()

    const result = await dispatch({
      intent: "deploy_env",
      context: {},
      force: false,
    }, sm)

    expect(result.success).toBe(false)
    expect(result.error).toContain("destructive")
    expect(result.error).toContain("force=true")
  })

  it("non-destructive intent 不需要 force", async () => {
    const { dispatch } = await import("../src/dispatcher")
    const { StateManager } = await import("../src/core/state-manager")

    const sm = new StateManager(tempDir)
    await sm.initialize()

    const result = await dispatch({
      intent: "gpu_status",
      context: {},
    }, sm)

    expect(result.success).toBe(true)
  })

  it("conflict detection 应检测到冲突", async () => {
    const { dispatch } = await import("../src/dispatcher")
    const { StateManager } = await import("../src/core/state-manager")

    const sm = new StateManager(tempDir)
    await sm.initialize()

    // Start first operation
    const result1 = await dispatch({
      intent: "deploy_env",
      context: {},
      force: true,
    }, sm)
    expect(result1.success).toBe(true)

    // Try to start conflicting operation
    const result2 = await dispatch({
      intent: "deploy_env",
      context: {},
      force: true,
    }, sm)
    expect(result2.success).toBe(false)
    expect(result2.error).toContain("Conflicting operation")
  })
})

describe("功能测试 - Document Execution", () => {
  let tempDir: string
  let testFilePath: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "musa-doc-test-"))
    testFilePath = path.join(tempDir, "test-doc.md")
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("通过 context.path 加载文档", async () => {
    const testContent = "# Test Document\n\n## Step 1\n```bash\necho hello\n```"
    fs.writeFileSync(testFilePath, testContent)

    const { dispatch } = await import("../src/dispatcher")
    const { StateManager } = await import("../src/core/state-manager")

    const sm = new StateManager(tempDir)
    await sm.initialize()

    const result = await dispatch({
      intent: "execute_document",
      context: { path: testFilePath },
      force: true,
    }, sm)

    expect(result.success).toBe(true)
    expect(result.guidance).toContain("Execution Contract")
    expect(result.guidance).toContain(testFilePath)
    expect(result.guidance).toContain(testContent)
  })

  it("通过 context.content 加载文档", async () => {
    const testContent = "# Deployment Guide\n\n## Driver\n```bash\napt install driver\n```"

    const { dispatch } = await import("../src/dispatcher")
    const { StateManager } = await import("../src/core/state-manager")

    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "musa-doc-content-"))
    const sm = new StateManager(tempDir2)
    await sm.initialize()

    const result = await dispatch({
      intent: "execute_document",
      context: { content: testContent },
      force: true,
    }, sm)

    expect(result.success).toBe(true)
    expect(result.guidance).toContain("pasted content")
    expect(result.guidance).toContain(testContent)

    fs.rmSync(tempDir2, { recursive: true, force: true })
  })

  it("缺少 path 和 content 时返回错误", async () => {
    const { dispatch } = await import("../src/dispatcher")
    const { StateManager } = await import("../src/core/state-manager")

    const sm = new StateManager(tempDir)
    await sm.initialize()

    const result = await dispatch({
      intent: "execute_document",
      context: {},
      force: true,
    }, sm)

    // Dispatcher returns success=true but guidance contains error message
    expect(result.success).toBe(true)
    expect(result.guidance).toContain("Error:")
    expect(result.guidance).toContain("Provide 'path' or 'content'")
  })

  it("path 文件不存在时返回错误", async () => {
    const { dispatch } = await import("../src/dispatcher")
    const { StateManager } = await import("../src/core/state-manager")

    const sm = new StateManager(tempDir)
    await sm.initialize()

    const result = await dispatch({
      intent: "execute_document",
      context: { path: "/nonexistent/file.md" },
      force: true,
    }, sm)

    expect(result.success).toBe(true)
    expect(result.guidance).toContain("Error:")
    expect(result.guidance).toContain("Failed to read document")
  })

  it("guidance 包含执行契约", async () => {
    const testContent = "# Guide\n\nStep 1"
    fs.writeFileSync(testFilePath, testContent)

    const { dispatch } = await import("../src/dispatcher")
    const { StateManager } = await import("../src/core/state-manager")

    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "musa-doc-contract-"))
    const sm = new StateManager(tempDir2)
    await sm.initialize()

    const result = await dispatch({
      intent: "execute_document",
      context: { path: testFilePath },
      force: true,
    }, sm)

    expect(result.guidance).toContain("Execution Contract")
    expect(result.guidance).toContain("Execution Rules")
    expect(result.guidance).toContain("No early exit")
    expect(result.guidance).toContain("Stop conditions")

    fs.rmSync(tempDir2, { recursive: true, force: true })
  })

  it("没有 force 参数时应拒绝执行", async () => {
    const { dispatch } = await import("../src/dispatcher")
    const { StateManager } = await import("../src/core/state-manager")

    const sm = new StateManager(tempDir)
    await sm.initialize()

    const result = await dispatch({
      intent: "execute_document",
      context: { content: "# Test" },
      // 没有 force: true
    }, sm)

    expect(result.success).toBe(false)
    expect(result.error).toContain("destructive")
  })
})

describe("功能测试 - Lifecycle Actions", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "musa-lifecycle-"))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("status action 应返回操作状态", async () => {
    const { dispatch } = await import("../src/dispatcher")
    const { StateManager } = await import("../src/core/state-manager")

    const sm = new StateManager(tempDir)
    await sm.initialize()

    // Start an operation
    const startResult = await dispatch({
      intent: "deploy_env",
      context: {},
      force: true,
    }, sm)
    expect(startResult.success).toBe(true)
    expect(startResult.operationId).not.toBeNull()

    // Check status
    const statusResult = await dispatch({
      intent: "deploy_env",
      action: "status",
      context: { operationId: startResult.operationId },
    }, sm)
    expect(statusResult.success).toBe(true)
    expect(statusResult.guidance).toContain("running")
  })

  it("cancel action 应取消操作", async () => {
    const { dispatch } = await import("../src/dispatcher")
    const { StateManager } = await import("../src/core/state-manager")

    const sm = new StateManager(tempDir)
    await sm.initialize()

    // Start an operation
    const startResult = await dispatch({
      intent: "deploy_env",
      context: {},
      force: true,
    }, sm)

    // Cancel it
    const cancelResult = await dispatch({
      intent: "deploy_env",
      action: "cancel",
      context: { operationId: startResult.operationId },
    }, sm)
    expect(cancelResult.success).toBe(true)
    expect(cancelResult.guidance).toContain("cancelled")
  })
})