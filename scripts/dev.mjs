import { spawn } from "node:child_process";
import process from "node:process";

const children = [];
let stopping = false;

function run(args) {
  const child = spawn(process.execPath, args, { stdio: "inherit" });
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

run(["server/hall.mjs"]);
run(["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173"]);

console.log("\n  오늘은 생일\n  http://127.0.0.1:5173\n");
