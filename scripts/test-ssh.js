"use strict";

const { Client } = require("ssh2");

const config = {
  host: process.argv[2] || "10.10.142.191",
  port: 22,
  username: process.argv[3] || "mccxadmin",
  password: process.argv[4] || "mccxadmin",
};

console.log(`Testing connection to ${config.username}@${config.host}...`);

const conn = new Client();

conn
  .on("ready", () => {
    console.log("✓ Connection successful!");
    conn.exec("echo 'SSH test passed' && whoami && hostname", (err, stream) => {
      if (err) {
        console.error("Exec error:", err);
        conn.end();
        process.exit(1);
      }
      let stdout = "";
      let stderr = "";
      stream
        .on("close", (code) => {
          console.log("Exit code:", code);
          console.log("Output:", stdout);
          if (stderr) console.log("Stderr:", stderr);
          conn.end();
          process.exit(code || 0);
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
    console.error("✗ Connection failed:", err.message);
    console.error("Level:", err.level);
    process.exit(1);
  });

// Try keyboard-interactive auth as fallback
conn.connect({
  host: config.host,
  port: config.port,
  username: config.username,
  password: config.password,
  readyTimeout: 30000,
  tryKeyboard: true,
  authHandler: (methodsLeft, partialSuccess, callback) => {
    console.log("Auth methods left:", methodsLeft);
    console.log("Partial success:", partialSuccess);
    if (partialSuccess) {
      // Already partially authenticated, just need more
      callback({ type: "password", password: config.password });
    } else {
      // First attempt
      callback({ type: "password", password: config.password });
    }
  },
});