import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const guiao = fs.readFileSync(path.join(root, "prompt_alfa.md"), "utf8");
const serverSrc = fs.readFileSync(path.join(root, "server.js"), "utf8");

/** A entrada do produto SAUDE, até ao produto seguinte. */
const saude = guiao.slice(guiao.indexOf("- SAUDE:"), guiao.indexOf("- TVDE:"));

test("saúde começa por distinguir particular de empresa", () => {
  assert.match(saude, /PRIMEIRA pergunta é se o seguro é particular ou para uma empresa/);
});

test("particular continua a perguntar pelo agregado", () => {
  assert.match(saude, /Particular:.*agregado/);
  assert.match(saude, /Particular:.*número de pessoas/);
  assert.match(saude, /Particular:.*idades aproximadas/);
});

test("empresa pergunta pessoas e idades, mas nunca fala em agregado", () => {
  const linhaEmpresa = saude.split("\n").find(l => l.includes("Empresa:"));
  assert.ok(linhaEmpresa, "falta a variante Empresa");
  assert.match(linhaEmpresa, /número de pessoas a cobrir/);
  assert.match(linhaEmpresa, /idades aproximadas/);
  // A instrução de não dizer "agregado" tem de estar nesta linha, senão perde-se o contexto.
  assert.match(linhaEmpresa, /Nunca digas "agregado"/);
});

test("o tomador é pedido nos dois casos, com NIF, nome e morada", () => {
  const linhaTomador = saude.split("\n").find(l => l.includes("tomador"));
  assert.ok(linhaTomador, "falta a linha do tomador");
  assert.match(linhaTomador, /Nos dois casos/);
  for (const campo of [/NIF/, /nome/, /morada/]) assert.match(linhaTomador, campo);
  // Numa empresa o nome não é o da pessoa que liga.
  assert.match(linhaTomador, /designação social/);
  // Não repetir uma pergunta cuja resposta já temos.
  assert.match(linhaTomador, /não voltes a pedi-lo/);
});

test("a proibição de perguntar por doenças mantém-se", () => {
  assert.match(saude, /NUNCA perguntes sobre doenças ou estado de saúde/);
});

test("a extração regista o tipo de seguro e o tomador", () => {
  for (const campo of ["tipo_seguro: particular", "tipo_seguro: empresa", "tomador_nome", "tomador_nif", "tomador_morada"]) {
    assert.ok(serverSrc.includes(campo), `EXTRACT_PROMPT não menciona ${campo}`);
  }
  assert.match(serverSrc, /O NIF do tomador vai também no campo 'nif'/);
});
