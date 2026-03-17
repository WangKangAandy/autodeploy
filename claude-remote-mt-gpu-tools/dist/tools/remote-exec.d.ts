/**
 * Remote Exec Tool - Execute shell commands on Remote MT-GPU Machine via SSH
 */
export declare const RemoteExecTool: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            command: {
                type: string;
                description: string;
            };
            workdir: {
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
//# sourceMappingURL=remote-exec.d.ts.map