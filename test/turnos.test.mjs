import assert from "node:assert/strict";
import test from "node:test";

import { montarTurnos } from "../turnos.js";

/** Parte um texto em fragmentos, como a API os entrega. */
function frags(role, texto, inicio, duracaoMs = 600) {
  const pedacos = texto.match(/.{1,12}/g) || [];
  const passo = duracaoMs / pedacos.length;
  return pedacos.map((delta, i) => ({
    role,
    delta,
    start_ms: Math.round(inicio + i * passo),
    end_ms: Math.round(inicio + (i + 1) * passo)
  }));
}

test("uma fala partida em fragmentos volta a ser um turno só", () => {
  const t = montarTurnos(frags("user", "nove dois, sessenta e quatro, vinte trezentos e vinte sete", 5000, 3000));
  assert.equal(t.length, 1);
  assert.equal(t[0].role, "user");
  assert.equal(t[0].text, "nove dois, sessenta e quatro, vinte trezentos e vinte sete");
});

test("os fragmentos são concatenados tal como vieram, sem inserir espaços", () => {
  // O guia: "Concatenate text exactly as received... Don't trim fragments or insert spaces".
  const t = montarTurnos([
    { role: "user", delta: "bom ", start_ms: 0, end_ms: 100 },
    { role: "user", delta: "dia", start_ms: 100, end_ms: 200 }
  ]);
  assert.equal(t[0].text, "bom dia");
});

test("alternância normal: cada pergunta e cada resposta é um turno, por ordem", () => {
  const f = [
    ...frags("assistant", "Pode dizer-me o seu nome completo?", 0, 1500),
    ...frags("user", "Suraya Silva", 2000, 800),
    ...frags("assistant", "Já é cliente da Alfaseguros?", 3200, 1200),
    ...frags("user", "Sim", 4800, 300),
    ...frags("assistant", "E qual é o seu email?", 5500, 1000)
  ];
  const t = montarTurnos(f);
  assert.deepEqual(t.map(x => x.role), ["assistant", "user", "assistant", "user", "assistant"]);
  assert.equal(t[1].text, "Suraya Silva");
  // O emparelhamento que faltava: o "Sim" fica logo a seguir à pergunta que o motivou.
  assert.equal(t[2].text, "Já é cliente da Alfaseguros?");
  assert.equal(t[3].text, "Sim");
});

test("uma resposta curta entre duas perguntas não se cola à resposta seguinte", () => {
  // Era isto que fazia o 'Sim' do "já é cliente" perder-se no meio de outros seis "Sim".
  const f = [
    ...frags("assistant", "Já é cliente?", 0, 800),
    ...frags("user", "Sim", 900, 200),
    ...frags("assistant", "E o email?", 1250, 700),   // a Alice responde depressa
    ...frags("user", "ana@gmail.com", 2000, 900)
  ];
  const t = montarTurnos(f);
  assert.equal(t.length, 4);
  assert.equal(t[1].text, "Sim");
  assert.equal(t[3].text, "ana@gmail.com");
});

test("uma pausa dentro da mesma fala não abre turno novo", () => {
  const f = [
    { role: "user", delta: "o meu email é", start_ms: 0, end_ms: 900 },
    { role: "user", delta: " ana@gmail.com", start_ms: 2400, end_ms: 3200 } // 1,5 s de hesitação
  ];
  const t = montarTurnos(f);
  assert.equal(t.length, 1);
  assert.equal(t[0].text, "o meu email é ana@gmail.com");
});

test("uma pausa longa sem ninguém falar pelo meio abre turno novo", () => {
  const f = [
    { role: "user", delta: "estou a pensar", start_ms: 0, end_ms: 900 },
    { role: "user", delta: "pode ser o 926420327", start_ms: 6000, end_ms: 7200 }
  ];
  assert.equal(montarTurnos(f).length, 2);
});

test("interrupção: a fala da Alice não se parte em duas", () => {
  // A Soraia interrompeu nos testes. Se partíssemos a fala da Alice, a transcrição ficava
  // com a pergunta dela dividida à volta da interrupção e o extractor perdia o fio.
  const f = [
    ...frags("assistant", "Então, registei um pedido de seguro de saúde para si e para o seu filho", 0, 4000),
    ...frags("user", "Espere", 1800, 400),
    ...frags("assistant", ", com dentária e óculos. Está correto?", 4000, 2000)
  ];
  const t = montarTurnos(f);
  assert.equal(t.filter(x => x.role === "assistant").length, 1);
  assert.match(t.find(x => x.role === "assistant").text, /^Então, registei.*Está correto\?$/s);
  assert.equal(t.filter(x => x.role === "user")[0].text, "Espere");
});

test("um fragmento entregue fora de ordem volta ao sítio", () => {
  // "network delivery can be uneven" — ordenamos por start_ms, não pela ordem de chegada.
  const f = [
    { role: "assistant", delta: "Já é cliente?", start_ms: 2000, end_ms: 2800 },
    { role: "user", delta: "Suraya Silva", start_ms: 0, end_ms: 900 },
    { role: "user", delta: "Sim", start_ms: 3200, end_ms: 3500 }
  ];
  assert.deepEqual(montarTurnos(f).map(x => x.text), ["Suraya Silva", "Já é cliente?", "Sim"]);
});

test("entradas degeneradas não rebentam nem geram turnos vazios", () => {
  assert.deepEqual(montarTurnos([]), []);
  assert.deepEqual(montarTurnos(null), []);
  assert.deepEqual(montarTurnos([{ role: "user", delta: "", start_ms: 0, end_ms: 0 }]), []);
  assert.deepEqual(montarTurnos([{ role: "user", delta: "   ", start_ms: 0, end_ms: 0 }]), []);
  // sem tempos (a rede de segurança do .done) continua a dar um turno
  assert.deepEqual(montarTurnos([{ role: "user", delta: "olá" }]), [{ role: "user", text: "olá" }]);
});

test("a chamada de 14/09 deixa de sair em dois blocos", () => {
  // A ordem real do email: a Alice pergunta, o cliente responde, treze vezes.
  const guiao = [
    ["assistant", "Pode dizer-me o seu nome completo?"],
    ["user", "Suraya Silva"],
    ["assistant", "Obrigada, pode ser o número de telemóvel de onde está a ligar?"],
    ["user", "nove dois, sessenta e quatro, vinte trezentos e vinte sete"],
    ["assistant", "Está correto?"],
    ["user", "Está correto"],
    ["assistant", "Já é cliente da Alfaseguros?"],
    ["user", "Sim"],
    ["assistant", "E qual é o seu email?"],
    ["user", "suraya marina arroba gmail ponto com"]
  ];
  let t = 0;
  const f = guiao.flatMap(([role, texto]) => {
    const bloco = frags(role, texto, t, Math.max(400, texto.length * 60));
    t = bloco[bloco.length - 1].end_ms + 700; // pausa entre falas
    return bloco;
  });

  const turnos = montarTurnos(f);
  assert.equal(turnos.length, guiao.length, "um turno por fala");
  assert.deepEqual(turnos.map(x => x.role), guiao.map(x => x[0]));
  assert.deepEqual(turnos.map(x => x.text), guiao.map(x => x[1]));

  // O que a extração passa a ver, e que antes não via: a resposta colada à pergunta.
  const i = turnos.findIndex(x => x.text === "Já é cliente da Alfaseguros?");
  assert.equal(turnos[i + 1].text, "Sim");
});
