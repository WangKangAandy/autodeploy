# MUSA 测试知识库

这是用于测试 memory search extraPaths 功能的临时文档。

## 关键信息

- **MUSA SDK 版本**: 4.3.5
- **驱动版本**: 3.3.5
- **默认容器镜像**: sh-harbor.mthreads.com/mcctest/musa-train:4.3.5_kuae2.1_torch2.9_deb_2026-03-02_ubuntu

## 快速命令

```bash
# 检查 GPU 状态
mthreads-gmi

# 验证容器环境
docker run --rm --env MTHREADS_VISIBLE_DEVICES=all \
  registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi
```

---
*该文档位于 knowledge/ 目录，用于验证 extraPaths 配置*