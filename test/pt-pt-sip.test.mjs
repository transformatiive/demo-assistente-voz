import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSrc = fs.readFileSync(path.join(root, "server.js"), "utf8");
const sipSrc = fs.readFileSync(path.join(root, "sip-agent.js"), "utf8");
const promptSrc = fs.readFileSync(path.join(root, "prompt_alfa.md"), "utf8");

const pares = [
  ["telemóvel", "celular"],
  ["ecrã", "tela"],
  ["aquecer", "esquentar"],
  ["autocarro", "ônibus"],
  ["pequeno-almoço", "café da manhã"],
  ["desporto", "esporte"],
  ["utilizador", "usuário"],
  ["ficheiro", "arquivo"]
];

test("Grok voice default is ara via GROK_VOICE; advertised OpenAI voice is marin via GPT-Live", () => {
  assert.match(serverSrc, /const GROK_VOICE = process\.env\.GROK_VOICE \|\| "ara"/);
  assert.match(serverSrc, /const VOICE = resolveGptLiveVoice\(process\.env\)/);
  assert.match(serverSrc, /instrucoes: GROK_INSTRUCTIONS, voz: GROK_VOICE/);
  assert.equal((serverSrc.match(/const GROK_INSTRUCTIONS/g) || []).length, 1);
});

test("Grok rollback SIP uses GROK_VOICE in session.update; Live SIP defaults marin", () => {
  assert.match(sipSrc, /session: \{ voice: voz \}/);
  assert.match(sipSrc, /language_hint: "pt-PT"/);
  assert.doesNotMatch(sipSrc, /pt-BR/);
  assert.doesNotMatch(sipSrc, /GROK_VOICE\s*=/);
  assert.match(sipSrc, /voice: audio\.voice \|\| "marin"/);
});

test("Grok/SIP instructions mandate PT-PT and forbid PT-BR with concrete pairs", () => {
  const grokBlock = serverSrc.slice(
    serverSrc.indexOf("const GROK_INSTRUCTIONS"),
    serverSrc.indexOf("const LIVE_DELEGATE_INSTRUCTIONS")
  );
  assert.match(grokBlock, /pt-PT/);
  assert.match(grokBlock, /português do Brasil/);
  assert.match(grokBlock, /CORRIGE na fala seguinte/);
  for (const [certo, errado] of pares) {
    assert.match(grokBlock, new RegExp(certo));
    assert.match(grokBlock, new RegExp(errado));
    assert.match(promptSrc, new RegExp(certo));
    assert.match(promptSrc, new RegExp(errado));
  }
  assert.match(grokBlock, /facto/);
  assert.match(grokBlock, /palavra-passe/);
  assert.match(grokBlock, /nunca «tu»/);
});

test("/health reports OpenAI voice and GROK_VOICE separately", async () => {
  const port = String(18765 + Math.floor(Math.random() * 20));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: port, GROK_VOICE: "ara" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let out = "";
  child.stdout.on("data", d => { out += d.toString(); });
  child.stderr.on("data", d => { out += d.toString(); });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`server start timeout: ${out}`)), 8000);
      child.stdout.on("data", () => {
        if (out.includes(`on :${port}`)) { clearTimeout(t); resolve(); }
      });
      child.on("exit", code => {
        clearTimeout(t);
        reject(new Error(`server exited ${code}: ${out}`));
      });
    });
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.model, "gpt-live-1");
    assert.equal(body.voice, "marin");
    assert.equal(body.speed, 1.0);
    assert.equal(body.grokVoice, "ara");
    assert.equal(body.sip.engine, "gpt-live");
    assert.equal(body.sip.voice, "marin");
    assert.equal(body.sip.model, "gpt-live-1");
    assert.equal(body.sip.speed, 1);
  } finally {
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  }
});
