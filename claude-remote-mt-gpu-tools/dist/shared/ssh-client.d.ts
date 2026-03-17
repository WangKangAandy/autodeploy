export interface SSHCommandOptions {
    host: string;
    user: string;
    password: string;
    port: string;
    command: string;
    timeout: number;
}
export interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
/**
 * Execute a command on a remote host via SSH using ssh2
 */
export declare function executeSSHCommand(options: SSHCommandOptions): Promise<CommandResult>;
//# sourceMappingURL=ssh-client.d.ts.map