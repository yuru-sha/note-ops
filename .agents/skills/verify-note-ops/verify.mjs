import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const runId = new Date().toISOString().replaceAll(":", "-");
const evidenceDir = resolve(root, "artifacts/verify-note-ops", runId);
const evidencePath = resolve(evidenceDir, "mcp-tool-discovery.json");
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("NOTE_"))
);
const child = spawn(process.execPath, ["build/index.js"], {
  cwd: root,
  env,
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = createInterface({ input: child.stdout });
const stderr = [];
child.stderr.setEncoding("utf8").on("data", (chunk) => stderr.push(chunk));
const pending = new Map();
let nextId = 1;
let exited = false;

child.once("exit", (code, signal) => {
  exited = true;
  for (const { reject } of pending.values()) reject(new Error(`Server exited (${code ?? signal})`));
});
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve: accept, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else accept(message.result);
  }
});

function request(method, params) {
  if (exited) return Promise.reject(new Error("Server exited before request"));
  const id = nextId++;
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for MCP ${method}`));
    }, 5000);
    pending.set(id, {
      resolve(value) { clearTimeout(timer); accept(value); },
      reject(error) { clearTimeout(timer); reject(error); },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

try {
  const initialized = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "note-ops-verification", version: "1.0.0" },
  });
  if (initialized.serverInfo?.name !== "note-ops" || initialized.serverInfo?.version !== "0.1.0") {
    throw new Error(`Unexpected MCP server identity: ${JSON.stringify(initialized.serverInfo)}`);
  }
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const result = await request("tools/list", {});
  const expected = [
    "get-my-notes",
    "get-note",
    "post-draft-note",
    "edit-note",
    "set-note-eyecatch",
    "open-note-editor",
  ];
  const actual = result.tools.map(({ name }) => name).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(`Unexpected MCP tools: ${actual.join(", ")}`);
  }
  const proof = {
    feature: "mcp-tool-discovery",
    action: "MCP initialize followed by tools/list over the server's stdio transport",
    server: initialized.serverInfo,
    protocolVersion: initialized.protocolVersion,
    tools: result.tools.map(({ name, description }) => ({ name, description })),
    stderr: stderr.join("").trim(),
    exitCode: null,
  };
  child.stdin.end();
  const exitCode = await new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error("Server did not exit after stdin closed")), 5000);
    child.once("exit", (code) => { clearTimeout(timer); accept(code); });
  });
  if (exitCode !== 0) throw new Error(`Server exited with status ${exitCode}`);
  proof.exitCode = exitCode;
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(proof, null, 2)}\n`, { flag: "wx" });
  console.log(`PASS: ${proof.server.name} ${proof.server.version}; ${actual.length} tools discovered`);
  console.log(`Evidence: ${evidencePath}`);
} catch (error) {
  child.stdin.destroy();
  child.kill();
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
