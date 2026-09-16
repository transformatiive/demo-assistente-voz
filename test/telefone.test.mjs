import assert from "node:assert/strict";
import test from "node:test";

import {
  corrigirTelefoneEmDados,
  diagSemOrigemDeCliente,
  juntarCampo,
  normalizarTelefonePt,
  numeroDeOrigem,
  telefoneDeContacto
} from "../telefone.js";

// Cabeçalho From real, tirado dos logs da Railway da chamada de 14/09 15:38.
const FROM_REAL = '"+351917318234" <sip:+351917318234@sip.telnyx.eu>;tag=S1FQ2e76mjjvB';

test("numeroDeOrigem lê o cabeçalho SIP From tal como a Telnyx o envia", () => {
  assert.equal(numeroDeOrigem(FROM_REAL), "917318234");
  assert.equal(numeroDeOrigem("<sip:917318234@sip.telnyx.eu>"), "917318234");
  assert.equal(numeroDeOrigem("sip:00351917318234@host;transport=tls"), "917318234");
  assert.equal(numeroDeOrigem(""), "");
  assert.equal(numeroDeOrigem(undefined), "");
});

test("numeroDeOrigem ignora o nome de apresentação quando há URI", () => {
  // O nome de apresentação é texto livre: se trouxer outro número, manda o URI.
  assert.equal(numeroDeOrigem('"Ligue 800200300" <sip:+351917318234@host>'), "917318234");
});

test("numeroDeOrigem resiste a um URI forjado no nome de apresentação", () => {
  // Quem liga escolhe o nome de apresentação. Se lá meter um sip: completo, o URI entre
  // <...> continua a ser o que conta — senão mandávamos o consultor ligar ao atacante.
  const forjado = String.raw`"sip:+351999999999@evil.example" <sip:+351917318234@sip.telnyx.eu>;tag=x`;
  assert.equal(numeroDeOrigem(forjado), "917318234");
  // Sem URI válido dentro dos ângulos não se cai para o nome de apresentação.
  assert.equal(numeroDeOrigem('"sip:+351999999999@evil" <>'), "");
  // tel: também é aceite dentro dos ângulos
  assert.equal(numeroDeOrigem("<tel:+351917318234>"), "917318234");
});

test("numeroDeOrigem resiste a ângulos dentro do nome de apresentação", () => {
  // RFC 3261: o display-name pode ser uma quoted-string, e uma quoted-string pode conter
  // < e >. Procurar o primeiro <...> do cabeçalho deixava o nome passar por addr-spec.
  assert.equal(
    numeroDeOrigem(String.raw`"<sip:+351999999999@evil>" <sip:+351917318234@sip.telnyx.eu>;tag=x`),
    "917318234"
  );
  // com aspas escapadas lá dentro
  assert.equal(
    numeroDeOrigem(String.raw`"diz \" <sip:+351999999999@evil>" <sip:+351917318234@host>`),
    "917318234"
  );
  // só o nome, sem addr-spec: nada a aproveitar
  assert.equal(numeroDeOrigem(String.raw`"<sip:+351999999999@evil>"`), "");
});

test("numeroDeOrigem falha fechado num cabeçalho torcido", () => {
  // Pelo RFC 3261 o from-spec não admite comentários — só display-name e addr-spec — mas
  // um cabeçalho malformado não pode render o número do atacante. Sem origem, quem manda
  // é a extração, que é o comportamento de sempre.
  assert.equal(numeroDeOrigem(String.raw`Alice (see <sip:+351999999999@evil>) <sip:+351917318234@host>`), "");
  // mais do que um addr-spec: não se adivinha qual é o verdadeiro
  assert.equal(numeroDeOrigem("<sip:+351999999999@evil> <sip:+351917318234@host>"), "");
  // ângulo por fechar
  assert.equal(numeroDeOrigem("<sip:+351917318234@host"), "");
  // um display-name sem aspas não pode ter separators; se tem, o cabeçalho não é de fiar
  assert.equal(numeroDeOrigem("sip:+351999999999@evil <sip:+351917318234@host>"), "");
  // um display-name legítimo (só tokens) não é afetado
  assert.equal(numeroDeOrigem("Alice Silva <sip:+351917318234@host>"), "917318234");
});

test("numeroDoAddrSpec não aceita um user@host qualquer como número", () => {
  // sem esquema, só passa o que já é um número — senão os dígitos do host entravam
  assert.equal(numeroDeOrigem("<917318234@sip.telnyx.eu>"), "");
  assert.equal(numeroDeOrigem("<+351917318234>"), "917318234");
});

test("diagSemOrigemDeCliente tira o número de origem do diag do browser", () => {
  // /api/extract é público: aceitar telefone_origem de lá era deixar qualquer um escolher
  // o número de retorno e vê-lo apresentado como se viesse da rede.
  assert.deepEqual(
    diagSemOrigemDeCliente({ motor: "GPT-Live-1", underruns: 2, telefone_origem: "+351999999999" }),
    { motor: "GPT-Live-1", underruns: 2 }
  );
  assert.deepEqual(diagSemOrigemDeCliente({ motor: "x" }), { motor: "x" });
  assert.equal(diagSemOrigemDeCliente(undefined), undefined);
  assert.equal(diagSemOrigemDeCliente(null), null);
});

test("normalizarTelefonePt aceita só números nacionais completos", () => {
  assert.equal(normalizarTelefonePt("926420327"), "926420327");
  assert.equal(normalizarTelefonePt("+351 926 420 327"), "926420327");
  assert.equal(normalizarTelefonePt("00351926420327"), "926420327");
  assert.equal(normalizarTelefonePt("212345678"), "212345678"); // fixo
  assert.equal(normalizarTelefonePt("92642327"), ""); // o defeito de 14/09: 8 dígitos
  assert.equal(normalizarTelefonePt("9264203271"), ""); // 10 dígitos
  assert.equal(normalizarTelefonePt("123456789"), ""); // não começa por 2-9
  assert.equal(normalizarTelefonePt(""), "");
});

test("14/09: extração perdeu um dígito — vale o número de origem, e o dito fica assinalado", () => {
  const r = telefoneDeContacto("92642327", FROM_REAL);
  assert.equal(r.telefone, "917318234");
  assert.equal(r.origem, "917318234");
  assert.match(r.porConfirmar, /92642327/);
});

test("11/09: cliente partilhou um número diferente e válido — esse prevalece", () => {
  const r = telefoneDeContacto("926420327", FROM_REAL);
  assert.equal(r.telefone, "926420327");
  assert.equal(r.origem, "917318234");
  assert.equal(r.porConfirmar, "");
});

test("cliente confirmou o número de onde liga — sem aviso a mais", () => {
  const r = telefoneDeContacto("917318234", FROM_REAL);
  assert.equal(r.telefone, "917318234");
  assert.equal(r.porConfirmar, "");
});

test("nada foi dito na chamada — fica o número de origem, sem aviso", () => {
  const r = telefoneDeContacto("", FROM_REAL);
  assert.equal(r.telefone, "917318234");
  assert.equal(r.porConfirmar, "");
});

test("chamada pelo browser (sem origem) mantém o comportamento anterior", () => {
  assert.equal(telefoneDeContacto("926420327", undefined).telefone, "926420327");
  // sem número de rede não há nada melhor: preserva-se o que a extração deu
  assert.equal(telefoneDeContacto("92642327", "").telefone, "92642327");
  assert.equal(telefoneDeContacto("", "").telefone, "");
});

test("corrigirTelefoneEmDados acerta só a entrada do telefone", () => {
  const dados = "nome_cliente: Suraya Silva; telefone: 92642327; email: s@gmail.com; numero_pessoas: 2";
  assert.equal(
    corrigirTelefoneEmDados(dados, "917318234"),
    "nome_cliente: Suraya Silva; telefone: 917318234; email: s@gmail.com; numero_pessoas: 2"
  );
  // primeira posição e sem espaço depois dos dois pontos
  assert.equal(corrigirTelefoneEmDados("telefone:92642327; nome: X", "917318234"), "telefone:917318234; nome: X");
  // sem entrada de telefone fica igual
  assert.equal(corrigirTelefoneEmDados("nome: X", "917318234"), "nome: X");
  assert.equal(corrigirTelefoneEmDados("", "917318234"), "");
});

test("corrigirTelefoneEmDados não mexe em campos com 'telefone' no meio do nome", () => {
  const dados = "telefone_alternativo: 911111111; telefone: 92642327";
  assert.equal(
    corrigirTelefoneEmDados(dados, "917318234"),
    "telefone_alternativo: 911111111; telefone: 917318234"
  );
});

test("juntarCampo acumula sem separadores soltos", () => {
  assert.equal(juntarCampo("", "aviso"), "aviso");
  assert.equal(juntarCampo("matrícula", "aviso"), "matrícula; aviso");
  assert.equal(juntarCampo("matrícula", ""), "matrícula");
  assert.equal(juntarCampo(undefined, undefined), "");
});
