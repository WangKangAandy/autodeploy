/**
 * Escape single quotes for shell command construction
 */
export declare function escapeSingleQuotes(value: string): string;
/**
 * Escape double quotes for shell command construction
 */
export declare function escapeDoubleQuotes(value: string): string;
/**
 * Quote a value for shell execution
 */
export declare function shellQuote(value: string): string;
/**
 * Build working directory prefix for remote commands
 * Handles ~, ~user/, and absolute paths
 */
export declare function buildWorkdirPrefix(workdir: string): string;
/**
 * Truncate output to prevent excessive response sizes
 * Default limit: 50KB
 */
export declare function truncateOutput(text: string, maxBytes?: number): string;
/**
 * Check if a local dependency is available
 */
export declare function checkDependency(name: string): boolean;
/**
 * Format command output with exit code
 */
export declare function formatOutput(stdout: string, stderr: string, exitCode: number): string;
//# sourceMappingURL=utils.d.ts.map