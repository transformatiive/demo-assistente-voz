import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadPrompt(rel) {
  return fs.readFileSync(path.join(__dirname, rel), "utf8");
}

/** @typedef {{
 *  id: string,
 *  label: string,
 *  assistantName: string,
 *  company: string,
 *  firstMessage: string,
 *  prompt: string,
 *  transcriptionPrompt: string,
 *  extractSystem: string,
 *  extractSchema: object,
 *  resultOrigem: string,
 *  roleLabel: string
 * }} DemoConfig */

/** @type {Record<string, DemoConfig>} */
export const demos = {
  cj: {
    id: "cj",
    label: "CJ Seguros",
    assistantName: "Clara",
    company: "CJ Seguros",
    firstMessage:
      "Olá, fala a Clara, assistente virtual da CJ Seguros. Os nossos consultores não conseguiram atender neste momento. Posso registar o seu pedido para que um consultor o contacte. Esta chamada é gravada. Em que posso ajudar?",
    prompt: loadPrompt("prompts/cj.md"),
    transcriptionPrompt:
      "Chamada telefónica para a CJ Seguros, corretora de seguros em Portugal. O cliente pode falar português de Portugal, inglês, espanhol ou francês. Termos frequentes: Clara, CJ Seguros, apólice, sinistro, multirriscos, condomínio, frações, TVDE, matrícula, código postal, NIF, telemóvel, morada, carta de condução, danos próprios, responsabilidade civil, simulação, consultor.",
    extractSystem: `Extrai, a partir da transcrição de uma chamada entre a assistente virtual Clara (CJ Seguros) e um cliente, os campos pedidos. Regras: 'dados_recolhidos' em formato 'campo: valor; campo: valor'. Pedir um seguro de saúde NÃO é informação clínica: o produto SAUDE, o número de pessoas, as idades e as coberturas pretendidas (dentária, óculos, estomatologia) são dados comerciais normais e TÊM de constar no resumo e em dados_recolhidos. mencionou_dados_saude=true só quando o cliente revelar algo clínico concreto sobre alguém: doença, sintoma, medicação, tratamento, cirurgia, gravidez, deficiência ou histórico clínico. Nesse caso é PROIBIDO escrever essa informação em qualquer campo, mas o resumo mantém o resto do pedido e acrescenta a frase 'O cliente mencionou informação clínica, a recolher por um consultor.' — nunca substituas o resumo inteiro por essa frase. 'campos_em_falta' = campos obrigatórios do produto que o cliente não soube. 'produto' usa os códigos: AUTOMOVEL, MULTIRRISCOS_HABITACAO, MULTIRRISCOS_CONDOMINIO, MULTIRRISCOS_EMPRESARIAL, SAUDE, TVDE, ACIDENTES_TRABALHO_INDIVIDUAL, ACIDENTES_TRABALHO_COLETIVO, RC_GERAL, RC_CONSTRUCAO, RC_EMPRESARIAL, RC_MEDICOS, RC_ARMAS_CACADOR, OBRAS_MONTAGENS, ANIMAIS, BICICLETAS_TROTINETAS, VIAGEM, EMBARCACAO, ACIDENTES_PESSOAIS (ou "" se não for simulação). Num pedido de SAUDE, 'dados_recolhidos' TEM de incluir 'tipo_seguro: particular' ou 'tipo_seguro: empresa', e os dados do tomador que tiverem sido recolhidos: 'tomador_nome', 'tomador_nif' e 'tomador_morada' (numa empresa, o nome é a designação social). O NIF do tomador vai também no campo 'nif'. Se o tipo de seguro ou algum dado do tomador não chegou a ser recolhido, mete-o em 'campos_em_falta'. 'cliente_existente': a Clara pergunta 'Já é cliente da CJ Seguros?' — a resposta é o que o cliente disser no turno seguinte, e um 'sim'/'não' isolado conta como resposta. Só pões 'desconhecido' se a pergunta não foi feita ou ficou sem resposta. 'email': junta tudo sem espaços; um email nunca leva espaços. 'quer_humano' só é true se o cliente pediu EXPLICITAMENTE para falar com uma pessoa; um colega ligar de volta é o fluxo normal e NÃO conta. 'prioridade' alta se sinistro urgente, pedido sem resposta, cliente irritado ou quer_humano=true. Resumo em 2 a 4 frases, português europeu, para um consultor humano. Campos vazios = "".`,
    extractSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        categoria: {
          type: "string",
          enum: ["SIMULACAO", "GESTAO_APOLICE", "SINISTRO", "CANCELAMENTO", "PEDIDO_SEM_RESPOSTA", "OUTRO"]
        },
        produto: { type: "string" },
        nome_cliente: { type: "string" },
        telefone: { type: "string" },
        email: { type: "string" },
        nif: { type: "string" },
        cliente_existente: { type: "string", enum: ["sim", "nao", "desconhecido"] },
        dados_recolhidos: { type: "string" },
        campos_por_confirmar: { type: "string" },
        campos_em_falta: { type: "string" },
        quer_humano: { type: "boolean" },
        prioridade: { type: "string", enum: ["normal", "alta"] },
        resumo: { type: "string" },
        proximo_passo: { type: "string" },
        mencionou_dados_saude: { type: "boolean" }
      },
      required: [
        "categoria",
        "produto",
        "nome_cliente",
        "telefone",
        "email",
        "nif",
        "cliente_existente",
        "dados_recolhidos",
        "campos_por_confirmar",
        "campos_em_falta",
        "quer_humano",
        "prioridade",
        "resumo",
        "proximo_passo",
        "mencionou_dados_saude"
      ]
    },
    resultOrigem: "demo-cj-web",
    roleLabel: "CLARA"
  },
  simon: {
    id: "simon",
    label: "Simon Says Studio",
    assistantName: "Lia",
    company: "Simon Says Studio",
    firstMessage:
      "Olá, fala a Lia, assistente virtual do Simon Says Studio. Posso ajudar com fotografia, vídeo ou aluguer de estúdio em Lisboa, e tratar da sua marcação. Em que posso ajudar?",
    prompt: loadPrompt("prompts/simon.md"),
    transcriptionPrompt:
      "Chamada para o Simon Says Studio, estúdio de fotografia e vídeo em Lisboa. Termos frequentes: Lia, Simon Says, Simão, Jorge Simão, estúdio, ciclorama, cozinha, aluguer, sessão, fotografia, vídeo, gastronomia, moda, e-commerce, geral@simonsays.pt.",
    extractSystem: `Extrai, a partir da transcrição entre a assistente Lia (Simon Says Studio) e um cliente, os campos pedidos. 'dados_recolhidos' em formato 'campo: valor; campo: valor'. Categorias: INFO_SERVICOS, ALUGUER_ESTUDIO, SESSAO_FOTOGRAFIA, PRODUCAO_VIDEO, ORCAMENTO, FAQ_CONTACTO, OUTRO. Inclui tipo de projeto, data/janela pretendida, duração, necessidades de espaço (cozinha, ciclorama, luz natural) quando referidos. 'quer_humano' só se pediu explicitamente falar com uma pessoa. Resumo em 2 a 4 frases em português europeu para a equipa do estúdio. Campos vazios = "".`,
    extractSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        categoria: {
          type: "string",
          enum: [
            "INFO_SERVICOS",
            "ALUGUER_ESTUDIO",
            "SESSAO_FOTOGRAFIA",
            "PRODUCAO_VIDEO",
            "ORCAMENTO",
            "FAQ_CONTACTO",
            "OUTRO"
          ]
        },
        tipo_projeto: { type: "string" },
        nome_cliente: { type: "string" },
        telefone: { type: "string" },
        email: { type: "string" },
        data_preferida: { type: "string" },
        duracao: { type: "string" },
        necessidades_espaco: { type: "string" },
        dados_recolhidos: { type: "string" },
        campos_por_confirmar: { type: "string" },
        campos_em_falta: { type: "string" },
        quer_humano: { type: "boolean" },
        prioridade: { type: "string", enum: ["normal", "alta"] },
        resumo: { type: "string" },
        proximo_passo: { type: "string" }
      },
      required: [
        "categoria",
        "tipo_projeto",
        "nome_cliente",
        "telefone",
        "email",
        "data_preferida",
        "duracao",
        "necessidades_espaco",
        "dados_recolhidos",
        "campos_por_confirmar",
        "campos_em_falta",
        "quer_humano",
        "prioridade",
        "resumo",
        "proximo_passo"
      ]
    },
    resultOrigem: "demo-simon-web",
    roleLabel: "LIA"
  }
};

export function getDemo(id) {
  return demos[id] || null;
}
