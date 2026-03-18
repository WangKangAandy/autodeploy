import { describe, it, expect } from 'vitest'
import { buildDockerCommand } from '../src/shared/docker-builder.js'

describe('buildDockerCommand', () => {
  describe('docker run mode', () => {
    it('should build docker run command with image', () => {
      const cmd = buildDockerCommand({
        command: "python train.py",
        image: "musa-train:latest"
      })
      expect(cmd).toContain("docker run --rm")
      expect(cmd).toContain("--runtime=mthreads")
      expect(cmd).toContain("musa-train:latest")
      expect(cmd).toContain("python train.py")
    })

    it('should include default workdir', () => {
      const cmd = buildDockerCommand({
        command: "ls",
        image: "ubuntu"
      })
      expect(cmd).toContain("-w '/workspace'")
    })

    it('should include custom workdir', () => {
      const cmd = buildDockerCommand({
        command: "ls",
        image: "ubuntu",
        workdir: "/data"
      })
      expect(cmd).toContain("-w '/data'")
    })

    it('should include volumes', () => {
      const cmd = buildDockerCommand({
        command: "test",
        image: "ubuntu",
        volumes: ["/data:/data", "/models:/models"]
      })
      expect(cmd).toContain("-v '/data:/data'")
      expect(cmd).toContain("-v '/models:/models'")
    })

    it('should include env vars', () => {
      const cmd = buildDockerCommand({
        command: "test",
        image: "ubuntu",
        envVars: ["DEBUG=true", "LOG_LEVEL=info"]
      })
      expect(cmd).toContain("-e 'DEBUG=true'")
      expect(cmd).toContain("-e 'LOG_LEVEL=info'")
    })

    it('should include visible devices', () => {
      const cmd = buildDockerCommand({
        command: "test",
        image: "ubuntu",
        visibleDevices: "0,1"
      })
      expect(cmd).toContain("MTHREADS_VISIBLE_DEVICES=0,1")
    })

    it('should include shm-size', () => {
      const cmd = buildDockerCommand({
        command: "test",
        image: "ubuntu",
        shmSize: "32G"
      })
      expect(cmd).toContain("--shm-size 32G")
    })

    it('should throw error when image missing for run mode', () => {
      expect(() => buildDockerCommand({ command: "ls" }))
        .toThrow("Docker image is required for docker run mode")
    })

    it('should escape single quotes in command', () => {
      const cmd = buildDockerCommand({
        command: "echo 'hello world'",
        image: "ubuntu"
      })
      // Command is wrapped in bash -c '...' with single quotes escaped
      // The command echo 'hello world' has its quotes escaped
      expect(cmd).toContain("bash -c 'echo '\\''hello world'\\'''")
    })
  })

  describe('docker exec mode', () => {
    it('should build docker exec command when name provided', () => {
      const cmd = buildDockerCommand({
        command: "ls",
        name: "my_container"
      })
      expect(cmd).toContain("docker exec")
      expect(cmd).toContain("my_container")
      expect(cmd).not.toContain("docker run")
    })

    it('should include workdir in exec mode', () => {
      const cmd = buildDockerCommand({
        command: "ls",
        name: "my_container",
        workdir: "/app"
      })
      expect(cmd).toContain("-w '/app'")
    })

    it('should include env vars in exec mode', () => {
      const cmd = buildDockerCommand({
        command: "test",
        name: "my_container",
        envVars: ["DEBUG=true"]
      })
      expect(cmd).toContain("-e 'DEBUG=true'")
    })

    it('should not require image in exec mode', () => {
      const cmd = buildDockerCommand({
        command: "ls",
        name: "my_container"
      })
      expect(cmd).toContain("docker exec")
    })

    it('should escape single quotes in command for exec mode', () => {
      const cmd = buildDockerCommand({
        command: "echo 'test'",
        name: "my_container"
      })
      // Command is wrapped in bash -c '...' with single quotes escaped
      expect(cmd).toContain("bash -c 'echo '\\''test'\\'''")
    })
  })

  describe('default values', () => {
    it('should use default workdir /workspace', () => {
      const cmd = buildDockerCommand({
        command: "pwd",
        image: "ubuntu"
      })
      expect(cmd).toContain("-w '/workspace'")
    })

    it('should use default visibleDevices all', () => {
      const cmd = buildDockerCommand({
        command: "test",
        image: "ubuntu"
      })
      expect(cmd).toContain("MTHREADS_VISIBLE_DEVICES=all")
    })

    it('should use default shmSize 16G', () => {
      const cmd = buildDockerCommand({
        command: "test",
        image: "ubuntu"
      })
      expect(cmd).toContain("--shm-size 16G")
    })
  })
})