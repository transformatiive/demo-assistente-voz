# demo-assistente-voz

Dual **web** voice demos on one Node/Express service (Railway-ready):

| Path | Demo | Assistant |
|------|------|-----------|
| `/` | Landing | — |
| `/cj/` | [CJ Seguros](https://cjseguros.pt/) | Clara |
| `/simon/` | [Simon Says Studio](https://www.simonsays.studio/) | Lia |

Source lineage: code adapted from `transformatiive/alfaseguros-agentevoz` (GPT-Live browser flow). **Alfa Seguros SIP / Telnyx / Telnix are not wired** in this repo.

## Run locally

```bash
cp .env.example .env   # set OPENAI_API_KEY
npm install
npm start              # http://127.0.0.1:3847
```

## Env vars

| Var | Required | Notes |
|-----|----------|-------|
| `OPENAI_API_KEY` | Yes (for GPT-Live) | Creates realtime sessions |
| `OPENAI_BASE` | No | Default `https://api.openai.com` (EU: `https://eu.api.openai.com`) |
| `GPT_LIVE_MODEL` / `GPT_LIVE_VOICE` / `GPT_LIVE_SPEED` | No | Defaults from `live-session.js` |
| `TEXT_MODEL` | No | Post-call extract (default `gpt-5.4-mini`) |
| `RESULT_WEBHOOK` | No | Optional n8n/webhook for call results |
| `XAI_API_KEY` | No | Only if testing Grok tab |
| `ELEVENLABS_API_KEY` + `ELEVENLABS_AGENT_ID` | No | Only if testing ElevenLabs tab |

## Brand tokens (web pages only)

- **CJ**: Montserrat · accent `#01B5C5` · ink `#143852` · bg `#F7F8FA` · SVG wordmark (PNG assets optional under `/cj/`)
- **Simon Says**: Albert Sans + Montserrat · accent `#2a9d90` · ink `#35332F` · warm bg `#f7f4ef` · SVG wordmark

## Script differences

- **CJ**: Same insurance intake script as Alfa (simulation / policy / claim / cancel), renamed to Clara + CJ Seguros.
- **Simon Says**: Studio FAQ + booking intent (photo/video/studio rental), knowledge from simonsays.studio; no insurance product tree.

## Deploy

`railway.json` starts with `npm start` and healthcheck `/health`. Point one Railway service at this repo; both demos share it.
