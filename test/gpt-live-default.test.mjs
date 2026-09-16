import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DEFAULT_GPT_LIVE_DELEGATE_MODEL,
  DEFAULT_GPT_LIVE_MODEL,
  DEFAULT_GPT_LIVE_SPEED,
  DEFAULT_GPT_LIVE_VOICE,
  GPT_LIVE_BRAZILIAN_VOICES,
  liveInputFromTranscript,
  liveSessionConfig,
  liveSessionConfigForSipAccept,
  openaiLiveSessionsUrl,
  resolveGptLiveModel,
  resolveGptLiveSpeed,
  resolveGptLiveVoice
} from "../live-session.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSrc = fs.readFileSync(path.join(root, "server.js"), "utf8");
const sipSrc = fs.readFileSync(path.join(root, "sip-agent.js"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const html = fs.readFileSync(path.join(root, "public/simon/index.html"), "utf8");
const logo = fs.readFileSync(path.join(root, "public/simon/logo.svg"), "utf8");

test("defaults are gpt-live-1 / marin / 1.0, not realtime-2.1 or bossa", () => {
  assert.equal(DEFAULT_GPT_LIVE_MODEL, "gpt-live-1");
  assert.equal(DEFAULT_GPT_LIVE_VOICE, "marin");
  assert.equal(DEFAULT_GPT_LIVE_SPEED, 1.0);
  assert.equal(DEFAULT_GPT_LIVE_DELEGATE_MODEL, "gpt-5.6-terra");
  assert.ok(GPT_LIVE_BRAZILIAN_VOICES.includes("bossa"));
  assert.notEqual(DEFAULT_GPT_LIVE_VOICE, "ara");
  assert.notEqual(DEFAULT_GPT_LIVE_VOICE, "bossa");
});

test("OPENAI_LIVE_MODEL wins; leftover REALTIME_MODEL=gpt-realtime-2.1 does not", () => {
  assert.equal(resolveGptLiveModel({}), "gpt-live-1");
  assert.equal(resolveGptLiveModel({ REALTIME_MODEL: "gpt-realtime-2.1" }), "gpt-live-1");
  assert.equal(resolveGptLiveModel({ OPENAI_LIVE_MODEL: "gpt-live-1-mini" }), "gpt-live-1-mini");
  assert.equal(resolveGptLiveModel({ REALTIME_MODEL: "gpt-live-1-mini" }), "gpt-live-1-mini");
  assert.equal(resolveGptLiveVoice({}), "marin");
  assert.equal(resolveGptLiveVoice({ VOICE: "coral" }), "coral");
  assert.equal(resolveGptLiveVoice({ OPENAI_LIVE_VOICE: "cedar", VOICE: "coral" }), "cedar");
  assert.equal(resolveGptLiveVoice({}, "sage"), "sage");
  assert.equal(resolveGptLiveSpeed({}), 1.0);
  assert.equal(resolveGptLiveSpeed({ OPENAI_LIVE_SPEED: "1.0" }), 1.0);
  assert.equal(resolveGptLiveSpeed({ OPENAI_LIVE_SPEED: "9" }), 1.5);
});

test("live session shape is WebRTC GPT-Live (no audio.format, speed 1.0, end_call)", () => {
  const session = liveSessionConfig({
    instructions: "Alice pt-PT",
    delegateInstructions: "end_call only"
  });
  assert.equal(session.type, "live");
  assert.equal(session.model, "gpt-live-1");
  assert.equal(session.audio.output.voice, "marin");
  assert.equal(session.audio.output.speed, 1.0);
  assert.equal(session.audio.format, undefined);
  const sipAccept = liveSessionConfigForSipAccept({
    instructions: "Alice pt-PT",
    delegateInstructions: "end_call only"
  });
  assert.equal(sipAccept.audio.output.voice, "marin");
  assert.equal("speed" in sipAccept.audio.output, false);
  const omitted = liveSessionConfig({ omitSpeed: true });
  assert.equal("speed" in omitted.audio.output, false);
  assert.equal(session.delegation.type, "responses");
  assert.equal(session.delegation.responses.tools[0].name, "end_call");
  assert.equal(openaiLiveSessionsUrl("https://api.openai.com/"), "https://api.openai.com/v1/live/sessions");
  const input = liveInputFromTranscript([{ role: "user", text: "Olá" }, { role: "assistant", text: "Em que posso ajudar?" }]);
  assert.equal(input[0].content[0].type, "input_text");
  assert.equal(input[1].content[0].type, "output_text");
});

test("server wires Live SDP exchange; advertised voice is marin not ara", () => {
  assert.match(serverSrc, /resolveGptLiveModel/);
  assert.match(serverSrc, /openaiLiveSessionsUrl/);
  assert.match(serverSrc, /transport: \{ type: "webrtc", sdp \}/);
  assert.match(serverSrc, /engine: "gpt-live"/);
  assert.match(serverSrc, /speed: LIVE_SPEED/);
  assert.match(serverSrc, /instrucoes: GROK_INSTRUCTIONS, voz: GROK_VOICE/);
  assert.match(serverSrc, /const GROK_VOICE = process\.env\.GROK_VOICE \|\| "ara"/);
  assert.match(serverSrc, /resolveSipEngine/);
  assert.match(serverSrc, /sipHealth/);
  assert.doesNotMatch(serverSrc, /gpt-realtime-2\.1/);
  assert.doesNotMatch(serverSrc, /\$\{OPENAI_BASE\}\/v1\/realtime\/client_secrets/);
});

test("browser default is GPT-Live WebRTC, not Grok/Ara", () => {
  assert.match(html, /provider='openai'/);
  assert.match(html, /session\.instructions\.append/);
  assert.match(html, /transport\.sdp/);
  assert.match(html, /session\.started/);
  assert.doesNotMatch(html, /\/v1\/realtime\/calls/);
  assert.doesNotMatch(html, /id="vers"/);
  assert.doesNotMatch(html, /Grok Live/);
  assert.doesNotMatch(html, /ElevenLabs/);
  assert.doesNotMatch(html, /data-p="grok"/);
  assert.doesNotMatch(html, /data-p="eleven"/);
});

test("Lia page uses Simon Says Studio wordmark and distinguishes mic vs session errors", () => {
  assert.match(logo, /aria-label="Simon Says Studio"/);
  assert.match(logo, /viewBox="0 0 245 149"/);
  assert.doesNotMatch(logo, />SS</);
  assert.match(html, /href="favicon.ico"/);
  assert.match(html, /apple-icon\.png/);
  assert.match(html, /#c8a46b/);
  assert.match(html, /#1a1814/);
  assert.doesNotMatch(html, /#2a9d90/);
  assert.match(html, /Permita o microfone no browser/);
  assert.match(html, /sessão de voz não está disponível/);
  assert.match(html, /Falha ao criar a sessão de voz/);
  assert.match(html, /Não foi encontrado um microfone/);
});

test("README documents GPT-Live SIP cutover and webhook path", () => {
  assert.match(readme, /gpt-live-1/);
  assert.match(readme, /marin/);
  assert.match(readme, /1\.0/);
  assert.match(readme, /SIP/);
  assert.match(readme, /OPENAI_LIVE_MODEL/);
  assert.match(readme, /OPENAI_WEBHOOK_SECRET/);
  assert.match(readme, /\/api\/openai\/sip/);
  assert.match(readme, /sip\.api\.openai.com/);
  assert.match(readme, /Ringover/);
  assert.match(readme, /SIP_ENGINE/);
  assert.match(sipSrc, /GPT-Live Direct SIP/);
  assert.match(sipSrc, /liveSessionConfigForSipAccept/);
  assert.doesNotMatch(sipSrc, /until a follow-up/i);
});

test("/health advertises gpt-live-1 marin 1.0; SIP default is gpt-live not grok", async () => {
  const port = String(18865 + Math.floor(Math.random() * 20));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: port, REALTIME_MODEL: "gpt-realtime-2.1", GROK_VOICE: "ara" },
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
    assert.equal(body.engine, "gpt-live");
    assert.equal(body.model, "gpt-live-1");
    assert.equal(body.voice, "marin");
    assert.equal(body.speed, 1.0);
    assert.equal(body.grokVoice, "ara");
    assert.equal(body.sip.engine, "gpt-live");
    assert.equal(body.sip.model, "gpt-live-1");
    assert.equal(body.sip.voice, "marin");
    assert.equal(body.sip.speed, 1);
    assert.equal(body.sip.webhook, "/api/openai/sip");
    assert.equal(body.sip.note, undefined);
    assert.equal(body.motores.gptLive, false);

    const session = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openai" })
    });
    assert.equal(session.status, 503);
  } finally {
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  }
});
