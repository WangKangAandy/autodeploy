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
exports.logger = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Execution logger for creating audit trail of tool usage
 */
class ExecutionLogger {
    logFile;
    constructor() {
        // Log file location: .claude/remote-exec.log in working directory
        this.logFile = path.join(process.cwd(), ".claude", "remote-exec.log");
        this.ensureLogDirectory();
    }
    ensureLogDirectory() {
        const logDir = path.dirname(this.logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }
    /**
     * Log a tool execution
     */
    log(tool, sessionId, args) {
        const entry = {
            timestamp: new Date().toISOString(),
            tool,
            sessionId,
            args,
        };
        try {
            const line = JSON.stringify(entry) + "\n";
            fs.appendFileSync(this.logFile, line);
        }
        catch {
            // Non-critical - don't break tool execution if logging fails
        }
    }
    /**
     * Get recent log entries
     */
    getRecentLogs(count = 10) {
        try {
            if (!fs.existsSync(this.logFile))
                return [];
            const content = fs.readFileSync(this.logFile, "utf-8");
            const lines = content.trim().split("\n");
            return lines.slice(-count);
        }
        catch {
            return [];
        }
    }
    /**
     * Get log file path
     */
    getLogFilePath() {
        return this.logFile;
    }
}
// Export singleton instance
exports.logger = new ExecutionLogger();
//# sourceMappingURL=execution-logger.js.map