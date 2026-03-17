export interface LogEntry {
    timestamp: string;
    tool: string;
    sessionId: string;
    args: any;
}
/**
 * Execution logger for creating audit trail of tool usage
 */
declare class ExecutionLogger {
    private logFile;
    constructor();
    private ensureLogDirectory;
    /**
     * Log a tool execution
     */
    log(tool: string, sessionId: string, args: any): void;
    /**
     * Get recent log entries
     */
    getRecentLogs(count?: number): string[];
    /**
     * Get log file path
     */
    getLogFilePath(): string;
}
export declare const logger: ExecutionLogger;
export {};
//# sourceMappingURL=execution-logger.d.ts.map