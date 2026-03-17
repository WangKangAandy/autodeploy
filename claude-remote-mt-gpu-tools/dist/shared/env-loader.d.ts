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
export declare function loadEnvFile(): Record<string, string>;
/**
 * Get environment configuration with fallback chain:
 * 1. process.env (environment variables)
 * 2. config file (remote-ssh.env)
 * 3. default values
 */
export declare function getEnvConfig(): EnvConfig;
//# sourceMappingURL=env-loader.d.ts.map