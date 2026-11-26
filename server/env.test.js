import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runNode(script, { cwd, env, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("subprocess timed out"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const probe = `
import { createHash } from "node:crypto";
import { AI_CONFIG, resolvedApiKey } from ${JSON.stringify(path.join(root, "server/gemini.js"))};
const key = resolvedApiKey();
console.log(JSON.stringify({
  hash: createHash("sha256").update(key).digest("hex"),
  empty: key.length === 0,
  configMatchesResolved: AI_CONFIG.apiKey === key,
}));
`;

test("the Gemini client reads AI_API_KEY from .env and an empty file leaves no-key mode", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "airsense-env-"));
  const configured = "unit-test-gemini-key";
  const env = { ...process.env, NODE_ENV: "test" };
  delete env.AI_API_KEY;
  try {
    await writeFile(path.join(dir, ".env"), `AI_API_KEY=${configured}\n`);
    const withKey = await runNode(`import "./server/env.js";\n${probe}`, { cwd: root, env: { ...env } });
    // dotenv reads process.cwd(), so run the probe with cwd set to the temp dir.
    const loaded = await runNode(`import ${JSON.stringify(path.join(root, "server/env.js"))};\n${probe}`, {
      cwd: dir,
      env,
    });
    assert.equal(loaded.code, 0, loaded.stderr);
    assert.equal(loaded.stdout.includes(configured), false);
    assert.equal(loaded.stderr.includes(configured), false);
    const parsed = JSON.parse(loaded.stdout);
    assert.equal(parsed.empty, false);
    assert.equal(parsed.hash, sha256(configured));
    assert.equal(parsed.configMatchesResolved, true);
    assert.equal(withKey.stdout.includes(configured), false);

    await writeFile(path.join(dir, ".env"), "PORT=10000\n");
    const withoutKey = await runNode(`import ${JSON.stringify(path.join(root, "server/env.js"))};\n${probe}`, {
      cwd: dir,
      env,
    });
    assert.equal(withoutKey.code, 0, withoutKey.stderr);
    const empty = JSON.parse(withoutKey.stdout);
    assert.equal(empty.empty, true);
    assert.equal(empty.hash, sha256(""));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a server started from .env does not print the Gemini key", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "airsense-server-"));
  const configured = "unit-test-gemini-key";
  const port = 18765;
  await writeFile(path.join(dir, ".env"), `AI_API_KEY=${configured}\n`);
  const env = { ...process.env, NODE_ENV: "production", PORT: String(port) };
  delete env.AI_API_KEY;
  const child = spawn(process.execPath, [path.join(root, "server/index.js")], {
    cwd: dir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    const deadline = Date.now() + 10000;
    let status = 0;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        status = response.status;
        if (status === 200) break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.equal(status, 200);
    assert.equal(output.includes(configured), false);
  } finally {
    child.kill("SIGTERM");
    await rm(dir, { recursive: true, force: true });
  }
});
