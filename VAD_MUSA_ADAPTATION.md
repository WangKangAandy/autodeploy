# VAD 项目 MUSA 适配记录

## 项目概述

- **项目**: VAD (Vectorized Scene Representation for Efficient Autonomous Driving)
- **源码**: https://github.com/hustvl/VAD.git
- **目标**: 在 MUSA GPU 上运行 VAD 推理

## 环境信息

### 远程机器
- **Host**: 10.10.142.191
- **User**: mccxadmin
- **Password**: mt@142191!
- **Container**: torch_musa_test

### 软件版本
- Python: 3.10.12
- PyTorch: 2.9.0
- torch_musa: 2.9.0+f4f0279
- MUSA devices: 8 GPUs

### 依赖库状态

| 库 | 版本 | MUSA 支持 | 状态 |
|---|---|---|---|
| mmcv-full | 1.4.0 | ✅ 已编译 | _ext.so 可用 |
| mmdet | 2.14.0 | ✅ 纯 Python | 无需编译 |
| mmsegmentation | 0.14.1 | ✅ 纯 Python | 无需编译 |
| mmdet3d | 需要 v0.17.1 或 main_musa | ⚠️ 需要编译 | 扩展未编译 |

## 已完成的适配工作

### 1. mmcv-full MUSA 编译

```bash
cd /data/wenxing.wang/mmcv_ai
MMCV_WITH_MUSA=1 python setup.py build_ext --inplace
```

编译成功，生成了 `/data/wenxing.wang/mmcv_ai/mmcv/_ext.cpython-310-x86_64-linux-gnu.so`

### 2. VAD 项目 MUSA 代码修改

VAD 项目已有部分 MUSA 适配修改，主要修改点：

| 文件 | 修改内容 |
|---|---|
| `projects/mmdet3d_plugin/VAD/modules/multi_scale_deformable_attn_function.py` | `from torch.musa.amp` → `from torch_musa.core.amp` |
| `projects/mmdet3d_plugin/bevformer/modules/multi_scale_deformable_attn_function.py` | 同上 |
| `projects/mmdet3d_plugin/VAD/modules/encoder.py` | `device='cuda'` → `device='musa'` |
| 其他文件 | 类似的 torch.cuda → torch.musa 替换 |

## 当前问题

### 问题 1: mmdet3d 扩展未编译

mmdet3d 需要 CUDA/MUSA 扩展 (ball_query, iou3d 等)，但当前未编译。

**解决方案选项**:

1. **使用 main_musa 分支并编译**
   ```bash
   cd /data/wenxing.wang/mmdetection3d
   git checkout main_musa
   FORCE_MUSA=1 python setup.py build_ext --inplace
   ```

2. **使用 mmcv 提供的 ops**
   mmcv-full 1.4.0 已包含部分 3D 操作 (iou3d, nms3d 等)，可以修改 mmdet3d 导入路径

### 问题 2: 版本兼容性

VAD 要求:
- mmcv-full 1.4.0 ✅
- mmdet 2.14.0 ✅
- mmdet3d 0.17.1 ⚠️ (与 main_musa 分支版本不同)

main_musa 分支是基于更新版本的 mmdet3d，可能有 API 变化。

## 关键发现

### torch.musa 导入问题

**问题**: `from torch.musa.amp import ...` 需要先 `import torch_musa`

**解决方案**: 改用 `from torch_musa.core.amp import ...`

```python
# 错误
import torch
from torch.musa.amp import custom_bwd, custom_fwd  # ModuleNotFoundError

# 正确
import torch_musa
from torch_musa.core.amp import custom_bwd, custom_fwd  # OK
```

### PYTHONPATH 设置

运行 VAD 需要设置正确的 PYTHONPATH:

```bash
export PYTHONPATH=/data/wenxing.wang/mmcv_ai:/data/wenxing.wang/mmdetection3d:$PYTHONPATH
```

## 关键发现：版本兼容性问题

### mmdet3d 版本冲突

**核心问题**: VAD 需要的依赖版本与 MUSA 支持的版本不兼容

| 项目 | VAD 需求 | MUSA 版本 | 兼容性 |
|---|---|---|---|
| mmcv | 1.4.0 | 1.4.0 (已编译 MUSA) | ✅ |
| mmdet | 2.14.0 | 2.14.0 | ✅ |
| mmdet3d | 0.17.1 | main_musa (需要 mmcv 2.0+) | ❌ |

**mmdet3d v0.17.1** 需要 CUDA 扩展，但没有 MUSA 支持
**mmdet3d main_musa** 有 MUSA 支持，但需要 mmcv 2.0+，与 VAD 不兼容

### 解决方案

**方案 A: 为 mmdet3d v0.17.1 添加 MUSA 支持**
1. 从 main_musa 分支提取 MUSA 相关修改
2. 移植到 v0.17.1
3. 编译 MUSA 扩展

**方案 B: 升级 VAD 依赖**
1. 修改 VAD 代码以适配新版 mmdet3d API
2. 使用 mmcv 2.0+ 和 mmdet3d main_musa

**方案 C: 使用 mmcv ops 替代**
1. mmcv 1.4.0 已有 iou3d, nms3d 等 ops
2. 修改 mmdet3d v0.17.1 的导入路径

## auto-musify 集成方案

### 作为子仓库集成

如果适配成功，可以将 `auto-musify` 作为 `autodeploy` 的子仓库：

```bash
cd /home/wangkang/桌面/repo/test/autodeploy
git submodule add ../auto-musify auto-musify
```

### 集成后的好处

1. **共享远程执行工具**: auto-musify 的 skills 可复用 autodeploy 的远程执行能力
2. **统一适配流程**: auto-musify 的 skills 提供标准化的 CUDA→MUSA 适配流程
3. **知识库共享**: 适配经验可存储在 auto-musify 的 references 中

### 建议的目录结构

```
autodeploy/
├── auto-musify/          # 子模块
│   ├── skills/           # MUSA 适配 skills
│   ├── agents/           # 多智能体定义
│   └── references/       # 参考文档
├── src/                  # OpenClaw 插件代码
├── skills/               # 环境部署 skills
└── references/           # 部署参考文档
```

### 关键 skill 复用

| auto-musify skill | 用途 | 在 autodeploy 中的应用 |
|---|---|---|
| musa-adapt-code | 代码转换 | CUDA 项目的 MUSA 移植 |
| musa-adapt-build | 编译适配 | CUDA 扩展的 MUSA 编译 |
| musa-adapt-fix | 错误修复 | 编译/运行错误处理 |
| musa-read-full-code | 代码分析 | CUDA 依赖扫描 |

## mmdet3d v0.17.1 MUSA 适配进展

### 已完成的工作

1. **创建 MUSA 源文件**
   - 将 16 个 `.cu` 文件转换为 `.mu` 文件
   - 转换位置：`mmdet3d/ops/*/src/*.mu`

2. **创建 MUSA 编译脚本**
   - `setup_musa_simple.py` - 简化版，跳过复杂的 spconv 模块
   - `adapt_musa.py` - CUDA 到 MUSA 自动转换脚本
   - `fix_all_musa.py` - 全面修复脚本

3. **代码修改**
   - CUDA API 替换：`cudaMalloc` → `musaMalloc` 等
   - 头文件替换：`cuda_runtime.h` → `musa_runtime.h`
   - ATen 命名空间：`at::cuda::` → `at::musa::`
   - 宏替换：`__CUDA_ARCH__` → `__MUSA_ARCH__`

### 当前编译错误

```
error: no member named 'ATenCeilDiv' in namespace 'at::musa'
```

需要进一步修复 ATen API 兼容性问题。

### 修改的文件列表

| 类型 | 文件数 | 状态 |
|---|---|---|
| .mu 文件 | 16 | 已转换 |
| .cpp 文件 | ~10 | 部分修复 |
| .h 头文件 | ~20 | 已修复 |

### 后续工作

1. 修复 `at::musa::ATenCeilDiv` 等缺失函数
2. 完成 voxel 模块编译
3. 编译其他 ops 模块 (ball_query, iou3d, etc.)
4. 验证 VAD 项目运行

## 文件路径参考

| 文件/目录 | 路径 |
|---|---|
| mmcv MUSA 版本 | /data/wenxing.wang/mmcv_ai |
| mmdet3d | /data/wenxing.wang/mmdetection3d |
| mmdet3d MUSA 分支 | v0.17.1-musa |
| VAD 项目 | /workspace/VAD |
| auto-musify | /home/wangkang/桌面/repo/test/auto-musify |
| 适配记录 | /home/wangkang/桌面/repo/test/autodeploy/VAD_MUSA_ADAPTATION.md |
