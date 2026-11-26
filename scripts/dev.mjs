import { spawn } from "node:child_process";
import os from "node:os";
import process from "node:process";

const children = [];
let stopping = false;

function run(args, env) {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (stopping || signal) return;
    if (code && code !== 0) shutdown(code);
  });
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 80);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run(["server/hall.mjs"], { HOST: "0.0.0.0" });
run(["node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "5173"]);

const lan = Object.values(os.networkInterfaces())
  .flat()
  .filter((item) => item && item.family === "IPv4" && !item.internal)
  .map((item) => `  http://${item.address}:5173`);

console.log(["\n  오늘은 생일", "  http://127.0.0.1:5173", ...lan, ""].join("\n"));
