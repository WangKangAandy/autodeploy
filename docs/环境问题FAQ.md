# 环境问题 FAQ

本文记录 MUSA SDK 部署和容器环境验证中已经确认过的环境类问题，重点覆盖“现象看起来像驱动或 SDK 问题，但根因实际在镜像、容器运行时或一次性环境状态”的场景。

如果问题出现在容器验证阶段，先结合 `references/container-validation-runbook.md` 逐层排查，再回到这里查找已知症状和临时修复方式。

## FAQ 1: 容器内 `libmusa.so.4.3.1` 是 0 字节，`import torch` 报 `file too short`

### 现象

- 在容器里执行 `python -c "import torch"` 直接失败
- 报错类似：`ImportError: /usr/lib/x86_64-linux-gnu/libmusa.so.4: file too short`
- `musaInfo` 可能成功，也可能失败，取决于镜像中其他运行时组件状态

### 快速判断

先检查容器内库文件和软链：

```bash
docker exec "$CONTAINER_NAME" bash -lc 'ls -l /usr/lib/x86_64-linux-gnu/libmusa.so* /lib/x86_64-linux-gnu/libmusa.so*'
docker exec "$CONTAINER_NAME" bash -lc 'stat /usr/lib/x86_64-linux-gnu/libmusa.so.4.3.1 /lib/x86_64-linux-gnu/libmusa.so.4.3.1'
```

如果 `libmusa.so.4.3.1` 大小为 `0`，就不是宿主机驱动问题，而是镜像内库文件损坏。

### 根因

- 镜像构建产物异常
- 镜像内 `libmusa.so.4.3.1` 被错误打包成空文件
- 容器标签可拉取，但不代表其运行时库完整可用

### 临时修复

如果宿主机上对应版本的 `libmusa.so.4.3.1` 正常，可以先复制到运行中的测试容器里再验证：

```bash
docker cp /usr/lib/x86_64-linux-gnu/libmusa.so.4.3.1 "$CONTAINER_NAME":/tmp/libmusa.so.4.3.1.host
docker exec "$CONTAINER_NAME" bash -lc '
  cp -f /tmp/libmusa.so.4.3.1.host /usr/lib/x86_64-linux-gnu/libmusa.so.4.3.1 && \
  cp -f /tmp/libmusa.so.4.3.1.host /lib/x86_64-linux-gnu/libmusa.so.4.3.1 && \
  sync
'
```

修复后重新执行 `musaInfo`、`import torch` 和基础张量算子验证。

### 长期修复

- 优先更换镜像，不要把坏镜像继续作为默认验证镜像
- 在兼容映射或技能文档中标记该镜像存在坏库问题
- 如必须复用该镜像，可额外维护一个带修复的衍生镜像或启动后热修复脚本

### 适用范围

此方法仅适用于“容器内 `libmusa.so` 文件损坏”的场景，不适用于真实的驱动版本不兼容或 `torch_musa` 架构不匹配。

## FAQ 2: `torch.musa.is_available()` 为 `True`，但基础算子报 `invalid device function`

### 现象

- `torch.musa.is_available()` 返回 `True`
- `musaInfo` 可正常输出设备信息
- 但执行 `torch.tensor([1.0], device="musa") + 1` 等基础算子时报 `invalid device function`

### 快速判断

在容器中执行：

```bash
docker exec "$CONTAINER_NAME" bash -lc 'python - <<"PY"
import torch
import torch_musa
print("arch list", getattr(torch.musa, "get_arch_list", lambda: "n/a")())
print("device capability", torch.musa.get_device_capability(0))
PY'
```

如果 `torch.musa.get_arch_list()` 与当前 GPU capability 明显不匹配，就应优先怀疑镜像中的 `torch_musa` 不是给当前 GPU 架构编译的。

### 根因

- 镜像内 `torch_musa` 编译目标架构和当前 GPU 不匹配
- 某些算子在 `is_available()` 阶段不会暴露问题，只有真正执行 kernel 才会失败
- 也可能与镜像内运行时库损坏叠加出现

### 临时修复

- 更换与当前 GPU 架构匹配的验证镜像
- 如果同时发现 `libmusa.so.4.3.1` 为 0 字节，先按 FAQ 1 修复后再重试，避免把坏库误判成纯架构问题

### 长期修复

- 在 SDK/driver/image 兼容映射中维护经过验证的镜像列表
- 容器验证不要只检查 `torch.musa.is_available()`，必须包含一次基础张量算子

### 适用范围

该问题常见于“镜像可启动、MUSA 可见、但 PyTorch MUSA 实际不可执行”的场景。

## FAQ 3: 驱动切换后第一次 `mthreads-gmi` 报 `failed to initialize mtml`

### 现象

- 刚完成驱动安装和 `modprobe` 重载后，第一次执行 `mthreads-gmi` 报 `failed to initialize mtml`
- 再执行一次时恢复正常

### 快速判断

先立即重试一次：

```bash
mthreads-gmi
```

如果第二次成功，按瞬时初始化问题处理，不要立刻扩大为持久性故障。

### 根因

- 驱动重载后的短暂初始化窗口
- MTML 尚未完全完成初始化

### 临时修复

- 立即重试一次 `mthreads-gmi`
- 如果第二次仍失败，再继续检查驱动加载、包版本和内核模块状态

### 长期修复

- 在技能流程里固定加入“首次 `mtml` 初始化失败时重试一次”的规则

### 适用范围

适用于驱动安装或切换完成后的首次主机验证，不适用于容器内 PyTorch 算子问题。
