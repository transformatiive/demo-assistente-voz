import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { getDemo } from "../demos.js";
import { DEFAULT_GPT_LIVE_MODEL, liveSessionConfig } from "../live-session.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const simonPrompt = fs.readFileSync(path.join(root, "prompts/simon.md"), "utf8");
const cjPrompt = fs.readFileSync(path.join(root, "prompts/cj.md"), "utf8");
const alfaPrompt = fs.readFileSync(path.join(root, "prompts/alfa-reference.md"), "utf8");
const serverSrc = fs.readFileSync(path.join(root, "server.js"), "utf8");
const liveSrc = fs.readFileSync(path.join(root, "live-session.js"), "utf8");

test("Lia /simon/ script simulates availability confirmation in the same turn", () => {
  assert.match(simonPrompt, /Demonstração contínua/);
  assert.match(simonPrompt, /Simula o resultado NESTE mesmo turno/);
  assert.match(simonPrompt, /Confirma em voz alta/);
  assert.match(simonPrompt, /Fica marcado/);
  assert.match(simonPrompt, /Envio-lhe a confirmação por SMS/);
  assert.match(simonPrompt, /calendário/);
  assert.match(simonPrompt, /código SMS/);
  assert.doesNotMatch(simonPrompt, /A equipa do Simon Says Studio entra em contacto consigo para confirmar disponibilidade/);
  assert.doesNotMatch(simonPrompt, /garanta datas sem confirmação humana/);
});

test("Lia never waits on a tool before speaking that confirmation", () => {
  assert.match(simonPrompt, /NUNCA chames uma ferramenta e fiques à espera/);
  assert.match(simonPrompt, /NUNCA digas «um momento»/);
  assert.match(simonPrompt, /end_call, se existir, só se usa DEPOIS/);
  assert.match(serverSrc, /SIMON_DEMO_RULES/);
  assert.match(serverSrc, /demo\.id === "simon"/);
  assert.match(serverSrc, /Não chames uma ferramenta e esperes/);
  assert.match(serverSrc, /Não chames ferramentas de calendário, SMS, pagamento ou identidade/);
  assert.doesNotMatch(simonPrompt, /get_slots/);
  assert.doesNotMatch(simonPrompt, /book_appointment/);
  assert.doesNotMatch(serverSrc, /get_slots/);
  assert.doesNotMatch(serverSrc, /book_appointment/);

  const session = liveSessionConfig({
    instructions: "Lia",
    delegateInstructions: "end_call after spoken confirmation"
  });
  assert.equal(session.model, "gpt-live-1");
  assert.deepEqual(
    session.delegation.responses.tools.map((t) => t.name),
    ["end_call"]
  );
  assert.match(
    session.delegation.responses.tools[0].description,
    /depois de o cliente confirmar o resumo e de o agente dizer a frase de fecho/
  );
});

test("Lia stays gpt-live-1, not Realtime, and PT-PT never Brazilian", () => {
  assert.equal(DEFAULT_GPT_LIVE_MODEL, "gpt-live-1");
  assert.match(serverSrc, /model: LIVE_MODEL/);
  assert.doesNotMatch(serverSrc, /gpt-realtime/);
  assert.match(simonPrompt, /Nunca português do Brasil/);
  assert.match(simonPrompt, /telemóvel/);
  assert.match(simonPrompt, /marcação/);
  assert.match(simonPrompt, /nunca celular/);
  const demo = getDemo("simon");
  assert.equal(demo.id, "simon");
  assert.equal(demo.assistantName, "Lia");
  assert.match(demo.firstMessage, /tratar da sua marcação/);
  assert.equal(demo.prompt, simonPrompt);
});

test("CJ Clara and Alfa Alice scripts are untouched", () => {
  assert.match(cjPrompt, /Clara, assistente virtual da CJ Seguros/);
  assert.match(cjPrompt, /um consultor lhe liga de volta/);
  assert.doesNotMatch(cjPrompt, /Simula o resultado NESTE mesmo turno/);
  assert.match(alfaPrompt, /Alice, assistente virtual da Alfaseguros/);
  assert.doesNotMatch(alfaPrompt, /Simula o resultado NESTE mesmo turno/);
  assert.doesNotMatch(alfaPrompt, /Simon Says/);
  assert.match(liveSrc, /name: "end_call"/);
  assert.doesNotMatch(liveSrc, /get_slots/);
});
