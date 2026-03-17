/**
 * Remote Docker Tool - Run commands inside Docker containers on Remote MT-GPU Machine
 */
export declare const RemoteDockerTool: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            command: {
                type: string;
                description: string;
            };
            image: {
                type: string;
                description: string;
            };
            workdir: {
                type: string;
                description: string;
                default: string;
            };
            visible_devices: {
                type: string;
                description: string;
                default: string;
            };
            shm_size: {
                type: string;
                description: string;
                default: string;
            };
            volumes: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
                default: never[];
            };
            env_vars: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
                default: never[];
            };
            name: {
                type: string;
                description: string;
            };
            sudo: {
                type: string;
                description: string;
                default: boolean;
            };
            timeout: {
                type: string;
                description: string;
                default: number;
            };
        };
        required: string[];
    };
    execute(args: any): Promise<{
        content: {
            type: string;
            text: string;
        }[];
        isError: boolean;
    }>;
};
//# sourceMappingURL=remote-docker.d.ts.map