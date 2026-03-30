"use strict";

const { Client } = require("ssh2");

const HOST = "10.10.142.191";
const USER = "mccxadmin";
const PASSWD = "mt@142191!";
const PORT = 22;
const CONTAINER = "torch_musa_test";

/**
 * Execute command in Docker container via SSH
 */
async function execInContainer(command, timeout = 120) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const dockerCmd = `docker exec ${CONTAINER} bash -lc '${command.replace(/'/g, "'\\''")}'`;

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      conn.end();
      reject(new Error(`Command timeout after ${timeout}s`));
    }, timeout * 1000);

    conn
      .on("ready", () => {
        conn.exec(dockerCmd, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            conn.end();
            return reject(err);
          }

          stream
            .on("close", (code) => {
              clearTimeout(timer);
              conn.end();
              resolve({ stdout, stderr, exitCode: code || 0 });
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
        clearTimeout(timer);
        reject(err);
      });

    conn.connect({
      host: HOST,
      port: PORT,
      username: USER,
      password: PASSWD,
      readyTimeout: 30000,
    });
  });
}

/**
 * Execute command on remote host (not in container)
 */
async function execOnHost(command, timeout = 120) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      conn.end();
      reject(new Error(`Command timeout after ${timeout}s`));
    }, timeout * 1000);

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            conn.end();
            return reject(err);
          }

          stream
            .on("close", (code) => {
              clearTimeout(timer);
              conn.end();
              resolve({ stdout, stderr, exitCode: code || 0 });
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
        clearTimeout(timer);
        reject(err);
      });

    conn.connect({
      host: HOST,
      port: PORT,
      username: USER,
      password: PASSWD,
      readyTimeout: 30000,
    });
  });
}

// CLI interface
const cmd = process.argv[2];
const inContainer = process.argv[3] === "--container";
const timeout = parseInt(process.argv[4] || "120", 10);

if (!cmd) {
  console.log("Usage: node remote-exec.js <command> [--container] [timeout]");
  console.log("  --container: Execute in Docker container (default: on host)");
  process.exit(1);
}

const execFn = inContainer ? execInContainer : execOnHost;
execFn(cmd, timeout)
  .then((result) => {
    console.log(result.stdout);
    if (result.stderr) {
      console.error("STDERR:", result.stderr);
    }
    process.exit(result.exitCode);
  })
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });