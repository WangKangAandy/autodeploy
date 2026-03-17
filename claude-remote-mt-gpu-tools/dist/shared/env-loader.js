"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEnvFile = loadEnvFile;
exports.getEnvConfig = getEnvConfig;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Load environment variables from config file
 * File location: config/remote-ssh.env in plugin directory
 */
function loadEnvFile() {
    const envFile = path.join(process.cwd(), "config", "remote-ssh.env");
    const vars = {};
    try {
        if (fs.existsSync(envFile)) {
            const content = fs.readFileSync(envFile, "utf-8");
            for (const line of content.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith("#"))
                    continue;
                const eq = trimmed.indexOf("=");
                if (eq > 0) {
                    vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
                }
            }
        }
    }
    catch {
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
function getEnvConfig() {
    const file = loadEnvFile();
    const host = process.env.GPU_HOST || file.GPU_HOST;
    const user = process.env.GPU_USER || file.GPU_USER;
    const passwd = process.env.GPU_SSH_PASSWD || file.GPU_SSH_PASSWD;
    const sudoPasswd = process.env.MY_SUDO_PASSWD || file.MY_SUDO_PASSWD || passwd;
    const port = process.env.GPU_PORT || file.GPU_PORT || "22";
    const workdir = process.env.GPU_WORK_DIR || file.GPU_WORK_DIR || "~";
    const dockerImage = process.env.TORCH_MUSA_DOCKER_IMAGE || file.TORCH_MUSA_DOCKER_IMAGE;
    if (!host || !user || !passwd) {
        throw new Error("Missing required env vars. Set GPU_HOST, GPU_USER, and GPU_SSH_PASSWD.\n" +
            "Either as environment variables or in config/remote-ssh.env\n" +
            `  GPU_HOST=${host || "(unset)"}\n` +
            `  GPU_USER=${user || "(unset)"}\n` +
            `  GPU_SSH_PASSWD=${passwd ? "(set)" : "(unset)"}`);
    }
    return { host, user, passwd, sudoPasswd, port, workdir, dockerImage };
}
//# sourceMappingURL=env-loader.js.map