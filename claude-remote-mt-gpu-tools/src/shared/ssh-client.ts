import { Client } from "ssh2";

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
export async function executeSSHCommand(
  options: SSHCommandOptions
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const { host, user, password, port, command, timeout } = options;

    let stdout = "";
    let stderr = "";
    let commandExecuted = false;

    const conn = new Client();

    // Set up timeout
    const timeoutTimer = setTimeout(() => {
      if (commandExecuted) {
        conn.end();
        reject(new Error(`Command timeout after ${timeout} seconds`));
      } else {
        conn.end();
        reject(new Error(`Connection timeout after ${timeout} seconds`));
      }
    }, timeout * 1000);

    conn
      .on("ready", () => {
        conn.exec(command, (err: any, stream: any) => {
          if (err) {
            clearTimeout(timeoutTimer);
            conn.end();
            return reject(err);
          }

          commandExecuted = true;

          stream
            .on("close", (code: number) => {
              clearTimeout(timeoutTimer);
              conn.end();
              resolve({
                stdout,
                stderr,
                exitCode: code || 0,
              });
            })
            .on("data", (data: Buffer) => {
              stdout += data.toString();
            })
            .stderr.on("data", (data: Buffer) => {
              stderr += data.toString();
            });
        });
      })
      .on("error", (err: any) => {
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