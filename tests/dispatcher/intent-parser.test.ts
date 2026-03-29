/**
 * Intent Parser Tests
 */

import { describe, it, expect } from "vitest"
import {
  parseIntent,
  parseIntentWithContext,
  getIntentDescription,
  getIntentSkillPath,
} from "../../src/dispatcher/intent-parser"
import {
  getSkillPath,
  getSkillCategory,
} from "../../src/dispatcher/skill-registry"

describe("parseIntent", () => {
  it("should parse deploy_env intent from Chinese", () => {
    expect(parseIntent("部署 MUSA 环境")).toBe("deploy_env")
    expect(parseIntent("安装 MUSA SDK")).toBe("deploy_env")
    expect(parseIntent("完整环境部署")).toBe("deploy_env")
  })

  it("should parse deploy_env intent from English", () => {
    expect(parseIntent("install MUSA SDK")).toBe("deploy_env")
    expect(parseIntent("setup MUSA environment")).toBe("deploy_env")
    expect(parseIntent("full MUSA setup")).toBe("deploy_env")
  })

  it("should parse update_driver intent", () => {
    expect(parseIntent("更新驱动")).toBe("update_driver")
    expect(parseIntent("upgrade driver")).toBe("update_driver")
    expect(parseIntent("reinstall driver")).toBe("update_driver")
    expect(parseIntent("降级驱动")).toBe("update_driver")
    expect(parseIntent("重装驱动")).toBe("update_driver")
  })

  it("should parse gpu_status intent", () => {
    expect(parseIntent("GPU 状态")).toBe("gpu_status")
    expect(parseIntent("mthreads-gmi")).toBe("gpu_status")
    expect(parseIntent("check gpu info")).toBe("gpu_status")
    expect(parseIntent("查看 GPU")).toBe("gpu_status")
  })

  it("should parse run_container intent", () => {
    expect(parseIntent("run container")).toBe("run_container")
    expect(parseIntent("启动容器")).toBe("run_container")
    expect(parseIntent("docker run")).toBe("run_container")
  })

  it("should parse validate intent", () => {
    expect(parseIntent("验证环境")).toBe("validate")
    expect(parseIntent("validate")).toBe("validate")
    expect(parseIntent("test musa")).toBe("validate")
    expect(parseIntent("检查环境")).toBe("validate")
  })

  it("should parse sync intent", () => {
    expect(parseIntent("sync files")).toBe("sync")
    expect(parseIntent("传输文件")).toBe("sync")
    expect(parseIntent("上传")).toBe("sync")
    expect(parseIntent("下载文件")).toBe("sync")
    expect(parseIntent("同步文件")).toBe("sync")
  })

  it("should parse execute_document intent (Layer 3 fallback)", () => {
    expect(parseIntent("按文档部署")).toBe("execute_document")
    expect(parseIntent("执行文档")).toBe("execute_document")
    expect(parseIntent("根据文档部署")).toBe("execute_document")
    expect(parseIntent("document execution")).toBe("execute_document")
  })

  it("should parse prepare_model intent", () => {
    expect(parseIntent("下载模型")).toBe("prepare_model")
    expect(parseIntent("准备模型")).toBe("prepare_model")
    expect(parseIntent("download model")).toBe("prepare_model")
    expect(parseIntent("pull model")).toBe("prepare_model")
  })

  it("should parse prepare_dataset intent", () => {
    expect(parseIntent("下载数据集")).toBe("prepare_dataset")
    expect(parseIntent("准备数据集")).toBe("prepare_dataset")
    expect(parseIntent("download dataset")).toBe("prepare_dataset")
  })

  it("should parse prepare_package intent", () => {
    expect(parseIntent("下载驱动包")).toBe("prepare_package")
    expect(parseIntent("准备驱动包")).toBe("prepare_package")
    expect(parseIntent("下载 MUSA 包")).toBe("prepare_package")
  })

  it("should parse prepare_repo intent", () => {
    expect(parseIntent("克隆仓库")).toBe("prepare_repo")
    expect(parseIntent("准备代码")).toBe("prepare_repo")
    expect(parseIntent("clone repo")).toBe("prepare_repo")
    expect(parseIntent("git clone")).toBe("prepare_repo")
  })

  it("should return auto for unknown intents", () => {
    expect(parseIntent("hello world")).toBe("auto")
    expect(parseIntent("random text")).toBe("auto")
    expect(parseIntent("")).toBe("auto")
  })
})

describe("execute_document scoring system (Layer 1)", () => {
  describe("Strong hits (score >= 5)", () => {
    it("should hit: absolute path + strong action", () => {
      // action (3) + absolute path (3) = 6 >= 5
      expect(parseIntent("执行 /tmp/deploy.md")).toBe("execute_document")
      expect(parseIntent("部署 /home/user/guide.md")).toBe("execute_document")
      expect(parseIntent("run /tmp/test.markdown")).toBe("execute_document")
    })

    it("should hit: relative path + strong action", () => {
      // action (3) + relative path (2) = 5 >= 5
      expect(parseIntent("执行 ./docs/deploy.md")).toBe("execute_document")
      expect(parseIntent("部署 ../config/guide.md")).toBe("execute_document")
    })

    it("should hit: context.path (absolute) + strong action", () => {
      // action (3) + absolute path from context (3) = 6 >= 5
      expect(parseIntentWithContext("执行", { path: "/tmp/deploy.md" })).toBe("execute_document")
      expect(parseIntentWithContext("部署", { path: "/home/user/guide.md" })).toBe("execute_document")
    })

    it("should hit: context.path (relative) + strong action", () => {
      // action (3) + relative path from context (2) = 5 >= 5
      expect(parseIntentWithContext("执行", { path: "./docs/deploy.md" })).toBe("execute_document")
      expect(parseIntentWithContext("部署", { path: "../config/guide.md" })).toBe("execute_document")
    })

    it("should hit: weak guide + exec-related word + relative path", () => {
      // weak guide (1) + exec-related (2) + relative path (2) = 5 >= 5
      expect(parseIntent("按照 ./guide.md 执行")).toBe("execute_document")
      expect(parseIntent("根据 ../deploy.md 部署")).toBe("execute_document")
    })

    it("should hit: weak guide + exec-related word + absolute path", () => {
      // weak guide (1) + exec-related (2) + absolute path (3) = 6 >= 5
      expect(parseIntent("根据 /tmp/deploy.md 部署")).toBe("execute_document")
    })
  })

  describe("Should NOT hit (score < 5)", () => {
    it("should NOT hit: path without action (no action = 0 score)", () => {
      // no action = 0 score (path not counted)
      expect(parseIntent("/tmp/deploy.md")).toBe("auto")
      expect(parseIntent("/home/user/guide.md")).toBe("auto")
      expect(parseIntent("./docs/deploy.md")).toBe("auto")
    })

    it("should NOT hit: path + non-exec action (no action = 0 score)", () => {
      // no action = 0 score (path not counted)
      expect(parseIntent("看一下 /tmp/deploy.md")).toBe("auto")
      expect(parseIntent("总结 /home/user/guide.md")).toBe("auto")
      expect(parseIntent("解释 README.md 内容")).toBe("auto")
    })

    it("should NOT hit: bare filename + strong action", () => {
      // action (3) + bare filename (1) = 4 < 5
      expect(parseIntent("执行 deploy.md")).toBe("auto")
      expect(parseIntent("部署 guide.md")).toBe("auto")
    })

    it("should NOT hit: weak guide without exec-related word", () => {
      // weak guide (1) = 1 < 5 (no path counted because action score is too low)
      expect(parseIntent("根据 README.md 解释一下配置项")).toBe("auto")
      expect(parseIntent("按照 guide.md 总结流程")).toBe("auto")
    })

    it("should NOT hit: weak guide + exec-related + bare filename", () => {
      // weak guide (1) + exec-related (2) + bare filename (1) = 4 < 5
      expect(parseIntent("根据 deploy.md 部署")).toBe("auto")
      expect(parseIntent("按照 guide.md 执行")).toBe("auto")
    })

    it("should NOT hit: bare filename + weak action", () => {
      // no action = 0 score
      expect(parseIntent("这个 guide.md 怎么写")).toBe("auto")
    })
  })

  describe("Edge cases", () => {
    it("should handle .markdown extension", () => {
      expect(parseIntent("执行 /tmp/deploy.markdown")).toBe("execute_document")
      expect(parseIntent("部署 ./guide.markdown")).toBe("execute_document")
    })

    it("should not trigger on non-markdown paths", () => {
      expect(parseIntent("执行 /tmp/config.yml")).toBe("auto")
      expect(parseIntent("部署 config.json")).toBe("auto")
    })

    it("should work with context.content + action", () => {
      const markdownContent = `# Deployment Guide

\`\`\`bash
apt install docker
\`\`\`

- Step 1: Install driver
`
      // action (3) + markdown content (2) = 5 >= 5
      expect(parseIntentWithContext("执行", { content: markdownContent })).toBe("execute_document")
      expect(parseIntentWithContext("部署", { content: markdownContent })).toBe("execute_document")
    })

    it("should NOT trigger on markdown content without action", () => {
      const markdownContent = `# Deployment Guide

\`\`\`bash
apt install docker
\`\`\`
`
      // no action = 0 score
      expect(parseIntentWithContext("看一下", { content: markdownContent })).toBe("auto")
      expect(parseIntentWithContext("解释", { content: markdownContent })).toBe("auto")
    })
  })
})

describe("getIntentDescription", () => {
  it("should return description for skill-backed intents (from skill registry)", () => {
    expect(getIntentDescription("deploy_env")).toContain("MUSA environment")
    expect(getIntentDescription("update_driver")).toContain("driver")
    expect(getIntentDescription("prepare_model")).toContain("model")
    expect(getIntentDescription("prepare_dataset")).toContain("dataset")
    expect(getIntentDescription("prepare_package")).toContain("package")
    expect(getIntentDescription("prepare_repo")).toContain("repository")
  })

  it("should return description for non-skill intents (fallback)", () => {
    expect(getIntentDescription("gpu_status")).toContain("Check GPU status")
    expect(getIntentDescription("run_container")).toContain("Run a Docker container")
    expect(getIntentDescription("validate")).toContain("Validate MUSA")
    expect(getIntentDescription("sync")).toContain("Sync files")
    expect(getIntentDescription("execute_document")).toContain("Execute deployment plan")
    expect(getIntentDescription("auto")).toContain("Auto-detect")
  })
})

describe("getIntentSkillPath", () => {
  it("should return correct path for deploy_env", () => {
    const path = getIntentSkillPath("deploy_env")
    expect(path).toBe("skills/env/deploy_musa_base_env/SKILL.md")
  })

  it("should return correct path for update_driver", () => {
    const path = getIntentSkillPath("update_driver")
    expect(path).toBe("skills/env/update_musa_driver/SKILL.md")
  })

  it("should return correct paths for assets intents", () => {
    expect(getIntentSkillPath("prepare_model")).toBe("skills/assets/prepare_model_artifacts/SKILL.md")
    expect(getIntentSkillPath("prepare_dataset")).toBe("skills/assets/prepare_dataset_artifacts/SKILL.md")
    expect(getIntentSkillPath("prepare_package")).toBe("skills/assets/prepare_musa_package/SKILL.md")
    expect(getIntentSkillPath("prepare_repo")).toBe("skills/assets/prepare_dependency_repo/SKILL.md")
  })

  it("should return null for intents without skills", () => {
    expect(getIntentSkillPath("gpu_status")).toBeNull()
    expect(getIntentSkillPath("run_container")).toBeNull()
    expect(getIntentSkillPath("validate")).toBeNull()
    expect(getIntentSkillPath("sync")).toBeNull()
    expect(getIntentSkillPath("execute_document")).toBeNull()
    expect(getIntentSkillPath("auto")).toBeNull()
  })
})

describe("getSkillPath", () => {
  it("should return absolute paths for meta skills", () => {
    const path = getSkillPath("deploy_musa_base_env")
    expect(path).toContain("skills/env/deploy_musa_base_env/SKILL.md")
    expect(path).toMatch(/^\//)
  })

  it("should return absolute paths for atomic env skills", () => {
    expect(getSkillPath("ensure_system_dependencies")).toContain("skills/env/ensure_system_dependencies/SKILL.md")
    expect(getSkillPath("ensure_musa_driver")).toContain("skills/env/ensure_musa_driver/SKILL.md")
    expect(getSkillPath("ensure_mt_container_toolkit")).toContain("skills/env/ensure_mt_container_toolkit/SKILL.md")
    expect(getSkillPath("manage_container_images")).toContain("skills/assets/manage_container_images/SKILL.md")
    expect(getSkillPath("validate_musa_container_environment")).toContain("skills/env/validate_musa_container_environment/SKILL.md")
  })

  it("should return absolute paths for assets skills", () => {
    expect(getSkillPath("prepare_musa_package")).toContain("skills/assets/prepare_musa_package/SKILL.md")
    expect(getSkillPath("prepare_model_artifacts")).toContain("skills/assets/prepare_model_artifacts/SKILL.md")
    expect(getSkillPath("prepare_dataset_artifacts")).toContain("skills/assets/prepare_dataset_artifacts/SKILL.md")
    expect(getSkillPath("prepare_dependency_repo")).toContain("skills/assets/prepare_dependency_repo/SKILL.md")
  })

  it("should return null for unknown skill IDs", () => {
    expect(getSkillPath("unknown_skill")).toBeNull()
    expect(getSkillPath("")).toBeNull()
  })
})

describe("getSkillCategory", () => {
  it("should return env for env skills", () => {
    expect(getSkillCategory("deploy_musa_base_env")).toBe("env")
    expect(getSkillCategory("update_musa_driver")).toBe("env")
    expect(getSkillCategory("ensure_system_dependencies")).toBe("env")
    expect(getSkillCategory("ensure_musa_driver")).toBe("env")
    expect(getSkillCategory("ensure_mt_container_toolkit")).toBe("env")
    expect(getSkillCategory("validate_musa_container_environment")).toBe("env")
  })

  it("should return assets for assets skills", () => {
    expect(getSkillCategory("prepare_musa_package")).toBe("assets")
    expect(getSkillCategory("prepare_model_artifacts")).toBe("assets")
    expect(getSkillCategory("prepare_dataset_artifacts")).toBe("assets")
    expect(getSkillCategory("prepare_dependency_repo")).toBe("assets")
    expect(getSkillCategory("manage_container_images")).toBe("assets")
  })

  it("should return null for unknown skills", () => {
    expect(getSkillCategory("unknown_skill")).toBeNull()
  })
})