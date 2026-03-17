"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeSSHCommand = executeSSHCommand;
const ssh2_1 = require("ssh2");
/**
 * Execute a command on a remote host via SSH using ssh2
 */
async function executeSSHCommand(options) {
    return new Promise((resolve, reject) => {
        const { host, user, password, port, command, timeout } = options;
        let stdout = "";
        let stderr = "";
        let commandExecuted = false;
        const conn = new ssh2_1.Client();
        // Set up timeout
        const timeoutTimer = setTimeout(() => {
            if (commandExecuted) {
                conn.end();
                reject(new Error(`Command timeout after ${timeout} seconds`));
            }
            else {
                conn.end();
                reject(new Error(`Connection timeout after ${timeout} seconds`));
            }
        }, timeout * 1000);
        conn
            .on("ready", () => {
            conn.exec(command, (err, stream) => {
                if (err) {
                    clearTimeout(timeoutTimer);
                    conn.end();
                    return reject(err);
                }
                commandExecuted = true;
                stream
                    .on("close", (code) => {
                    clearTimeout(timeoutTimer);
                    conn.end();
                    resolve({
                        stdout,
                        stderr,
                        exitCode: code || 0,
                    });
                })
                    .on("data", (data) => {
                    stdout += data.toString();
                })
                    .stderr.on("data", (data) => {
                    stderr += data.toString();
                });
            });
        })
            .on("error", (err) => {
            clearTimeout(timeoutTimer);
            reject(err);
        });
        conn.connect({
            host,
            port: parseInt(port, 10),
            username: user,
            password,
            readyTimeout: timeout * 1000,
            // Connection settings from original implementation
            algorithms: {
                kex: [
                    "curve25519-sha256",
                    "ecdh-sha2-nistp256",
                    "ecdh-sha2-nistp384",
                    "ecdh-sha2-nistp521",
                    "diffie-hellman-group-exchange-sha256",
                    "diffie-hellman-group14-sha256",
                ],
                cipher: [
                    "aes128-ctr",
                    "aes192-ctr",
                    "aes256-ctr",
                    "aes128-gcm@openssh.com",
                    "aes256-gcm@openssh.com",
                ],
            },
            // Skip host key checking (equivalent to StrictHostKeyChecking=no)
            strictVendor: false,
            hostHash: "sha2",
        });
    });
}
//# sourceMappingURL=ssh-client.js.map