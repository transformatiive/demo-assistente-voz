// Email de contacto.
//
// Na chamada de 11/09 ficou registado "soraia marina@gmail.com", com um espaço no meio:
// um endereço para o qual nenhum consultor consegue escrever. O cliente tinha ditado
// "soraia marina arroba gmail ponto com" e a extração manteve a pausa como espaço.
// Tirar espaços de um email é seguro — nenhum endereço válido os tem sem estar entre
// aspas, forma que não aparece em conversa falada.

const FORMA = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Devolve { email, porConfirmar }.
 * Nunca deita fora o que o cliente disse: se não se conseguir salvar, fica o original
 * e o consultor é avisado.
 */
export function emailDeContacto(extraido) {
  const bruto = String(extraido ?? "").trim();
  if (!bruto) return { email: "", porConfirmar: "" };

  const limpo = bruto.replace(/\s+/g, "");
  if (FORMA.test(limpo)) return { email: limpo, porConfirmar: "" };

  return { email: bruto, porConfirmar: `email por validar: ${bruto}` };
}

/** Acerta a entrada "email: ..." dentro de 'campo: valor; campo: valor'. */
export function corrigirEmailEmDados(dados, email) {
  const s = String(dados ?? "");
  if (!s || !email) return s;
  return s.replace(/(^|;\s*)(email\s*:\s*)([^;]*)/i, (m, sep, rotulo) => `${sep}${rotulo}${email}`);
}
