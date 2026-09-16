// Reconstrução dos turnos da conversa a partir dos fragmentos de transcrição.
//
// A API GPT-Live não marca turnos. O schema diz, sobre os session.*_transcript.delta:
// "Accumulate fragments in delivery order; these events do not define complete turns or
// include a transcript-done event." Esperar por um evento .done — que não existe — era o
// que nos dava uma transcrição com dois blocos, tudo o que o cliente disse seguido de tudo
// o que a Alice disse, sem emparelhamento pergunta/resposta.
//
// O guia manda fazer assim: "Append fragments in order for each speaker, retaining
// start_ms and end_ms" e "Use transcript timestamps to group nearby fragments from the same
// speaker". O limiar é explicitamente nosso: "any gap threshold is an application choice to
// test".

// Ao telefone uma pausa dentro da mesma fala é curta; entre falas há sempre a outra pessoa
// pelo meio. Este limiar só decide o caso em que alguém retoma depois de uma pausa sem
// ninguém ter falado — aí vale mais juntar do que partir a meio de uma frase.
export const INTERVALO_TURNO_MS = 2000;

/**
 * @param {Array<{role: string, delta: string, start_ms: number, end_ms: number}>} fragmentos
 * @returns {Array<{role: string, text: string}>} turnos por ordem cronológica
 */
export function montarTurnos(fragmentos, intervaloMs = INTERVALO_TURNO_MS) {
  const validos = (fragmentos || []).filter(f => f && typeof f.delta === "string" && f.delta !== "");
  if (!validos.length) return [];

  // Ordenar por início: a entrega pela rede é irregular e um fragmento atrasado tem de
  // voltar ao sítio dele ("Allow late text to update earlier rows"). O índice desempata
  // para a ordenação ser estável entre fragmentos com o mesmo start_ms.
  const ordenados = validos
    .map((f, i) => ({ ...f, i, start_ms: Number(f.start_ms) || 0, end_ms: Number(f.end_ms) || Number(f.start_ms) || 0 }))
    .sort((a, b) => a.start_ms - b.start_ms || a.i - b.i);

  const turnos = [];
  const abertos = new Map(); // role -> turno ainda a crescer

  for (const f of ordenados) {
    // Quem já tinha acabado de falar antes de este fragmento começar cedeu a vez: fecha-se
    // o turno. Quem ainda estava a falar continua aberto — é sobreposição, não alternância,
    // e o guia manda deixar as duas linhas crescer ("Allow user and assistant rows to grow
    // during overlapping speech"). Sem isto, uma interrupção partia a fala da Alice em duas.
    for (const [papel, aberto] of abertos) {
      if (papel !== f.role && aberto.end_ms < f.start_ms) abertos.delete(papel);
    }

    const aberto = abertos.get(f.role);
    if (aberto && f.start_ms - aberto.end_ms <= intervaloMs) {
      // "Concatenate text exactly as received, including spaces and repeated words."
      aberto.texto += f.delta;
      aberto.end_ms = Math.max(aberto.end_ms, f.end_ms);
      continue;
    }

    const turno = { role: f.role, texto: f.delta, start_ms: f.start_ms, end_ms: f.end_ms };
    abertos.set(f.role, turno);
    turnos.push(turno);
  }

  return turnos
    .sort((a, b) => a.start_ms - b.start_ms)
    .map(t => ({ role: t.role, text: t.texto.trim() }))
    .filter(t => t.text);
}
