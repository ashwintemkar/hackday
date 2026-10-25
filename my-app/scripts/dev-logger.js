const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const logsDir = path.join(process.cwd(), "logs");
fs.mkdirSync(logsDir, { recursive: true });

const logPath = path.join(logsDir, "dev.log");
const logStream = fs.createWriteStream(logPath, { flags: "a" });

const nextCli = path.join(
  process.cwd(),
  "node_modules",
  "next",
  "dist",
  "bin",
  "next"
);

let command = process.execPath;
let args = [nextCli, "dev"];

if (!fs.existsSync(nextCli)) {
  const isWin = process.platform === "win32";
  command = isWin ? "cmd" : "sh";
  args = isWin ? ["/d", "/s", "/c", "npx next dev"] : ["-c", "npx next dev"];
}

const child = spawn(command, args, {
  stdio: ["inherit", "pipe", "pipe"],
});

child.stdout.on("data", (data) => {
  process.stdout.write(data);
  logStream.write(data);
});

child.stderr.on("data", (data) => {
  process.stderr.write(data);
  logStream.write(data);
});

child.on("close", (code) => {
  logStream.end();
  process.exit(code ?? 0);
});

child.on("error", (err) => {
  console.error("Failed to start next dev:", err);
  logStream.end();
  process.exit(1);
});
