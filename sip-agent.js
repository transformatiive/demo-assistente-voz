// Agente de chamada por SIP — GPT-Live Direct SIP por omissão (Ringover/Telnyx → OpenAI).
// Áudio nunca passa por Alice: o tronco SIP fala com sip.api.openai.com; este processo
// aceita o webhook, configura a sessão e segura o sideband (transcrição, end_call, hangup).
// Rollback de emergência: SIP_ENGINE=grok (tronco xAI + POST /api/xai/call).

import crypto from "node:crypto";
import WebSocket from "ws";

import { montarTurnos } from "./turnos.js";
import {
  GPT_LIVE_USER_AGENT,
  OPENAI_SIP_INCOMING_EVENTS,
  OPENAI_SIP_WEBHOOK_PATH,
  gptLiveGreetingCommentaryAppend,
  gptLiveGreetingInstructionsAppend,
  liveSessionConfigForSipAccept,
  openaiLiveAcceptUrl,
  openaiLiveAttachUrl,
  openaiLiveHangupUrl,
  openaiSipUri,
  resolveSipEngine
} from "./live-session.js";

const MAX_CHAMADA_MS = 15 * 60 * 1000;
const TOLERANCIA_RELOGIO_S = 300;
const WEBHOOK_DEDUP_MS = 10 * 60 * 1000;
const SAUDACAO_FALLBACK_MS = 400;
const HANGUP_DRAIN_MS = 5000;

const EVENTOS_SIP_ENTRADA = new Set(OPENAI_SIP_INCOMING_EVENTS);

export { OPENAI_SIP_WEBHOOK_PATH, openaiSipUri, resolveSipEngine };

export function assinaturaValida(corpoBruto, cabecalhos, segredo) {
  const id = cabecalhos["webhook-id"];
  const ts = cabecalhos["webhook-timestamp"];
  const sig = cabecalhos["webhook-signature"];
  if (!segredo || !id || !ts || !sig) return false;

  const idade = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(idade) || idade > TOLERANCIA_RELOGIO_S) return false;

  const chave = Buffer.from(String(segredo).replace(/^whsec_/, ""), "base64");
  const esperado = crypto.createHmac("sha256", chave).update(`${id}.${ts}.${corpoBruto}`).digest("base64");

  return String(sig).split(" ").some(parte => {
    const [versao, valor] = parte.split(",");
    if (versao !== "v1" || !valor) return false;
    const a = Buffer.from(valor);
    const b = Buffer.from(esperado);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

export function assinarWebhook(corpoBruto, segredo, { id, ts } = {}) {
  const webhookId = id || `wh_test_${crypto.randomBytes(8).toString("hex")}`;
  const timestamp = String(ts ?? Math.floor(Date.now() / 1000));
  const chave = Buffer.from(String(segredo).replace(/^whsec_/, ""), "base64");
  const valor = crypto.createHmac("sha256", chave).update(`${webhookId}.${timestamp}.${corpoBruto}`).digest("base64");
  return {
    "content-type": "application/json",
    "webhook-id": webhookId,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${valor}`
  };
}

export function sessionIdDoEventoSip(ev) {
  const data = ev?.data || {};
  if (ev?.type === "realtime.call.incoming") {
    // Realtime call_id is a different contract — only treat as Live if session_id is present.
    return data.session_id || null;
  }
  return data.session_id || data.call_id || null;
}

export function cabecalhoSip(ev, nome = "From") {
  const wanted = String(nome).toLowerCase();
  const headers = ev?.data?.sip_headers || [];
  return headers.find(h => String(h?.name || "").toLowerCase() === wanted)?.value || "";
}

function openaiHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "User-Agent": GPT_LIVE_USER_AGENT
  };
}

function httpFetch(cfg) {
  return cfg.fetch || fetch;
}

function WsImpl(cfg) {
  return cfg.WebSocket || WebSocket;
}

class ChamadaSipLive {
  constructor(sessionId, deDe, cfg) {
    this.sessionId = sessionId;
    this.de = deDe;
    this.cfg = cfg;
    // Fragmentos crus, com os tempos: os turnos só se montam no fim, quando já não
    // podem chegar fragmentos atrasados a mudar o agrupamento. Ver turnos.js.
    this.fragmentos = [];
    this.terminada = false;
    this.saudacaoEnviada = false;
    this.diag = {
      motor: "GPT-Live-1 (telefone)",
      underruns: 0, cortes: 0, reconexoes: 0,
      falsosVad: 0, dobresResp: 0, destravas: 0, limpezas: 0
    };
  }

  async aceitar() {
    const { openaiBase, openaiKey, session } = this.cfg;
    const r = await httpFetch(this.cfg)(openaiLiveAcceptUrl(this.sessionId, openaiBase), {
      method: "POST",
      headers: openaiHeaders(openaiKey),
      body: JSON.stringify({ session: liveSessionConfigForSipAccept(session) })
    });
    if (!r.ok) {
      const detalhe = await r.text().catch(() => "");
      throw new Error(`accept ${r.status} ${detalhe.slice(0, 300)}`);
    }
  }

  ligarSideband() {
    const { openaiBase, openaiKey } = this.cfg;
    const url = openaiLiveAttachUrl(this.sessionId, openaiBase);
    this.ws = new (WsImpl(this.cfg))(url, {
      headers: { Authorization: `Bearer ${openaiKey}`, "User-Agent": GPT_LIVE_USER_AGENT }
    });
    this.ws.on("open", () => {
      this.limiteSaudacao = setTimeout(() => this.saudar(), SAUDACAO_FALLBACK_MS);
      this.limiteSaudacao.unref?.();
    });
    this.ws.on("message", d => {
      try { this.evento(JSON.parse(d.toString())); } catch { /* frame não-JSON */ }
    });
    this.ws.on("close", () => this.finalizar());
    this.ws.on("error", e => {
      console.error(`[sip-live ${this.sessionId}] ws:`, e?.message || e);
    });
    this.limite = setTimeout(() => this.desligar("duração máxima"), MAX_CHAMADA_MS);
    this.limite.unref?.();
  }

  enviar(o) {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(o));
    }
  }

  saudar() {
    if (this.saudacaoEnviada || this.terminada) return;
    this.saudacaoEnviada = true;
    clearTimeout(this.limiteSaudacao);
    // Sessão já arrancou no accept — não enviar session.start. A saudação é a mesma do browser.
    this.enviar(gptLiveGreetingInstructionsAppend(this.cfg.primeiraFala));
    this.enviar(gptLiveGreetingCommentaryAppend());
  }

  registarFragmento(role, ev) {
    if (typeof ev.delta !== "string" || ev.delta === "") return;
    this.fragmentos.push({ role, delta: ev.delta, start_ms: ev.start_ms, end_ms: ev.end_ms });
  }

  nomeFerramenta(ev) {
    const inner = ev?.event || ev;
    return inner?.name || inner?.item?.name || ev?.name || ev?.item?.name || "";
  }

  evento(ev) {
    const t = ev.type;
    if (t === "session.started") {
      this.saudar();
      return;
    }
    if (t === "session.input_transcript.delta") {
      this.registarFragmento("user", ev);
      return;
    }
    if (t === "session.output_transcript.delta") {
      this.registarFragmento("assistant", ev);
      return;
    }
    // A API não documenta eventos .done de transcrição e não os vimos em nenhuma chamada.
    // Se algum dia aparecerem, só servem de rede de segurança: aproveitamos o texto quando
    // não recebemos delta nenhum desse interlocutor, senão duplicava a chamada inteira.
    if (t === "session.input_transcript.done" || t === "session.output_transcript.done") {
      const role = t === "session.input_transcript.done" ? "user" : "assistant";
      if (ev.transcript && !this.fragmentos.some(f => f.role === role)) {
        this.fragmentos.push({ role, delta: ev.transcript, start_ms: 0, end_ms: 0 });
      }
      return;
    }
    if (t === "response.event") {
      const inner = ev.event || {};
      const innerT = inner.type || "";
      const nome = this.nomeFerramenta(ev);
      if (nome === "end_call" && (
        innerT === "response.function_call_arguments.done" ||
        innerT === "response.output_item.done" ||
        inner.item?.type === "function_call"
      )) {
        this.desligar("end_call");
      }
      return;
    }
    if (t === "session.closed") {
      this.finalizar();
      return;
    }
    if (t === "error") {
      console.error(`[sip-live ${this.sessionId}] erro:`, JSON.stringify(ev.error || ev).slice(0, 300));
    }
  }

  async desligar(motivo) {
    if (this.terminada) return;
    console.log(`[sip-live ${this.sessionId}] a desligar (${motivo})`);
    try {
      await httpFetch(this.cfg)(openaiLiveHangupUrl(this.sessionId, this.cfg.openaiBase), {
        method: "POST",
        headers: openaiHeaders(this.cfg.openaiKey)
      });
    } catch (e) {
      console.error(`[sip-live ${this.sessionId}] hangup:`, e?.message || e);
    }
    this.limiteDrain = setTimeout(() => this.finalizar(), HANGUP_DRAIN_MS);
    this.limiteDrain.unref?.();
  }

  finalizar() {
    if (this.terminada) return;
    this.terminada = true;
    clearTimeout(this.limite);
    clearTimeout(this.limiteSaudacao);
    clearTimeout(this.limiteDrain);
    try { this.ws?.close(); } catch { /* já fechado */ }
    this.cfg.aoTerminar(this.sessionId);
    // Só aqui: um fragmento atrasado ainda podia mudar o agrupamento a meio da chamada.
    const transcript = montarTurnos(this.fragmentos);
    if (!transcript.length) {
      console.log(`[sip-live ${this.sessionId}] sem transcrição, nada a registar`);
      return;
    }
    console.log(`[sip-live ${this.sessionId}] ${this.fragmentos.length} fragmentos -> ${transcript.length} turnos`);
    this.cfg.extrair(transcript, { ...this.diag, telefone_origem: this.de }, "alfa-voz-sip")
      .catch(e => console.error(`[sip-live ${this.sessionId}] extração:`, e?.message || e));
  }
}

class ChamadaSipGrok {
  constructor(callId, deDe, cfg) {
    this.callId = callId;
    this.de = deDe;
    this.cfg = cfg;
    this.transcript = [];
    this.linhasUser = new Map();
    this.terminada = false;
    this.diag = {
      motor: "SpaceX.ai Grok Live 2 (telefone)",
      underruns: 0, cortes: 0, reconexoes: 0,
      falsosVad: 0, dobresResp: 0, destravas: 0, limpezas: 0
    };
  }

  ligar() {
    const { xaiBase, xaiKey } = this.cfg;
    const url = `${xaiBase.replace("https://", "wss://")}/v1/realtime?call_id=${encodeURIComponent(this.callId)}`;
    this.ws = new (WsImpl(this.cfg))(url, { headers: { Authorization: `Bearer ${xaiKey}` } });
    this.ws.on("open", () => this.configurar());
    this.ws.on("message", d => { try { this.evento(JSON.parse(d.toString())); } catch { /* frame não-JSON */ } });
    this.ws.on("close", () => this.finalizar());
    this.ws.on("error", e => { console.error(`[sip ${this.callId}] ws:`, e?.message || e); });
    this.limite = setTimeout(() => this.desligar("duração máxima"), MAX_CHAMADA_MS);
    this.limite.unref?.();
  }

  enviar(o) { if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }

  configurar() {
    const { instrucoes, voz, primeiraFala } = this.cfg;
    this.enviar({ type: "session.update", session: { voice: voz } });
    this.enviar({ type: "session.update", session: {
      instructions: instrucoes,
      turn_detection: { type: "server_vad", threshold: 0.9, silence_duration_ms: 800, prefix_padding_ms: 333, idle_timeout_ms: 10000 },
      reasoning: { effort: "none" },
      audio: { input: { transcription: { language_hint: "pt-PT", keyterms:
        ["Alice", "Alfaseguros", "telemóvel", "apólice", "matrícula", "morada", "código postal", "consultor", "registei", "ecrã", "autocarro", "pequeno-almoço", "carta de condução", "desporto", "utilizador", "ficheiro", "palavra-passe"] } } },
      tools: [{ type: "function", name: "end_call",
        description: "Termina a chamada. Usar APENAS depois de o cliente confirmar o resumo e de o agente dizer a frase de fecho completa.",
        parameters: { type: "object", properties: {}, additionalProperties: false } }],
      tool_choice: "auto"
    } });
    this.enviar({ type: "response.create", response: {
      instructions: `${instrucoes}\n\nA tua primeira fala é exatamente, palavra por palavra: "${primeiraFala}"`
    } });
  }

  evento(ev) {
    const t = ev.type;
    if ((t === "conversation.item.input_audio_transcription.completed" ||
         t === "conversation.item.input_audio_transcription.updated") && ev.transcript) {
      this.linhasUser.set(ev.item_id, ev.transcript.trim());
    }
    if ((t === "response.output_audio_transcript.done" || t === "response.audio_transcript.done") && ev.transcript) {
      this.despejarUser();
      this.transcript.push({ role: "assistant", text: ev.transcript.trim() });
    }
    const nome = ev.name || ev.item?.name;
    if (nome === "end_call" && (t === "response.function_call_arguments.done" || t === "response.output_item.done")) {
      this.despejarUser();
      this.desligar("end_call");
    }
    if (t === "error") console.error(`[sip ${this.callId}] erro da xAI:`, JSON.stringify(ev.error || ev).slice(0, 300));
  }

  despejarUser() {
    for (const texto of this.linhasUser.values()) if (texto) this.transcript.push({ role: "user", text: texto });
    this.linhasUser.clear();
  }

  async desligar(motivo) {
    if (this.terminada) return;
    console.log(`[sip ${this.callId}] a desligar (${motivo})`);
    try {
      await httpFetch(this.cfg)(`${this.cfg.xaiBase}/v1/realtime/calls/${encodeURIComponent(this.callId)}/hangup`,
        { method: "POST", headers: { Authorization: `Bearer ${this.cfg.xaiKey}` } });
    } catch (e) { console.error(`[sip ${this.callId}] hangup:`, e?.message || e); }
    try { this.ws?.close(); } catch { /* já fechado */ }
    this.finalizar();
  }

  finalizar() {
    if (this.terminada) return;
    this.terminada = true;
    clearTimeout(this.limite);
    this.despejarUser();
    this.cfg.aoTerminar(this.callId);
    if (!this.transcript.length) { console.log(`[sip ${this.callId}] sem transcrição, nada a registar`); return; }
    this.cfg.extrair(this.transcript, { ...this.diag, telefone_origem: this.de }, "alfa-voz-sip")
      .catch(e => console.error(`[sip ${this.callId}] extração:`, e?.message || e));
  }
}

export function sipHealth(cfg) {
  const engine = cfg.engine || resolveSipEngine();
  if (engine === "grok") {
    return {
      engine: "grok",
      model: cfg.grokModel || "grok-voice-think-fast-2.0",
      voice: cfg.voz || "ara",
      grok: !!(cfg.xaiKey && cfg.segredoWebhook)
    };
  }
  const audio = cfg.session?.audio?.output || {};
  return {
    engine: "gpt-live",
    model: cfg.session?.model || "gpt-live-1",
    voice: audio.voice || "marin",
    speed: audio.speed ?? 1,
    configured: !!(cfg.openaiKey && cfg.openaiWebhookSecret),
    webhook: OPENAI_SIP_WEBHOOK_PATH,
    sipUri: openaiSipUri(cfg.openaiProjectId, cfg.openaiBase),
    grokRollback: !!(cfg.xaiKey && cfg.segredoWebhook)
  };
}

function limparDedup(seen, agora) {
  for (const [id, ts] of seen) if (agora - ts > WEBHOOK_DEDUP_MS) seen.delete(id);
}

export function registarRotasSip(app, cfg) {
  const emCurso = new Map();
  const vistos = new Map();
  const aoTerminar = id => emCurso.delete(id);
  const engine = cfg.engine || resolveSipEngine();

  const webhookLive = async (req, res) => {
    if (engine !== "gpt-live") return res.status(503).json({ error: "sip gpt-live inactivo (SIP_ENGINE=grok)" });
    if (!cfg.openaiKey || !cfg.openaiWebhookSecret) return res.status(503).json({ error: "sip gpt-live indisponível" });
    const corpo = req.rawBody?.toString("utf8") ?? "";
    if (!assinaturaValida(corpo, req.headers, cfg.openaiWebhookSecret)) {
      console.error("[sip-live] assinatura inválida — pedido recusado");
      return res.status(401).json({ error: "assinatura inválida" });
    }

    const webhookId = req.headers["webhook-id"];
    const agora = Date.now();
    limparDedup(vistos, agora);
    if (webhookId && vistos.has(webhookId)) return res.status(200).json({ ok: true, dedup: "webhook-id" });
    if (webhookId) vistos.set(webhookId, agora);

    const ev = req.body || {};
    if (!EVENTOS_SIP_ENTRADA.has(ev.type)) return res.status(204).end();
    if (ev.type === "live.transport.incoming" && ev.data?.type && ev.data.type !== "sip") {
      return res.status(204).end();
    }

    const sessionId = sessionIdDoEventoSip(ev);
    if (!sessionId) {
      if (ev.type === "realtime.call.incoming") {
        console.log("[sip-live] realtime.call.incoming sem session_id — ignorado (não aceitar pelo Realtime API)");
        return res.status(204).end();
      }
      return res.status(400).json({ error: "sem session_id" });
    }
    if (emCurso.has(sessionId)) return res.status(200).json({ ok: true, dedup: "session" });

    const de = cabecalhoSip(ev, "From");
    console.log(`[sip-live ${sessionId}] chamada recebida de ${de || "(desconhecido)"} (${ev.type})`);
    const chamada = new ChamadaSipLive(sessionId, de, { ...cfg, aoTerminar });
    emCurso.set(sessionId, chamada);
    try {
      await chamada.aceitar();
    } catch (e) {
      emCurso.delete(sessionId);
      console.error(`[sip-live ${sessionId}] accept:`, e?.message || e);
      return res.status(502).json({ error: "accept falhou" });
    }
    chamada.ligarSideband();
    res.status(200).json({ ok: true, session_id: sessionId });
  };

  app.post(OPENAI_SIP_WEBHOOK_PATH, (req, res) => {
    webhookLive(req, res).catch(e => {
      console.error("[sip-live] webhook:", e?.message || e);
      if (!res.headersSent) res.status(500).json({ error: "sip webhook" });
    });
  });

  app.post("/api/xai/call", (req, res) => {
    // Mantida durante o cutover e como rollback: só atende se o tronco ainda apontar à xAI.
    if (!cfg.xaiKey || !cfg.segredoWebhook) return res.status(503).json({ error: "sip grok indisponível" });
    if (!assinaturaValida(req.rawBody?.toString("utf8") ?? "", req.headers, cfg.segredoWebhook)) {
      console.error("[sip] assinatura inválida — pedido recusado");
      return res.status(401).json({ error: "assinatura inválida" });
    }
    const ev = req.body || {};
    if (ev.type !== "realtime.call.incoming") return res.status(204).end();

    const callId = ev.data?.call_id;
    if (!callId) return res.status(400).json({ error: "sem call_id" });
    if (emCurso.has(callId)) return res.status(200).json({ ok: true });

    const de = (ev.data?.sip_headers || []).find(h => h.name === "From")?.value || "";
    console.log(`[sip ${callId}] chamada recebida de ${de || "(desconhecido)"}`);
    const chamada = new ChamadaSipGrok(callId, de, { ...cfg, aoTerminar });
    emCurso.set(callId, chamada);
    chamada.ligar();
    res.status(200).json({ ok: true });
  });

  return { emCurso, vistos, engine };
}
