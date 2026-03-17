export interface DockerCommandOptions {
    command: string;
    image?: string;
    workdir?: string;
    visibleDevices?: string;
    shmSize?: string;
    volumes?: string[];
    envVars?: string[];
    name?: string;
}
/**
 * Build Docker command for either exec or run mode
 */
export declare function buildDockerCommand(options: DockerCommandOptions): string;
//# sourceMappingURL=docker-builder.d.ts.map