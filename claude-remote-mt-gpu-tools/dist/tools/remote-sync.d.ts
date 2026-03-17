/**
 * Remote Sync Tool - Sync files between local machine and Remote MT-GPU Machine
 */
export declare const RemoteSyncTool: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            local_path: {
                type: string;
                description: string;
            };
            remote_path: {
                type: string;
                description: string;
            };
            direction: {
                type: string;
                description: string;
                enum: string[];
                default: string;
            };
            delete: {
                type: string;
                description: string;
                default: boolean;
            };
            exclude: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
                default: never[];
            };
            timeout: {
                type: string;
                description: string;
                default: number;
            };
        };
        required: string[];
    };
    execute(args: any): Promise<unknown>;
};
//# sourceMappingURL=remote-sync.d.ts.map