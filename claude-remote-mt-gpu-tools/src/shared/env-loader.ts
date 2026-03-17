import * as fs from "fs";
import * as path from "path";

export interface EnvConfig {
  host: string;
  user: string;
  passwd: string;
  sudoPasswd: string;
  port: string;
  workdir: string;
  dockerImage?: string;
}

/**
 * Load environment variables from config file
 * File location: config/remote-ssh.env in plugin directory
 */
export function loadEnvFile(): Record<string, string> {
  const envFile = path.join(process.cwd(), "config", "remote-ssh.env");
  const vars: Record<string, string> = {};

  try {
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const eq = trimmed.indexOf("=");
        if (eq > 0) {
          vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
        }
      }
    }
  } catch {
    // Ignore file reading errors - fallback to env vars
  }

  return vars;
}

/**
 * Get environment configuration with fallback chain:
 * 1. process.env (environment variables)
 * 2. config file (remote-ssh.env)
 * 3. default values
 */
export function getEnvConfig(): EnvConfig {
  const file = loadEnvFile();
  const host = process.env.GPU_HOST || file.GPU_HOST;
  const user = process.env.GPU_USER || file.GPU_USER;
  const passwd = process.env.GPU_SSH_PASSWD || file.GPU_SSH_PASSWD;
  const sudoPasswd = process.env.MY_SUDO_PASSWD || file.MY_SUDO_PASSWD || passwd;
  const port = process.env.GPU_PORT || file.GPU_PORT || "22";
  const workdir = process.env.GPU_WORK_DIR || file.GPU_WORK_DIR || "~";
  const dockerImage = process.env.TORCH_MUSA_DOCKER_IMAGE || file.TORCH_MUSA_DOCKER_IMAGE;

  if (!host || !user || !passwd) {
    throw new Error(
      "Missing required env vars. Set GPU_HOST, GPU_USER, and GPU_SSH_PASSWD.\n" +
        "Either as environment variables or in config/remote-ssh.env\n" +
        `  GPU_HOST=${host || "(unset)"}\n` +
        `  GPU_USER=${user || "(unset)"}\n` +
        `  GPU_SSH_PASSWD=${passwd ? "(set)" : "(unset)"}`
    );
  }

  return { host, user, passwd, sudoPasswd, port, workdir, dockerImage };
}