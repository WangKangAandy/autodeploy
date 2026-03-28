# Skills 文档

## User-Facing Skills

| Skill | Description | Dispatch Intent |
|-------|-------------|-----------------|
| `deploy_musa_base_env` | 完整 MUSA 环境部署 | `deploy_env` |
| `update_musa_driver` | 驱动更新/重装 | `update_driver` |
| `prepare_model_artifacts` | 下载/验证模型 | `prepare_model` |
| `prepare_dataset_artifacts` | 下载/验证数据集 | `prepare_dataset` |
| `prepare_musa_package` | 下载 MUSA 安装包 | `prepare_package` |
| `prepare_dependency_repo` | 克隆/更新仓库 | `prepare_repo` |

## Internal Skills

| Skill | Purpose |
|-------|---------|
| `ensure_system_dependencies` | 安装系统依赖 |
| `ensure_musa_driver` | 安装 MUSA 驱动 |
| `ensure_mt_container_toolkit` | 安装容器工具包 |
| `manage_container_images` | 管理容器镜像 |
| `validate_musa_container_environment` | 验证容器环境 |

## 主要文件

- `skills/index.yml` - Skill 索引定义
- `skills/**/SKILL.md` - 各类 skill 定义文件

---

> 详细定义见 `skills/index.yml`。本文档仅保留摘要。