import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import test from "node:test";

import {
  DEFAULT_GPT_LIVE_MODEL,
  DEFAULT_GPT_LIVE_SPEED,
  DEFAULT_GPT_LIVE_VOICE,
  liveSessionConfig,
  liveSessionConfigForSipAccept,
  openaiLiveAcceptUrl,
  openaiLiveAttachUrl,
  openaiLiveHangupUrl,
  openaiSipHost,
  openaiSipUri,
  resolveSipEngine
} from "../live-session.js";
import {
  OPENAI_SIP_WEBHOOK_PATH,
  assinarWebhook,
  assinaturaValida,
  cabecalhoSip,
  registarRotasSip,
  sessionIdDoEventoSip,
  sipHealth
} from "../sip-agent.js";

const SECRET = `whsec_${Buffer.from("test-openai-webhook-secret").toString("base64")}`;
const FIRST = "Olá, fala a Alice, assistente virtual da Alfaseguros.";
const SESSION = liveSessionConfig({
  instructions: "Alice pt-PT",
  delegateInstructions: "end_call only"
});

class FakeWebSocket {
  static instances = [];
  constructor(url, opts) {
    this.url = url;
    this.opts = opts;
    this.readyState = 1;
    this.sent = [];
    this.handlers = { open: [], message: [], close: [], error: [] };
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.handlers.open.forEach(fn => fn()));
  }
  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return this; }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.handlers.close.forEach(fn => fn()); }
  emit(obj) {
    const raw = JSON.stringify(obj);
    this.handlers.message.forEach(fn => fn(raw));
  }
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function startSip({ fetchImpl, engine = "gpt-live", extra = {} } = {}) {
  FakeWebSocket.instances = [];
  const calls = [];
  const extracted = [];
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  const fetchImplFn = fetchImpl || (async (url, opts) => {
    calls.push({ url, method: opts?.method, body: opts?.body ? JSON.parse(opts.body) : undefined });
    return { ok: true, status: 200, text: async () => "" };
  });
  const { emCurso } = registarRotasSip(app, {
    engine,
    openaiBase: "https://api.openai.com",
    openaiKey: "sk-test",
    openaiWebhookSecret: SECRET,
    openaiProjectId: "proj_alice_test",
    session: SESSION,
    primeiraFala: FIRST,
    fetch: fetchImplFn,
    WebSocket: FakeWebSocket,
    extrair: async (transcript, diag, origem) => {
      extracted.push({ transcript, diag, origem });
      return {};
    },
    ...extra
  });
  const server = app.listen(0);
  await once(server, "listening");
  const { port } = server.address();
  return {
    port, server, calls, extracted, emCurso,
    url: `http://127.0.0.1:${port}${OPENAI_SIP_WEBHOOK_PATH}`,
    close: async () => {
      for (const chamada of emCurso.values()) {
        try { chamada.finalizar(); } catch { /* already closed */ }
      }
      await new Promise(r => server.close(r));
    }
  };
}

function incoming({ type = "live.transport.incoming", sessionId = "sess_sip_1", callId, from = "sip:+351910000000@sip.example.com" } = {}) {
  const data = {
    type: type === "live.transport.incoming" ? "sip" : undefined,
    session_id: sessionId,
    call_id: callId,
    sip_headers: [
      { name: "From", value: from },
      { name: "To", value: "sip:+351210000000@sip.example.com" }
    ]
  };
  if (type === "realtime.call.incoming" && sessionId == null) delete data.session_id;
  if (sessionId == null) delete data.session_id;
  return {
    object: "event",
    id: "evt_test",
    type,
    created_at: Math.floor(Date.now() / 1000),
    data
  };
}

async function postWebhook(url, body, { secret = SECRET, headers: extra = {}, id, ts } = {}) {
  const raw = JSON.stringify(body);
  const signed = assinarWebhook(raw, secret, { id, ts });
  return fetch(url, {
    method: "POST",
    headers: { ...signed, ...extra },
    body: raw
  });
}

test("Standard Webhooks signature matches OpenAI headers", () => {
  const corpo = "{\"type\":\"live.transport.incoming\"}";
  const h = assinarWebhook(corpo, SECRET, { id: "wh_abc", ts: Math.floor(Date.now() / 1000) });
  assert.equal(assinaturaValida(corpo, h, SECRET), true);
  assert.equal(assinaturaValida(corpo + "x", h, SECRET), false);
  assert.equal(assinaturaValida(corpo, { ...h, "webhook-signature": "v1,AAAA" }, SECRET), false);
});

test("SIP URI and Live control URLs: US vs EU", () => {
  assert.equal(resolveSipEngine({}), "gpt-live");
  assert.equal(resolveSipEngine({ SIP_ENGINE: "grok" }), "grok");
  assert.equal(openaiSipHost(), "sip.api.openai.com");
  assert.equal(openaiSipHost("https://eu.api.openai.com"), "sip-eu.api.openai.com");
  assert.equal(openaiSipUri("proj_abc"), "sip:proj_abc@sip.api.openai.com;transport=tls");
  assert.equal(
    openaiSipUri("proj_abc", "https://eu.api.openai.com/"),
    "sip:proj_abc@sip-eu.api.openai.com;transport=tls"
  );
  assert.equal(
    openaiLiveAcceptUrl("sess_1"),
    "https://api.openai.com/v1/live/sessions/sess_1/accept"
  );
  assert.equal(
    openaiLiveHangupUrl("sess_1"),
    "https://api.openai.com/v1/live/sessions/sess_1/hangup"
  );
  assert.equal(
    openaiLiveAttachUrl("sess_1", "https://eu.api.openai.com"),
    "wss://eu.api.openai.com/v1/live/sessions/sess_1/attach"
  );
});

test("accept session matches browser Live defaults (no type, marin, no speed, no format)", () => {
  assert.equal("type" in SESSION, false);
  assert.equal(SESSION.type, undefined);
  assert.equal(SESSION.model, DEFAULT_GPT_LIVE_MODEL);
  assert.equal(SESSION.audio.output.voice, DEFAULT_GPT_LIVE_VOICE);
  assert.equal("speed" in SESSION.audio.output, false);
  assert.equal(SESSION.audio.output.speed, undefined);
  assert.equal(SESSION.audio.format, undefined);
  assert.equal(SESSION.delegation.type, "responses");
  assert.equal(SESSION.delegation.responses.tools[0].name, "end_call");
});

test("SIP accept payload omits session.type and audio.output.speed (voice marin only)", () => {
  const fromOpts = liveSessionConfigForSipAccept({
    instructions: "Alice pt-PT",
    delegateInstructions: "end_call only"
  });
  assert.equal("type" in fromOpts, false);
  assert.equal(fromOpts.audio.output.voice, DEFAULT_GPT_LIVE_VOICE);
  assert.equal("speed" in fromOpts.audio.output, false);
  const fromSession = liveSessionConfigForSipAccept(SESSION);
  assert.equal("type" in fromSession, false);
  assert.equal(fromSession.audio.output.voice, DEFAULT_GPT_LIVE_VOICE);
  assert.equal("speed" in fromSession.audio.output, false);
  assert.equal("speed" in SESSION.audio.output, false);
});

test("session_id from Live webhooks; realtime.call.incoming ignored without session_id", () => {
  assert.equal(sessionIdDoEventoSip(incoming()), "sess_sip_1");
  assert.equal(sessionIdDoEventoSip(incoming({ type: "live.call.incoming" })), "sess_sip_1");
  assert.equal(sessionIdDoEventoSip(incoming({ type: "realtime.call.incoming", sessionId: null, callId: "rtc_old" })), null);
  assert.equal(sessionIdDoEventoSip(incoming({ type: "realtime.call.incoming", sessionId: "sess_mig" })), "sess_mig");
  assert.match(cabecalhoSip(incoming()), /\+351910000000/);
});

test("POST /api/openai/sip rejects invalid signature", async () => {
  const ctx = await startSip();
  try {
    const r = await fetch(ctx.url, {
      method: "POST",
      headers: { "content-type": "application/json", "webhook-id": "wh_bad", "webhook-timestamp": String(Math.floor(Date.now() / 1000)), "webhook-signature": "v1,not-a-sig" },
      body: JSON.stringify(incoming())
    });
    assert.equal(r.status, 401);
    assert.equal(ctx.calls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("live.transport.incoming accepts, attaches sideband, greets, does not session.start", async () => {
  const ctx = await startSip();
  try {
    const r = await postWebhook(ctx.url, incoming({ sessionId: "sess_ok" }));
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.session_id, "sess_ok");
    assert.equal(ctx.calls.length, 1);
    assert.match(ctx.calls[0].url, /\/v1\/live\/sessions\/sess_ok\/accept$/);
    assert.equal(ctx.calls[0].method, "POST");
    const session = ctx.calls[0].body.session;
    assert.equal("type" in session, false);
    assert.equal(session.type, undefined);
    assert.equal(session.model, "gpt-live-1");
    assert.equal(session.audio.output.voice, "marin");
    assert.equal("speed" in session.audio.output, false);
    assert.equal(session.audio.output.speed, undefined);
    assert.equal(session.audio.format, undefined);
    assert.equal(session.delegation.type, "responses");
    assert.match(session.instructions, /Alice pt-PT/);

    await wait(20);
    assert.equal(FakeWebSocket.instances.length, 1);
    const ws = FakeWebSocket.instances[0];
    assert.match(ws.url, /\/v1\/live\/sessions\/sess_ok\/attach$/);
    ws.emit({ type: "session.started" });
    assert.equal(ws.sent.some(e => e.type === "session.start"), false);
    assert.equal(ws.sent[0].type, "session.instructions.append");
    assert.match(ws.sent[0].content, /Olá, fala a Alice/);
    assert.equal(ws.sent[1].type, "session.commentary.append");
  } finally {
    await ctx.close();
  }
});

test("dedupes by webhook-id and handles live.call.incoming", async () => {
  const ctx = await startSip();
  try {
    const ev = incoming({ type: "live.call.incoming", sessionId: "sess_dedup" });
    const r1 = await postWebhook(ctx.url, incoming({ type: "live.call.incoming", sessionId: "sess_dedup" }), { id: "wh_same" });
    const r2 = await postWebhook(ctx.url, ev, { id: "wh_same" });
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal((await r2.json()).dedup, "webhook-id");
    assert.equal(ctx.calls.length, 1);
  } finally {
    await ctx.close();
  }
});

test("realtime.call.incoming without session_id is ignored (no Realtime accept)", async () => {
  const ctx = await startSip();
  try {
    const r = await postWebhook(ctx.url, incoming({ type: "realtime.call.incoming", sessionId: null, callId: "rtc_legacy" }));
    assert.equal(r.status, 204);
    assert.equal(ctx.calls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("transcript reaches extraction as interleaved turns, not two role blocks", async () => {
  const ctx = await startSip();
  try {
    await postWebhook(ctx.url, incoming({ sessionId: "sess_turnos" }));
    await wait(20);
    const ws = FakeWebSocket.instances[0];
    ws.emit({ type: "session.started" });

    // Fala a fala, como a API entrega: fragmentos com tempos, sem nenhum evento .done.
    const guiao = [
      ["assistant", "Pode dizer-me o seu nome completo?", 0, 1600],
      ["user", "Suraya Silva", 2200, 800],
      ["assistant", "Já é cliente da Alfaseguros?", 3600, 1300],
      ["user", "Sim", 5400, 300],
      ["assistant", "E qual é o seu email?", 6200, 1100]
    ];
    for (const [role, texto, ini, dur] of guiao) {
      const tipo = role === "user" ? "session.input_transcript.delta" : "session.output_transcript.delta";
      const pedacos = texto.match(/.{1,10}/g);
      pedacos.forEach((delta, i) => {
        const passo = dur / pedacos.length;
        ws.emit({ type: tipo, delta, start_ms: Math.round(ini + i * passo), end_ms: Math.round(ini + (i + 1) * passo) });
      });
    }

    ws.emit({ type: "session.closed" });
    await wait(30);

    assert.equal(ctx.extracted.length, 1);
    const t = ctx.extracted[0].transcript;
    assert.deepEqual(t.map(x => x.role), guiao.map(g => g[0]), "papéis intercalados");
    assert.deepEqual(t.map(x => x.text), guiao.map(g => g[1]), "texto de cada fala inteiro");
    // O emparelhamento que faltava: o "Sim" imediatamente a seguir à pergunta.
    const i = t.findIndex(x => x.text === "Já é cliente da Alfaseguros?");
    assert.equal(t[i + 1].text, "Sim");
  } finally {
    await ctx.close();
  }
});

test("end_call hangs up via Live hangup and extracts with origem alfa-voz-sip", async () => {
  const ctx = await startSip();
  try {
    const r = await postWebhook(ctx.url, incoming({ sessionId: "sess_end" }));
    assert.equal(r.status, 200);
    await wait(20);
    const ws = FakeWebSocket.instances[0];
    ws.emit({ type: "session.started" });
    ws.emit({ type: "session.input_transcript.delta", delta: "Quero um seguro auto." });
    ws.emit({ type: "session.input_transcript.done" });
    ws.emit({ type: "session.output_transcript.done", transcript: "Pode dizer-me a matrícula?" });
    ws.emit({
      type: "response.event",
      event: { type: "response.output_item.done", item: { type: "function_call", name: "end_call" } }
    });
    await wait(30);
    const hang = ctx.calls.find(c => /\/hangup$/.test(c.url));
    assert.ok(hang, "expected hangup POST");
    assert.equal(hang.method, "POST");
    ws.emit({ type: "session.closed" });
    await wait(20);
    assert.equal(ctx.extracted.length, 1);
    assert.equal(ctx.extracted[0].origem, "alfa-voz-sip");
    assert.equal(ctx.extracted[0].diag.motor, "GPT-Live-1 (telefone)");
    assert.equal(ctx.extracted[0].transcript[0].role, "user");
    assert.equal(ctx.extracted[0].transcript[1].role, "assistant");
  } finally {
    await ctx.close();
  }
});

test("SIP_ENGINE=grok disables Live webhook", async () => {
  const ctx = await startSip({ engine: "grok" });
  try {
    const r = await postWebhook(ctx.url, incoming());
    assert.equal(r.status, 503);
    assert.equal(ctx.calls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("sipHealth reports gpt-live marin 1 without follow-up note", () => {
  const live = sipHealth({
    engine: "gpt-live",
    openaiKey: "sk",
    openaiWebhookSecret: SECRET,
    openaiProjectId: "proj_x",
    openaiBase: "https://api.openai.com",
    session: SESSION
  });
  assert.equal(live.engine, "gpt-live");
  assert.equal(live.model, "gpt-live-1");
  assert.equal(live.voice, "marin");
  assert.equal(live.speed, 1);
  assert.equal(live.configured, true);
  assert.equal(live.webhook, "/api/openai/sip");
  assert.equal(live.sipUri, "sip:proj_x@sip.api.openai.com;transport=tls");
  assert.equal(live.note, undefined);
  const grok = sipHealth({ engine: "grok", xaiKey: "x", segredoWebhook: "s", voz: "ara" });
  assert.equal(grok.engine, "grok");
  assert.equal(grok.voice, "ara");
});

test("/health advertises sip.engine=gpt-live marin gpt-live-1 speed 1", async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const port = String(18965 + Math.floor(Math.random() * 20));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: port,
      OPENAI_API_KEY: "sk-test",
      OPENAI_WEBHOOK_SECRET: SECRET,
      OPENAI_PROJECT_ID: "proj_health",
      OPENAI_LIVE_MODEL: "gpt-live-1",
      OPENAI_LIVE_VOICE: "marin",
      OPENAI_LIVE_SPEED: "1.0"
    },
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
    assert.equal(body.sip.engine, "gpt-live");
    assert.equal(body.sip.model, "gpt-live-1");
    assert.equal(body.sip.voice, "marin");
    assert.equal(body.sip.speed, 1);
    assert.equal(body.sip.configured, true);
    assert.equal(body.sip.webhook, "/api/openai/sip");
    assert.equal(body.sip.sipUri, "sip:proj_health@sip.api.openai.com;transport=tls");
    assert.equal(body.sip.note, undefined);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
});
