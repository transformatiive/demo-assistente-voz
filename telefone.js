// Número de contacto do cliente.
//
// O número que vem no cabeçalho SIP "From" é dado da rede: não passa pelo modelo,
// não passa pela transcrição e não se degrada com ruído na linha. O número que sai
// da extração passa pelas duas coisas — na chamada de 14/09 a Alice leu "sessenta e
// quatro, vinte" em vez de dígito a dígito e a extração perdeu um zero (92642327 em
// vez de 926420327). Por isso a regra é: vale o número de origem, e só cede a um
// número ditado na chamada quando esse for um número português completo e diferente.

const PT_NACIONAL = /^[2-9]\d{8}$/;

/** Reduz um valor a um número nacional português, ou "" se não for um. */
export function normalizarTelefonePt(valor) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  if (!digitos) return "";
  // Só tiramos o indicativo quando há dígitos a mais: nenhum número nacional começa por 351.
  const nacional = digitos.length > 9 ? digitos.replace(/^(?:00)?351/, "") : digitos;
  return PT_NACIONAL.test(nacional) ? nacional : "";
}

// RFC 3261 §25.1:
//   from-spec    = ( name-addr / addr-spec ) *( SEMI from-param )
//   name-addr    = [ display-name ] LAQUOT addr-spec RAQUOT
//   display-name = *(token LWS) / quoted-string
//   token        = 1*(alphanum / "-" / "." / "!" / "%" / "*" / "_" / "+" / "`" / "'" / "~")
// Tudo o que está antes do addr-spec é escolhido por quem liga. Entre aspas pode levar
// "sip:", "<" e ">"; sem aspas só pode levar tokens, onde < > ( ) @ não entram (são
// separators). Deixámos de tentar adivinhar qual dos <...> é o verdadeiro num cabeçalho
// torcido: validamos a forma e FALHAMOS FECHADO. Sem número de origem, telefoneDeContacto
// fica com o que a extração deu, que é o comportamento de sempre — nunca com o do atacante.
const TOKEN_E_ESPACO = /^[A-Za-z0-9\-.!%*_+`'~\s]*$/;

function numeroDoAddrSpec(addrSpec) {
  const v = String(addrSpec).trim();
  const comEsquema = v.match(/^(?:sips?|tel):([^@;?\s]+)/i);
  if (comEsquema) return normalizarTelefonePt(comEsquema[1]);
  // Sem esquema só aceitamos o que já é um número; nunca um user@host qualquer.
  return /^[+\d][\d\s.\-()]*$/.test(v) ? normalizarTelefonePt(v) : "";
}

/** Número de quem liga, a partir do cabeçalho SIP From. */
export function numeroDeOrigem(cabecalhoFrom) {
  // A quoted-string sai primeiro (com os quoted-pairs \"), senão o display-name entre
  // aspas passa por addr-spec. Fica um espaço no lugar para não colar o que estava à volta.
  const semNome = String(cabecalhoFrom ?? "").replace(/"(?:[^"\\]|\\.)*"/g, " ");

  const abre = semNome.indexOf("<");
  if (abre === -1) return numeroDoAddrSpec(semNome); // addr-spec sem ângulos

  const fecha = semNome.indexOf(">", abre);
  if (fecha === -1) return "";                        // ângulo por fechar
  if (semNome.includes("<", fecha)) return "";        // mais do que um addr-spec
  if (!TOKEN_E_ESPACO.test(semNome.slice(0, abre))) return ""; // lixo antes do display-name
  return numeroDoAddrSpec(semNome.slice(abre + 1, fecha));
}

/**
 * Diag que chega do browser em POST /api/extract, que é público.
 * O número de origem só vale na via SIP, onde o webhook vem assinado; vindo do cliente
 * seria um número à escolha de quem chama o endpoint, apresentado como se fosse da rede.
 */
export function diagSemOrigemDeCliente(diag) {
  if (!diag || typeof diag !== "object") return diag;
  const { telefone_origem, ...resto } = diag;
  return resto;
}

/**
 * Decide o telefone de contacto a registar.
 * Devolve { telefone, origem, porConfirmar }.
 */
export function telefoneDeContacto(extraido, cabecalhoOrigem) {
  const origem = numeroDeOrigem(cabecalhoOrigem);
  const ditado = normalizarTelefonePt(extraido);
  const bruto = String(extraido ?? "").trim();

  // Foi partilhado um número diferente durante a chamada: é esse que o cliente quer.
  if (ditado && ditado !== origem) return { telefone: ditado, origem, porConfirmar: "" };

  if (origem) {
    // Disseram alguma coisa que não chegou a ser um número válido (dígito perdido,
    // transcrição partida): registamos o da rede e deixamos o dito para o consultor ver.
    const porConfirmar = !ditado && bruto ? `telefone dito na chamada (não confirmado): ${bruto}` : "";
    return { telefone: origem, origem, porConfirmar };
  }

  // Sem origem (chamada pelo browser): fica o que a extração deu, tal como antes.
  return { telefone: ditado || bruto, origem: "", porConfirmar: "" };
}

/** Acerta a entrada "telefone: ..." dentro de 'campo: valor; campo: valor'. */
export function corrigirTelefoneEmDados(dados, telefone) {
  const s = String(dados ?? "");
  if (!s || !telefone) return s;
  return s.replace(/(^|;\s*)(telefone\s*:\s*)([^;]*)/i, (m, sep, rotulo) => `${sep}${rotulo}${telefone}`);
}

/** Junta um aviso a um campo de texto já existente, sem duplicar separadores. */
export function juntarCampo(atual, aviso) {
  return [String(atual ?? "").trim(), String(aviso ?? "").trim()].filter(Boolean).join("; ");
}
