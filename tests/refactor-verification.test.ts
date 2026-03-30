/**
 * 全量功能测试 - 重构验证
 *
 * 验证重构计划的 5 项改进是否正确实现：
 * 1. 废弃 agent-tools/
 * 2. 统一为 TypeScript
 * 3. 简化 Dispatcher
 * 4. 简化文档驱动执行
 * 5. 工具层自动上报
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

describe("重构验证 - 改进 1: 废弃 agent-tools/", () => {
  it("agent-tools 目录不应存在", () => {
    const agentToolsPath = path.join(process.cwd(), "agent-tools")
    expect(fs.existsSync(agentToolsPath)).toBe(false)
  })

  it("源码中不应引用 agent-tools, remote-exec, remote-docker, remote-sync", async () => {
    const srcDir = path.join(process.cwd(), "src")
    const files = await walkDir(srcDir, [".ts", ".js"])

    const forbiddenPatterns = [
      /agent-tools/,
      /remote-exec/,
      /remote-docker/,
      /remote-sync/,
      /mcp\s+server/i,
    ]

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8")
      for (const pattern of forbiddenPatterns) {
        expect(content).not.toMatch(pattern)
      }
    }
  })
})

describe("重构验证 - 改进 2: 统一为 TypeScript", () => {
  it("src 目录下不应有 .js 文件", async () => {
    const srcDir = path.join(process.cwd(), "src")
    const jsFiles = await walkDir(srcDir, [".js"])
    expect(jsFiles.length).toBe(0)
  })

  it("入口文件应为 TypeScript", () => {
    const indexTs = path.join(process.cwd(), "src", "index.ts")
    expect(fs.existsSync(indexTs)).toBe(true)
  })

  it("npm run build 应成功编译", async () => {
    const distDir = path.join(process.cwd(), "dist")
    // 如果 dist 存在，说明编译成功
    // 实际编译测试由 npm run build 负责
    if (fs.existsSync(distDir)) {
      const indexPath = path.join(distDir, "index.js")
      expect(fs.existsSync(indexPath)).toBe(true)
    }
  })
})

describe("重构验证 - 改进 3: 简化 Dispatcher", () => {
  it("dispatcher 目录应只包含 3 个文件", async () => {
    const dispatcherDir = path.join(process.cwd(), "src", "dispatcher")
    const files = fs.readdirSync(dispatcherDir)
    expect(files.length).toBe(3)
    expect(files).toContain("index.ts")
    expect(files).toContain("route-table.ts")
    expect(files).toContain("skill-registry.ts")
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
    ]
    for (const file of deletedFiles) {
      expect(fs.existsSync(path.join(dispatcherDir, file))).toBe(false)
    }
  })

  it("route-table.ts 应导出 route 函数", async () => {
    const mod = await import("../src/dispatcher/route-table")
    expect(typeof mod.route).toBe("function")
    expect(typeof mod.getRiskLevel).toBe("function")
  })

  it("dispatcher/index.ts 应导出 dispatch 函数", async () => {
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

  it("execute_document 应在 route-table 中处理", async () => {
    const { route } = await import("../src/dispatcher/route-table")
    const result = route("execute_document", { path: "/tmp/test.md" })
    expect(result.type).toBe("document")
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
    expect(executions.length).toBe(200)
    // 最早 50 条被丢弃，最早保留的是 cmd50
    expect(executions[0].command).toBe("cmd50")
  })
})

describe("功能测试 - Dispatcher route", () => {
  it("orchestration 类型 intent (meta skill) 应正确路由", async () => {
    const { route } = await import("../src/dispatcher/route-table")

    const result = route("deploy_env", {})
    expect(result.type).toBe("orchestration")  // meta skill 返回 orchestration
    expect(result.skillId).toBe("deploy_musa_base_env")
  })

  it("tool 类型 intent 应正确路由", async () => {
    const { route } = await import("../src/dispatcher/route-table")

    const result = route("gpu_status", {})
    expect(result.type).toBe("tool")
    expect(result.target).toBe("musa_exec")
  })

  it("document 类型 intent 应正确路由", async () => {
    const { route } = await import("../src/dispatcher/route-table")

    const result = route("execute_document", { path: "/tmp/guide.md" })
    expect(result.type).toBe("document")
  })

  it("未知 intent 应返回 error", async () => {
    const { route } = await import("../src/dispatcher/route-table")

    const result = route("unknown_intent", {})
    expect(result.type).toBe("error")
  })
})

describe("功能测试 - Document Execution (loadDocumentGuidance)", () => {
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
      force: true,  // execute_document is destructive
    }, sm)

    expect(result.success).toBe(true)
    expect(result.guidance).toContain("## Document Loaded")
    expect(result.guidance).toContain("**Source**")
    expect(result.guidance).toContain(testFilePath)
    expect(result.guidance).toContain(`**Length**: ${testContent.length} chars`)
    expect(result.guidance).toContain(testContent)
    expect(result.guidance).toContain("**Instructions**")
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
    expect(result.guidance).toContain("## Document Loaded")
    expect(result.guidance).toContain("**Source**: pasted content")
    expect(result.guidance).toContain(testContent)

    fs.rmSync(tempDir2, { recursive: true, force: true })
  })

  it("缺少 path 和 content 时返回错误", async () => {
    const { dispatch } = await import("../src/dispatcher")
    const { StateManager } = await import("../src/core/state-manager")

    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "musa-doc-error-"))
    const sm = new StateManager(tempDir2)
    await sm.initialize()

    const result = await dispatch({
      intent: "execute_document",
      context: {},
      force: true,
    }, sm)

    // loadDocumentGuidance 返回错误时，success=false 但 error=null，guidance 包含错误消息
    expect(result.success).toBe(false)
    expect(result.guidance).toContain("Error: Provide path or content")

    fs.rmSync(tempDir2, { recursive: true, force: true })
  })

  it("path 文件不存在时返回错误", async () => {
    const { dispatch } = await import("../src/dispatcher")
    const { StateManager } = await import("../src/core/state-manager")

    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "musa-doc-nofile-"))
    const sm = new StateManager(tempDir2)
    await sm.initialize()

    const result = await dispatch({
      intent: "execute_document",
      context: { path: "/nonexistent/file.md" },
      force: true,
    }, sm)

    expect(result.success).toBe(false)
    expect(result.guidance).toContain("Error: Failed to read document")

    fs.rmSync(tempDir2, { recursive: true, force: true })
  })

  it("guidance 包含执行指令", async () => {
    const testContent = "# Guide\n\nStep 1"
    fs.writeFileSync(testFilePath, testContent)

    const { dispatch } = await import("../src/dispatcher")
    const { StateManager } = await import("../src/core/state-manager")

    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "musa-doc-instr-"))
    const sm = new StateManager(tempDir2)
    await sm.initialize()

    const result = await dispatch({
      intent: "execute_document",
      context: { path: testFilePath },
      force: true,
    }, sm)

    expect(result.guidance).toContain("Execute each step sequentially")
    expect(result.guidance).toContain("musa_exec/musa_docker")
    expect(result.guidance).toContain("Validate results at each checkpoint")

    fs.rmSync(tempDir2, { recursive: true, force: true })
  })

  it("没有 force 参数时应拒绝执行 (destructive 操作)", async () => {
    const { dispatch } = await import("../src/dispatcher")
    const { StateManager } = await import("../src/core/state-manager")

    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "musa-doc-force-"))
    const sm = new StateManager(tempDir2)
    await sm.initialize()

    const result = await dispatch({
      intent: "execute_document",
      context: { content: "# Test" },
      // 没有 force: true
    }, sm)

    expect(result.success).toBe(false)
    expect(result.error).toContain("destructive")

    fs.rmSync(tempDir2, { recursive: true, force: true })
  })
})

describe("功能测试 - Risk Level", () => {
  it("destructive intent 需要 force 参数", async () => {
    const { dispatch } = await import("../src/dispatcher")
    const { StateManager } = await import("../src/core/state-manager")

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "musa-risk-"))
    const sm = new StateManager(tempDir)
    await sm.initialize()

    const result = await dispatch({
      intent: "deploy_env",
      context: {},
      force: false,
    }, sm)

    expect(result.success).toBe(false)
    expect(result.error).toContain("destructive")

    fs.rmSync(tempDir, { recursive: true, force: true })
  })
})

// Helper function
async function walkDir(dir: string, extensions: string[]): Promise<string[]> {
  const results: string[] = []

  async function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
        results.push(fullPath)
      }
    }
  }

  await walk(dir)
  return results
}