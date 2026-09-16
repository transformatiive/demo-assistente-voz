import assert from "node:assert/strict";
import test from "node:test";

import { corrigirEmailEmDados, emailDeContacto } from "../email.js";

test("11/09: o espaço no meio do email é removido", () => {
  // Ficou registado assim no email da chamada; nenhum consultor consegue escrever para lá.
  const r = emailDeContacto("soraia marina@gmail.com");
  assert.equal(r.email, "soraiamarina@gmail.com");
  assert.equal(r.porConfirmar, "");
});

test("um email já correto não é tocado", () => {
  const r = emailDeContacto("surayamarina@gmail.com");
  assert.equal(r.email, "surayamarina@gmail.com");
  assert.equal(r.porConfirmar, "");
});

test("maiúsculas e pontos no nome mantêm-se", () => {
  assert.equal(emailDeContacto("Joao.Catalao@alfaseguros.pt").email, "Joao.Catalao@alfaseguros.pt");
  assert.equal(emailDeContacto("  ana@sapo.pt  ").email, "ana@sapo.pt");
});

test("o que não se salva é preservado e sinalizado, nunca deitado fora", () => {
  const r = emailDeContacto("ana arroba gmail ponto com");
  assert.equal(r.email, "ana arroba gmail ponto com", "o consultor tem de ver o que foi dito");
  assert.match(r.porConfirmar, /ana arroba gmail/);

  const semArroba = emailDeContacto("anagmail.com");
  assert.equal(semArroba.email, "anagmail.com");
  assert.notEqual(semArroba.porConfirmar, "");

  const semDominio = emailDeContacto("ana@gmail");
  assert.notEqual(semDominio.porConfirmar, "");
});

test("vazio fica vazio, sem aviso", () => {
  assert.deepEqual(emailDeContacto(""), { email: "", porConfirmar: "" });
  assert.deepEqual(emailDeContacto(undefined), { email: "", porConfirmar: "" });
});

test("corrigirEmailEmDados acerta só a entrada do email", () => {
  const dados = "nome_cliente: Soraia; email: soraia marina@gmail.com; telefone: 926420327";
  assert.equal(
    corrigirEmailEmDados(dados, "soraiamarina@gmail.com"),
    "nome_cliente: Soraia; email: soraiamarina@gmail.com; telefone: 926420327"
  );
  assert.equal(corrigirEmailEmDados("nome: X", "a@b.pt"), "nome: X");
  assert.equal(corrigirEmailEmDados("", "a@b.pt"), "");
});

test("corrigirEmailEmDados não confunde um campo com 'email' no meio do nome", () => {
  const dados = "email_alternativo: x@y.pt; email: a b@c.pt";
  assert.equal(corrigirEmailEmDados(dados, "ab@c.pt"), "email_alternativo: x@y.pt; email: ab@c.pt");
});
