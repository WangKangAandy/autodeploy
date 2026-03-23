import * as fs from "fs";
import * as path from "path";

export interface LogEntry {
  timestamp: string;
  tool: string;
  sessionId: string;
  args: any;
}

/**
 * Execution logger for creating audit trail of tool usage
 */
class ExecutionLogger {
  private logFile: string;

  constructor() {
    // Log file location: .claude/remote-exec.log in working directory
    this.logFile = path.join(process.cwd(), ".claude", "remote-exec.log");
    this.ensureLogDirectory();
  }

  private ensureLogDirectory(): void {
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * Log a tool execution
   */
  log(tool: string, sessionId: string, args: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      tool,
      sessionId,
      args,
    };

    try {
      const line = JSON.stringify(entry) + "\n";
      fs.appendFileSync(this.logFile, line);
    } catch {
      // Non-critical - don't break tool execution if logging fails
    }
  }

  /**
   * Get recent log entries
   */
  getRecentLogs(count: number = 10): string[] {
    try {
      if (!fs.existsSync(this.logFile)) return [];

      const content = fs.readFileSync(this.logFile, "utf-8");
      const lines = content.trim().split("\n");
      return lines.slice(-count);
    } catch {
      return [];
    }
  }

  /**
   * Get log file path
   */
  getLogFilePath(): string {
    return this.logFile;
  }
}

// Export singleton instance
export const logger = new ExecutionLogger();