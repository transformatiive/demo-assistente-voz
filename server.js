// Dual-demo voice assistants (web only): CJ Seguros + Simon Says Studio.
// Hosted as ONE Railway service. Alfa Seguros SIP / Telnyx / Telnix are NOT wired.
// Endpoints: GET / · GET /cj/ · GET /simon/ · POST /api/:demo/session · POST /api/:demo/extract
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getDemo } from "./demos.js";
import { corrigirEmailEmDados, emailDeContacto } from "./email.js";
import {
  corrigirTelefoneEmDados,
  diagSemOrigemDeCliente,
  juntarCampo,
  telefoneDeContacto
} from "./telefone.js";
import {
  GPT_LIVE_USER_AGENT,
  liveInputFromTranscript,
  liveSessionConfig,
  normalizeSdpOffer,
  openaiLiveSessionsUrl,
  resolveGptLiveDelegateModel,
  resolveGptLiveModel,
  resolveGptLiveSpeed,
  resolveGptLiveVoice
} from "./live-session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE = process.env.OPENAI_BASE || "https://api.openai.com";
const LIVE_MODEL = resolveGptLiveModel(process.env);
const VOICE = resolveGptLiveVoice(process.env);
const LIVE_SPEED = resolveGptLiveSpeed(process.env);
const LIVE_DELEGATE_MODEL = resolveGptLiveDelegateModel(process.env);
const TEXT_MODEL = process.env.TEXT_MODEL || "gpt-5.4-mini";
const RESULT_WEBHOOK = process.env.RESULT_WEBHOOK || "";
const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const ELEVEN_BASE = process.env.ELEVENLABS_BASE || "https://api.elevenlabs.io";
const XAI_API_KEY = process.env.XAI_API_KEY;
const XAI_BASE = process.env.XAI_BASE || "https://api.x.ai";
const GROK_MODEL = process.env.GROK_MODEL || "grok-voice-think-fast-2.0";
const GROK_VOICE = process.env.GROK_VOICE || "ara";

const FLOW_RULES = `# Tratamento do cliente (neutro quanto ao género, prioridade máxima)
- NUNCA assumas o género do cliente a partir do nome, da voz ou de qualquer outro indício.
- Não uses "o senhor" nem "a senhora". Cortesia só com o verbo na terceira pessoa.
- Quando algo fica registado, refere o pedido e não a pessoa: "o seu pedido ficou registado".

# Uma pergunta de cada vez (prioridade máxima)
- Fazes UMA pergunta (ou um grupo de NO MÁXIMO DOIS dados relacionados) e TERMINAS a tua fala imediatamente a seguir à pergunta.
- Quando pedes confirmação ("Está correto?"), essa pergunta é SEMPRE a última coisa dessa fala.
- Nunca respondes às tuas próprias perguntas.
- NUNCA termines uma fala sem uma pergunta ao cliente, exceto no fecho e na despedida.
- PROIBIDO começar uma fala com "Entendido", "Perfeito", "Compreendo" ou "Ok".
- Depois de falares, ficas em SILÊNCIO TOTAL até o cliente responder.
`;

/** Simon/Lia demo: same Atende rule — simulate validation and speak confirmation in this turn. */
const SIMON_DEMO_RULES = `# Demonstração Lia (prioridade máxima)
Uma só conversa contínua. O guião completo já está nesta sessão.
Disponibilidade, marcação, calendário, SMS, pagamento, identidade ou qualquer validação humana: simula e confirma em voz alta NESTE turno.
Não chames uma ferramenta e esperes. Não digas que vais confirmar e cales-te.
Português europeu de Portugal apenas (nunca brasileiro). Vocabulário: marcação, telemóvel, ecrã — nunca celular.
end_call só DEPOIS de a confirmação simulada já ter sido dita.
`;

function buildInstructions(demo) {
  const callBookends = `
# Início da chamada
A tua primeira fala é exatamente: "${demo.firstMessage}"

# Terminar a chamada
Só podes chamar a ferramenta end_call DEPOIS de confirmares o pedido com o cliente, dizeres a frase de fecho e o cliente se despedir ou ficar em silêncio.
`;
  const demoRules = demo.id === "simon" ? SIMON_DEMO_RULES + "\n" : "";
  return FLOW_RULES + "\n" + demo.prompt + "\n" + demoRules + callBookends;
}

function buildGrokInstructions(demo) {
  return `## CRITICAL — UMA FALA DE CADA VEZ
Depois de falares, CALAS-TE até o cliente responder.

## LÍNGUA
Português europeu de Portugal por omissão. Se o cliente falar inglês/espanhol/francês numa frase completa, muda nessa língua.
Vocabulário pt-PT: telemóvel (não celular), ecrã (não tela), morada, consultor.

## Voice
Frases curtas; tom calmo; assistente feminina ("Obrigada").

` + FLOW_RULES + "\n" + demo.prompt + `\n# Início\nPrimeira fala exacta: "${demo.firstMessage}"\n`;
}

function sessionConfigFor(demo, voice = VOICE, input) {
  const instructions = buildInstructions(demo);
  const delegateInstructions =
    demo.id === "simon"
      ? `És o raciocínio da Lia (Simon Says Studio). Não chames ferramentas de calendário, SMS, pagamento ou identidade — não existem. A Lia simula disponibilidade e confirma em voz alta no mesmo turno. Chama end_call só depois dessa confirmação e do fecho já ditos.`
      : `És o raciocínio de uma chamada da ${demo.assistantName} (${demo.company}). Chama end_call só depois do fecho confirmado.`;
  return liveSessionConfig({
    model: LIVE_MODEL,
    voice,
    instructions,
    delegateModel: LIVE_DELEGATE_MODEL,
    delegateInstructions,
    input
  });
}

function requireDemo(req, res, next) {
  const demo = getDemo(req.params.demo);
  if (!demo) return res.status(404).json({ error: "demo desconhecido" });
  req.demo = demo;
  next();
}

app.get("/health", (_, res) =>
  res.json({
    ok: true,
    demos: ["cj", "simon"],
    model: LIVE_MODEL,
    voice: VOICE,
    sip: "disabled-for-demos"
  })
);

app.post("/api/:demo/session", requireDemo, async (req, res) => {
  const demo = req.demo;
  try {
    if (req.body?.provider === "eleven") {
      if (!ELEVEN_API_KEY || !ELEVEN_AGENT_ID) {
        return res.status(503).json({ error: "elevenlabs indisponível" });
      }
      const r = await fetch(
        `${ELEVEN_BASE}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(ELEVEN_AGENT_ID)}`,
        { headers: { "xi-api-key": ELEVEN_API_KEY } }
      );
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      return res.json({
        provider: "eleven",
        ws_url: data.signed_url,
        agent_id: ELEVEN_AGENT_ID,
        model: "elevenlabs-agents",
        first_message: demo.firstMessage
      });
    }

    if (req.body?.provider === "grok") {
      if (!XAI_API_KEY) return res.status(503).json({ error: "grok indisponível" });
      const voice =
        typeof req.body?.voice === "string" && /^[a-z0-9_-]{1,32}$/i.test(req.body.voice)
          ? req.body.voice
          : GROK_VOICE;
      const r = await fetch(`${XAI_BASE}/v1/realtime/client_secrets`, {
        method: "POST",
        headers: { Authorization: `Bearer ${XAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expires_after: { seconds: 600 } })
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      const token = data.value || data.client_secret?.value || data.client_secret || data.token;
      return res.json({
        provider: "grok",
        client_secret: token,
        model: GROK_MODEL,
        voice,
        ws_url: `${XAI_BASE.replace("https://", "wss://")}/v1/realtime?model=${encodeURIComponent(GROK_MODEL)}`,
        instructions: buildGrokInstructions(demo),
        first_message: demo.firstMessage
      });
    }

    if (!OPENAI_API_KEY) {
      return res.status(503).json({ error: "openai indisponível: falta OPENAI_API_KEY" });
    }
    const sdp = normalizeSdpOffer(req.body?.sdp);
    if (!sdp) return res.status(400).json({ error: "An SDP offer is required" });
    const voice = resolveGptLiveVoice(process.env, req.body?.voice);
    const input = liveInputFromTranscript(req.body?.transcript);
    const r = await fetch(openaiLiveSessionsUrl(OPENAI_BASE), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": GPT_LIVE_USER_AGENT
      },
      body: JSON.stringify({
        session: sessionConfigFor(demo, voice, input),
        transport: { type: "webrtc", sdp }
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json(data);
    const answer = data.transport?.sdp;
    if (!answer) return res.status(502).json({ error: "Live session creation failed: missing SDP answer" });
    res.status(201).json({
      provider: "openai",
      engine: "gpt-live",
      model: LIVE_MODEL,
      voice,
      speed: LIVE_SPEED,
      first_message: demo.firstMessage,
      demo: demo.id,
      session_id: data.session?.id,
      transport: { type: "webrtc", sdp: answer }
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

async function extrairEEnviar(demo, linhas, diag) {
  const transcript = (linhas || [])
    .map((t) => `${t.role === "user" ? "CLIENTE" : demo.roleLabel}: ${t.text}`)
    .join("\n");
  const r = await fetch(`${OPENAI_BASE}/v1/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TEXT_MODEL,
      reasoning: { effort: "low" },
      input: [
        { role: "system", content: demo.extractSystem },
        { role: "user", content: transcript }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "resultado_chamada",
          strict: true,
          schema: demo.extractSchema
        }
      }
    })
  });
  const data = await r.json();
  if (!r.ok) {
    const e = new Error("extracao");
    e.status = r.status;
    e.data = data;
    throw e;
  }
  const txt =
    data.output?.flatMap((o) => o.content || []).find((c) => c.type === "output_text")?.text ||
    "{}";
  const resultado = JSON.parse(txt);

  const { telefone, origem: numeroOrigem, porConfirmar } = telefoneDeContacto(
    resultado.telefone,
    diag?.telefone_origem
  );
  resultado.telefone = telefone;
  if (resultado.dados_recolhidos != null) {
    resultado.dados_recolhidos = corrigirTelefoneEmDados(resultado.dados_recolhidos, telefone);
  }
  if (porConfirmar) {
    resultado.campos_por_confirmar = juntarCampo(resultado.campos_por_confirmar, porConfirmar);
  }

  const { email, porConfirmar: emailPorConfirmar } = emailDeContacto(resultado.email);
  resultado.email = email;
  if (resultado.dados_recolhidos != null) {
    resultado.dados_recolhidos = corrigirEmailEmDados(resultado.dados_recolhidos, email);
  }
  if (emailPorConfirmar) {
    resultado.campos_por_confirmar = juntarCampo(resultado.campos_por_confirmar, emailPorConfirmar);
  }

  const diagFinal = diag
    ? { ...diag, telefone_origem: numeroOrigem || diag.telefone_origem || "" }
    : diag;

  if (RESULT_WEBHOOK) {
    fetch(RESULT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resultado,
        transcript: linhas || [],
        diag: diagFinal,
        data: new Date().toISOString(),
        origem: demo.resultOrigem,
        demo: demo.id
      })
    }).catch(() => {});
  }
  return resultado;
}

app.post("/api/:demo/extract", requireDemo, async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(503).json({ error: "openai indisponível: falta OPENAI_API_KEY" });
    }
    const resultado = await extrairEEnviar(
      req.demo,
      req.body.transcript,
      diagSemOrigemDeCliente(req.body.diag)
    );
    res.json({ resultado, transcript: req.body.transcript || [] });
  } catch (e) {
    if (e.status) return res.status(e.status).json(e.data);
    res.status(500).json({ error: String(e) });
  }
});

const port = Number(process.env.PORT) || 3847;
app.listen(port, () =>
  console.log(`demo-assistente-voz on :${port} (cj+/simon, ${LIVE_MODEL} ${VOICE}; sip disabled)`)
);
