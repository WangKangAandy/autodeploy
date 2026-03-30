# auto-musify 集成到 autodeploy 方案

## 一、集成方式

### 方式 A: Git Submodule（推荐）

```bash
# 在 autodeploy 仓库根目录执行
cd /home/wangkang/桌面/repo/test/autodeploy
git submodule add https://<repo-url>/auto-musify.git auto-musify
git commit -m "feat: add auto-musify as submodule for CUDA-to-MUSA migration"
```

**优点**:
- 保持两个仓库独立版本控制
- 可以锁定 auto-musify 的特定版本
- 更新方便: `git submodule update --remote`

**缺点**:
- 克隆时需要 `--recursive` 参数
- 子模块操作相对复杂

### 方式 B: Git Subtree

```bash
cd /home/wangkang/桌面/repo/test/autodeploy
git subtree add --prefix=auto-musify https://<repo-url>/auto-musify.git main
```

**优点**:
- 代码直接嵌入，克隆简单
- 不需要额外参数

**缺点**:
- 更新操作较复杂
- 历史记录混合

### 方式 C: 复制核心文件

直接复制 auto-musify 中的关键文件:
```
autodeploy/
├── skills/              # 已有的 skills 目录
│   └── auto-musify/     # 新增：auto-musify 的 skills
│       ├── musa-read-cuda-deps/
│       ├── musa-adapt-code/
│       ├── musa-adapt-build/
│       ├── musa-adapt-fix/
│       └── ...
└── references/
    └── musify-guide.md  # 新增：MUSA 适配指南
```

## 二、推荐目录结构

```
autodeploy/
├── auto-musify/         # 子模块
│   ├── agents/
│   ├── skills/
│   ├── patches/
│   └── references/
├── skills/              # autodeploy 原有 skills
│   ├── deploy_musa_base_env/
│   ├── update_musa_driver/
│   └── ...
└── CLAUDE.md            # 主 CLAUDE.md，引用 auto-musify
```

## 三、CLAUDE.md 集成

在 autodeploy 的 CLAUDE.md 中添加引用:

```markdown
## CUDA-to-MUSA Migration Tools

This repository integrates [auto-musify](./auto-musify/) for automated CUDA-to-MUSA migration.

### Available Migration Skills

| Skill | Description | Location |
|-------|-------------|----------|
| musa-read-cuda-deps | Scan CUDA dependencies | auto-musify/skills/musa-read-cuda-deps |
| musa-adapt-code | Convert CUDA code to MUSA | auto-musify/skills/musa-adapt-code |
| musa-adapt-build | Build MUSA project | auto-musify/skills/musa-adapt-build |
| musa-adapt-fix | Fix build/runtime errors | auto-musify/skills/musa-adapt-fix |

### Usage

For CUDA-to-MUSA migration tasks, invoke skills from the auto-musify submodule:

\`\`\`
/auto-musify migrate --repo https://github.com/org/project.git
\`\`\`
```

## 四、配置文件更新

### 4.1 skills/index.yml 扩展

```yaml
# 添加 auto-musify skills 引用
- name: musify-project
  description: Migrate CUDA project to MUSA
  type: meta
  triggers:
    - "migrate to musa"
    - "cuda to musa"
    - "适配 MUSA"
  steps:
    - skill: auto-musify/musa-read-cuda-deps
    - skill: auto-musify/musa-adapt-code
    - skill: auto-musify/musa-adapt-build
```

## 五、初始化命令

```bash
# 克隆 autodeploy 及其子模块
git clone --recursive https://<repo-url>/autodeploy.git

# 或在已有仓库中初始化子模块
git submodule init
git submodule update
```

## 六、版本锁定

```bash
# 锁定 auto-musify 到特定提交
cd auto-musify
git checkout <commit-hash>
cd ..
git add auto-musify
git commit -m "chore: pin auto-musify to version X.Y.Z"
```