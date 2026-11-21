/**
 * Tutorial 16, passo "Criar o primeiro pipeline": os modelos prontos e a validação, puros (testáveis sem DOM).
 * O CRM anota cada conversa do WhatsApp numa caixa de um pipeline; sem nenhum, nada é anotado.
 */
import type { CrmPipelineExtras } from "../../shared/ipc";

/** Campo que o modelo cria junto com o pipeline (`opcoes` só nas listas). */
export interface CampoModelo { nome: string; tipo: "TEXT" | "DROPDOWN"; opcoes?: readonly string[] }
export interface ModeloPipeline {
  id: string; titulo: string; texto: string; nome: string; etapas: readonly string[];
  /** Campos que nascem com o pipeline; sem isto, o pipeline nasce só com as etapas. */
  campos?: readonly CampoModelo[];
  /** O pipeline nasce com a marca `agenteAutonomo`: o agente cria caixa, preenche campos e muda etapa sem perguntar. */
  agenteAutonomo?: boolean;
}
/** O que o modelo acrescenta ao pipeline além de nome e etapas, na forma que o CRM da máquina recebe. */
export function extrasDoModelo(id: string): CrmPipelineExtras {
  const m = MODELOS_PIPELINE.find((x) => x.id === id);
  if (m === undefined) return {};
  return {
    ...(m.campos !== undefined ? { fields: m.campos.map((c) => ({ name: c.nome, type: c.tipo, options: [...(c.opcoes ?? [])] })) } : {}),
    ...(m.agenteAutonomo === true ? { agenteAutonomo: true } : {}),
  };
}

export const MODELOS_PIPELINE: readonly ModeloPipeline[] = [
  { id: "midia-paga", titulo: "Operação de mídia paga", texto: "Cada campanha ou pedido de anúncio, do briefing ao relatório.", nome: "Operação de Mídia Paga", etapas: ["Briefing", "Criativo", "Aprovação", "No ar", "Otimização", "Relatório"] },
  { id: "testes", titulo: "Testes de anúncio", texto: "Cada teste de anúncio: só escala o que gerou venda; o resto pausa com o aprendizado anotado.", nome: "Testes de Anúncios", etapas: ["Ideia", "Aprovado", "No ar", "Medindo (7 dias)", "Escalar", "Pausado"] },
  {
    id: "leads-site", titulo: "Leads do site", texto: "Cada pessoa que chega pelo site ou por anúncio, do primeiro contato à assinatura. O agente anota sozinho.", nome: "Leads do site",
    etapas: ["Novo", "Respondido", "Link enviado", "Baixou", "Assinou", "Perdido"],
    campos: [
      { nome: "Origem", tipo: "DROPDOWN", opcoes: ["Anúncio", "Site", "Indicação", "Outro"] },
      { nome: "Ref do anúncio", tipo: "TEXT" },
      { nome: "Produto de interesse", tipo: "DROPDOWN", opcoes: ["Pro", "Financeiro", "Módulos do Diego"] },
      { nome: "Sistema", tipo: "DROPDOWN", opcoes: ["Mac", "Windows", "Não sei"] },
    ],
    agenteAutonomo: true,
  },
  { id: "livre", titulo: "Do meu jeito", texto: "Você dá o nome e escreve as etapas.", nome: "", etapas: [] },
];

export const ETAPAS_MIN = 2;
export const ETAPAS_MAX = 12;

/** Texto do campo de etapas (uma por linha) → lista limpa. */
export const etapasDoTexto = (texto: string): string[] => texto.split(/\n|,/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);

/** Nome e etapas prontos para gravar, ou o motivo da recusa (em português, para a tela). */
export function validarPipeline(nome: string, etapas: readonly string[]): { ok: true; name: string; stages: string[] } | { ok: false; erro: string } {
  const name = nome.replace(/\s+/g, " ").trim();
  if (name === "") return { ok: false, erro: "Dê um nome ao pipeline." };
  if (name.length > 60) return { ok: false, erro: "Nome comprido demais (até 60 letras)." };
  const stages = etapas.map((e) => e.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (stages.length < ETAPAS_MIN) return { ok: false, erro: `Escreva pelo menos ${ETAPAS_MIN} etapas.` };
  if (stages.length > ETAPAS_MAX) return { ok: false, erro: `No máximo ${ETAPAS_MAX} etapas.` };
  const visto = new Set<string>();
  for (const s of stages) {
    if (s.length > 40) return { ok: false, erro: `Etapa comprida demais: "${s.slice(0, 20)}…" (até 40 letras).` };
    const k = s.toLowerCase();
    if (visto.has(k)) return { ok: false, erro: `Etapa repetida: "${s}".` };
    visto.add(k);
  }
  return { ok: true, name, stages };
}
