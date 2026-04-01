---
version: 1
name: manage_container_images
description: Pull, push, export, and manage Docker container images.

category: assets
kind: atomic
exposure: internal
risk_level: idempotent
execution_mode: remote

owners:
  - assets-team

triggers:
  - pull image
  - push image
  - docker pull
  - 拉取镜像
---

# Manage Container Images

Manages Docker container images for MUSA workloads.

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `action` | `pull`, `push`, `export`, `import`, `list`, `remove` | Yes | - |
| `image` | Image name (e.g., `repo/image:tag`) | Yes* | - |
| `registry` | Target registry (for push) | No | - |
| `output` | Output file (for export) | No | - |

*Required for all actions except `list`

## Workflow

### Pull Image

```bash
docker pull "$IMAGE"
```

---

### Push Image

```bash
if [ -n "$REGISTRY" ]; then
    docker tag "$IMAGE" "$REGISTRY/$IMAGE"
    docker push "$REGISTRY/$IMAGE"
else
    docker push "$IMAGE"
fi
```

---

### Export Image

```bash
docker save -o "${OUTPUT:-image.tar}" "$IMAGE"
```

---

### Import Image

```bash
docker load -i "$INPUT"
```

---

### List Images

```bash
docker images
```

---

### Remove Image

```bash
docker rmi "$IMAGE"
```

## Success Criteria

- Command exits with code 0
- Image appears in `docker images` (pull/import)
- File exists (export)

## Troubleshooting

1. **Pull fails** - Check registry credentials and network
2. **Push denied** - Run `docker login` first
3. **No space** - Remove unused images: `docker image prune`