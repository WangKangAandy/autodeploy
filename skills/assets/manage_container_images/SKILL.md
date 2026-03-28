---
version: 1
name: manage_container_images
description: |
  Manage container images: pull, push, export, import, list, remove.
  Supports both public and private registries.

category: assets
kind: atomic
exposure: user
risk_level: idempotent
execution_mode: remote

owners:
  - assets-team

triggers:
  - pull image
  - push image
  - docker pull
  - docker push
  - export image
  - import image
  - save image
  - load image
  - list images
  - remove image
  - 拉取镜像
  - 推送镜像
  - 导出镜像
  - 导入镜像
  - 镜像列表
  - 删除镜像
  - 管理镜像

# Keep scope concise
scope:
  includes:
    - Pull images from registry
    - Push images to registry (including internal)
    - Export images to tar files
    - Import images from tar files
    - List local images
    - Remove images
  excludes:
    - Container lifecycle management
    - Image building (use Dockerfile)
    - Container runtime configuration
---

# Manage Container Images

This atomic skill manages Docker container images with support for multiple operations.

## Invocation

- **Exposure**: user
- **Top-level intent**: `manage_container_images`
- **Callable from orchestration**: Yes

### Invocation Examples

```
# Pull image
musa_dispatch(intent="manage_container_images", context={
  "action": "pull",
  "image": "sh-harbor.mthreads.com/mcctest/musa-train:4.3.5"
})

# Push image to internal registry
musa_dispatch(intent="manage_container_images", context={
  "action": "push",
  "image": "my-app:v1.0",
  "registry": "internal-registry.company.com"
})

# Export image to tar
musa_dispatch(intent="manage_container_images", context={
  "action": "export",
  "image": "my-model:latest",
  "outputPath": "/data/images/my-model.tar"
})

# List images
musa_dispatch(intent="manage_container_images", context={
  "action": "list"
})
```

## When To Use This Skill

- Before running containers (pull image)
- After building custom images (push to registry)
- For air-gapped deployment (export/import)
- To manage local image storage (list, remove)
- To migrate images to internal registry

## When Not To Use This Skill

- For building images (use `docker build`)
- For running containers (use workload skills)
- For container runtime configuration

## Inputs

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `action` | Operation: `pull` \| `push` \| `export` \| `import` \| `list` \| `remove` | Yes | - |
| `image` | Image name with tag (e.g., `registry/image:tag`) | Conditional | - |
| `registry` | Target registry URL (for push) | No | - |
| `outputPath` | Output file path (for export) | Conditional | - |
| `inputPath` | Input file path (for import) | Conditional | - |
| `force` | Force operation (overwrite existing) | No | `false` |
| `filter` | Filter pattern (for list) | No | - |

**Conditional requirements:**
- `pull`, `push`, `export`, `remove`: `image` required
- `export`: `outputPath` required
- `import`: `inputPath` required

## Privileges Required

- **Sudo**: No
- **Remote access**: Yes
- **Docker access**: Yes
- **Network access**: Yes (for pull/push)

## Execution Mode

Remote execution on MT-GPU machine via SSH.

## Idempotency

- **Idempotent**: Yes (for pull, push, export, import)
- **Re-run behavior**: Skips if image already exists locally (pull) or remotely (push)

## State Persistence

- **State file**: Not persisted
- **Resume supported**: No
- **Rationale**: Docker operations are atomic; no partial state to resume

## Workflow

### Action: pull

**Action**:
```bash
echo "Pulling image: $IMAGE"

# Check if image already exists
if docker image inspect "$IMAGE" >/dev/null 2>&1 && [ "$FORCE" != "true" ]; then
    echo "Image already exists locally: $IMAGE"
    echo "Use force=true to re-pull"
    exit 0
fi

START_TIME=$(date +%s)
docker pull "$IMAGE"
PULL_EXIT=$?
END_TIME=$(date +%s)

if [ $PULL_EXIT -ne 0 ]; then
    echo "Failed to pull image: $IMAGE"
    exit 1
fi

DURATION=$((END_TIME - START_TIME))
IMAGE_ID=$(docker image inspect "$IMAGE" --format '{{.Id}}')
IMAGE_SIZE=$(docker image inspect "$IMAGE" --format '{{.Size}}')

echo "Pull completed in ${DURATION} seconds"
echo "Image ID: $IMAGE_ID"
echo "Size: $(echo "scale=2; $IMAGE_SIZE / 1024 / 1024 / 1024" | bc) GB"
```

**Output**:
```json
{
  "action": "pull",
  "image": "sh-harbor.mthreads.com/mcctest/musa-train:4.3.5",
  "imageId": "sha256:abc123...",
  "size": 8589934592,
  "duration": 120,
  "status": "success"
}
```

---

### Action: push

**Action**:
```bash
# Determine full image name
if [ -n "$REGISTRY" ]; then
    # Tag for target registry
    FULL_IMAGE="$REGISTRY/$IMAGE"
    docker tag "$IMAGE" "$FULL_IMAGE"
else
    FULL_IMAGE="$IMAGE"
fi

echo "Pushing image: $FULL_IMAGE"

START_TIME=$(date +%s)
docker push "$FULL_IMAGE"
PUSH_EXIT=$?
END_TIME=$(date +%s)

if [ $PUSH_EXIT -ne 0 ]; then
    echo "Failed to push image: $FULL_IMAGE"
    echo "Hint: Check registry credentials with 'docker login'"
    exit 1
fi

DURATION=$((END_TIME - START_TIME))
echo "Push completed in ${DURATION} seconds"
```

**Output**:
```json
{
  "action": "push",
  "image": "internal-registry.company.com/my-app:v1.0",
  "duration": 180,
  "status": "success"
}
```

---

### Action: export

**Action**:
```bash
echo "Exporting image: $IMAGE"

# Check image exists
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "Image not found: $IMAGE"
    exit 1
fi

# Check output path
mkdir -p "$(dirname "$OUTPUT_PATH")"

if [ -f "$OUTPUT_PATH" ] && [ "$FORCE" != "true" ]; then
    echo "Output file already exists: $OUTPUT_PATH"
    echo "Use force=true to overwrite"
    exit 1
fi

START_TIME=$(date +%s)
docker save -o "$OUTPUT_PATH" "$IMAGE"
SAVE_EXIT=$?
END_TIME=$(date +%s)

if [ $SAVE_EXIT -ne 0 ]; then
    echo "Failed to export image"
    exit 1
fi

DURATION=$((END_TIME - START_TIME))
FILE_SIZE=$(stat -c%s "$OUTPUT_PATH")

echo "Export completed in ${DURATION} seconds"
echo "Output: $OUTPUT_PATH"
echo "Size: $(echo "scale=2; $FILE_SIZE / 1024 / 1024 / 1024" | bc) GB"
```

**Output**:
```json
{
  "action": "export",
  "image": "my-model:latest",
  "outputPath": "/data/images/my-model.tar",
  "size": 10737418240,
  "duration": 60,
  "status": "success"
}
```

---

### Action: import

**Action**:
```bash
echo "Importing image from: $INPUT_PATH"

if [ ! -f "$INPUT_PATH" ]; then
    echo "Input file not found: $INPUT_PATH"
    exit 1
fi

FILE_SIZE=$(stat -c%s "$INPUT_PATH")
echo "File size: $(echo "scale=2; $FILE_SIZE / 1024 / 1024 / 1024" | bc) GB"

START_TIME=$(date +%s)
docker load -i "$INPUT_PATH"
LOAD_EXIT=$?
END_TIME=$(date +%s)

if [ $LOAD_EXIT -ne 0 ]; then
    echo "Failed to import image"
    exit 1
fi

DURATION=$((END_TIME - START_TIME))

# Get loaded image name
LOADED_IMAGE=$(docker images --format "{{.Repository}}:{{.Tag}}" | head -1)

echo "Import completed in ${DURATION} seconds"
echo "Loaded image: $LOADED_IMAGE"
```

**Output**:
```json
{
  "action": "import",
  "inputPath": "/data/images/my-model.tar",
  "loadedImage": "my-model:latest",
  "duration": 45,
  "status": "success"
}
```

---

### Action: list

**Action**:
```bash
echo "Listing local images..."

if [ -n "$FILTER" ]; then
    docker images --filter=reference="$FILTER"
else
    docker images
fi
```

**Output**:
```json
{
  "action": "list",
  "images": [
    {
      "repository": "sh-harbor.mthreads.com/mcctest/musa-train",
      "tag": "4.3.5",
      "imageId": "abc123...",
      "size": "8.5GB"
    }
  ],
  "count": 1,
  "status": "success"
}
```

---

### Action: remove

**Action**:
```bash
echo "Removing image: $IMAGE"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "Image not found: $IMAGE"
    exit 0
fi

# Check if image is in use
CONTAINERS=$(docker ps -a --filter ancestor="$IMAGE" -q)
if [ -n "$CONTAINERS" ] && [ "$FORCE" != "true" ]; then
    echo "Image is in use by containers: $CONTAINERS"
    echo "Use force=true to remove anyway"
    exit 1
fi

docker rmi ${FORCE:+-f} "$IMAGE"
RMI_EXIT=$?

if [ $RMI_EXIT -ne 0 ]; then
    echo "Failed to remove image"
    exit 1
fi

echo "Image removed: $IMAGE"
```

**Output**:
```json
{
  "action": "remove",
  "image": "old-image:v1.0",
  "status": "success"
}
```

## Success Criteria

- Action completed without errors
- Image available (pull/import) or removed as expected

### Example Checks

- `docker images` shows expected image
- Image file exists at output path (export)
- `docker push` returns success

## Outputs

### Output Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | Yes | Operation performed |
| `image` | string | No | Image name (if applicable) |
| `status` | string | Yes | `success` \| `failed` |
| `duration` | integer | No | Operation duration in seconds |
| `size` | integer | No | Size in bytes (where applicable) |
| `images` | array | No | List of images (for list action) |
| `count` | integer | No | Image count (for list action) |

## Side Effects

- **Modifies**: Docker image cache
- **Creates**: Image files (export), tar extractions (import)
- **Removes/Replaces**: Images (remove action)
- **Requires reboot**: No

## Important Rules

1. **Check before pull**: Skip if image already exists unless force=true
2. **No sudo needed**: Docker operations don't require sudo
3. **Registry auth**: Use `docker login` for private registries
4. **Clean up**: Remove unused images to free disk space
5. **Disk space**: Check available space before large operations

## Troubleshooting

### Common Issues

1. **Pull fails - image not found**
   - Check image name and tag
   - Verify registry access
   - Check credentials for private registries

2. **Push fails - denied**
   - Run `docker login <registry>` first
   - Check user has push permission

3. **Export fails - no space**
   - Check disk space: `df -h`
   - Clean up old images: `docker image prune`

4. **Remove fails - image in use**
   - Stop containers using the image
   - Use force=true to force removal

5. **Import fails - invalid format**
   - Ensure tar file is a valid Docker image export
   - Check file integrity