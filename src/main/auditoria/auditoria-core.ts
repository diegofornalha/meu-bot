/**
 * Registro de auditoria (quem fez o quê em cada máquina): catálogo de ações, leitura das linhas e verificação da
 * corrente. O formato e a gravação são do backend-colima/auditoria.py (dono único, roda na máquina); aqui só o que
 * o app precisa para pedir uma gravação e mostrar/conferir o que leu. Puro: testável com node --test.
 *
 * Linha: { v, em, maquina, quem:{tipo,nome}, app, acao, alvo, detalhe, prev, hash }, com
 * hash = sha256(prev + JSON canônico da linha sem "hash"). Cópia central (meu-bot-auditoria, usuário "auditoria" na
 * caixa do suporte): { n, recebidoEm, via:{papel,nome}, linha, prev, hash }, com a mesma regra.
 */
import { createHash } from "node:crypto";

export type QuemTipo = "dono" | "admin" | "agente" | "sistema" | "legado";
export interface Quem { tipo: QuemTipo; nome: string }
export const APPS = ["meu-bot", "meu-bot-crm", "meu-bot-admin", "meu-bot-admin-mac", "meu-bot-staging", "meu-bot-crm-staging", "meu-bot-finance-staging", "meu-bot-diego", "meu-bot-diego-staging", "backend", "plugin", "legado"] as const;
export type AuditoriaApp = (typeof APPS)[number];
export const isApp = (v: string): v is AuditoriaApp => (APPS as readonly string[]).includes(v);
export interface AuditoriaLinha { v: number; em: string; maquina: string; quem: Quem; app: string; acao: string; alvo: string; detalhe: string; prev: string; hash: string }
export interface AuditoriaCentral { n: number; recebidoEm: string; via: { papel: "admin" | "maquina" | "super"; nome: string }; linha: AuditoriaLinha; prev: string; hash: string }
/** O que o app pede para gravar (o resto a máquina completa). */
export interface AuditoriaEntrada { quem: { tipo: Exclude<QuemTipo, "legado">; nome: string }; app: AuditoriaApp; acao: Acao; alvo?: string; detalhe?: string }

/** Catálogo fechado: a ação gravada é a chave; o texto da tela sai daqui (alvo = número, caixa, device…). */
export const ACOES = {
  "financeiro.importar": (a: string) => `importou no financeiro a ${a}`,
  "suporte.ligar": () => "ligou o acesso do admin",
  "suporte.desligar": () => "desligou o acesso do admin",
  "suporte.desligar-pelo-admin": () => "desligou o suporte",
  "suporte.excluir-maquina": (a: string) => `excluiu esta máquina do suporte: limpou todo o histórico do WhatsApp${a ? ` (${a})` : ""} e desligou o suporte`,
  "licenca.atualizar": () => "atualizou a licença",
  "device.liberar": (a: string) => `liberou o device${a ? ` ${a}` : ""}`,
  "device.revogar": (a: string) => `revogou o device${a ? ` ${a}` : ""}`,
  "device.novo": (a: string) => `um Mac novo usou o meu-bot${a ? `: ${a}` : ""}`,
  "device.pedido": (a: string) => `pedido de device a mais${a ? `: ${a}` : ""}`,
  "plano.pedir": (a: string) => a || "pediu um plano",
  "plano.pago": (a: string) => a || "avisou que já pagou",
  "computador.instalar": () => "instalou a tela do bot (Computador)",
  "meu-bot.apagar-conversa": () => "apagou uma conversa dela com o meu-bot",
  "backend.instalar": (a: string) => `instalou o backend do meu-bot${a ? ` (${a})` : ""}`,
  "conta-claude.criada": (a: string) => `adicionou uma conta do Claude nesta máquina${a ? ` (${a})` : ""}`,
  "conta-claude.removida": (a: string) => `removeu uma conta do Claude desta máquina${a ? ` (${a})` : ""}`,
  "conta-claude.usar-agora": (a: string) => `voltou a usar a conta do Claude ${a} antes do reset do limite`,
  "servico.reiniciar-gateway": () => "reiniciou o gateway do OpenClaw",
  "servico.religar-gateway": (a: string) => `o vigia religou sozinho o gateway do OpenClaw${a ? ` (${a})` : ""}`,
  "servico.reiniciar-backend": () => "reiniciou o backend do meu-bot",
  "audio.ativar": () => "ativou a transcrição de áudio",
  "audio.desativar": () => "desativou a transcrição de áudio",
  "audio.voz": (a: string) => `escolheu a voz ${a} para as respostas em áudio`,
  "terminal.abrir": () => "abriu um terminal",
  "navegador.whatsapp-ligar": (a: string) => `deixou o agente do WhatsApp usar o Navegador${a ? ` (quem pode: ${a})` : ""}`,
  "navegador.whatsapp-desligar": () => "tirou o Navegador do agente do WhatsApp",
  "whatsapp.limpar": (a: string) => `limpou o histórico do WhatsApp de ${a}`,
  "whatsapp.excluir": (a: string) => `excluiu a conversa do WhatsApp de ${a}`,
  "whatsapp.restaurar": (a: string) => `restaurou a conversa do WhatsApp de ${a}`,
  "whatsapp.grupo.excluir": (a: string) => `excluiu da lista o grupo do WhatsApp ${a}`,
  "whatsapp.grupo.restaurar": (a: string) => `restaurou na lista o grupo do WhatsApp ${a}`,
  "whatsapp.arquivar": (a: string) => `arquivou a conversa do WhatsApp de ${a}`,
  "whatsapp.desarquivar": (a: string) => `desarquivou a conversa do WhatsApp de ${a}`,
  "whatsapp.renomear": (a: string) => `renomeou a conversa do WhatsApp de ${a}`,
  "whatsapp.pausar": (a: string) => `pausou o agente do WhatsApp para ${a}`,
  "whatsapp.retomar": (a: string) => `retomou o agente do WhatsApp para ${a}`,
  "whatsapp.pausa-automatica": (a: string) => `pausou sozinho o agente para ${a} (conversa em loop)`,
  "whatsapp.pausa-plugin": () => "ligou a pausa por contato com prazo no agente do WhatsApp (plugin do Hermes)",
  "whatsapp.dono": (a: string) => `definiu o dono do agente do WhatsApp${a ? ` (${a})` : ""}`,
  "whatsapp.parear": () => "pareou o WhatsApp",
  "whatsapp.desconectar": () => "desconectou o WhatsApp",
  "whatsapp.grupo-ligar": (a: string) => `ligou o agente no grupo do WhatsApp ${a}`,
  "whatsapp.grupo-desligar": (a: string) => `desligou o agente no grupo do WhatsApp ${a}`,
  "whatsapp.grupo-quem": (a: string) => `mudou quem pode conversar com o agente nos grupos do WhatsApp${a ? ` (${a})` : ""}`,
  "whatsapp.quem-responde": (a: string) => `mudou quem o agente responde no WhatsApp${a ? ` (${a})` : ""}`,
  "whatsapp.agente": (a: string) => `escolheu o agente do WhatsApp${a ? ` (${a})` : ""}`,
  "crm.guardar-conversa": (a: string) => `guardou no CRM a conversa do WhatsApp de ${a}`,
  "crm.instalar": () => "instalou o CRM pelo WhatsApp",
  "finance.instalar": () => "instalou o financeiro (WhatsApp e chat)",
  "modulo.ligar": (a: string) => `ligou o módulo ${a}`,
  "modulo.desligar": (a: string) => `desligou o módulo ${a}`,
  "modulo.credenciais": (a: string) => `trocou as chaves do módulo ${a}`,
  "modulo.opcoes": (a: string) => `mudou as opções do módulo ${a}`,
  "finance.lancar": (a: string) => `lançou ${a} no financeiro pelo app`,
  "finance.linha": (a: string) => `mudou a DRE prevista do financeiro (${a})`,
  "finance.corrigir": (a: string) => `corrigiu um lançamento do financeiro (${a})`,
  "finance.descartar": (a: string) => `descartou o lançamento ${a} do financeiro`,
  "finance.fechar-mes": (a: string) => `fechou o mês ${a} no financeiro`,
  "crm.pipeline-criar": (a: string) => `criou o pipeline ${a} no CRM`,
  "crm.pipeline-padrao": (a: string) => `escolheu o pipeline ${a} para as conversas do WhatsApp`,
  "crm.desinstalar": () => "desinstalou o CRM pelo WhatsApp",
  "backup.criar": (a: string) => `fez um backup completo desta máquina${a ? ` (${a})` : ""}`,
  "backup.restaurar": (a: string) => `restaurou nesta máquina o backup da máquina ${a}`,
  "backup.desativar-origem": (a: string) => `desligou o WhatsApp desta máquina: ele passou para a máquina ${a}`,
  "backup.ativar-whatsapp": () => "ligou o WhatsApp nesta máquina (mudança de máquina)",
  "usuarios.criar": (a: string) => `criou o usuário ${a} nesta máquina`,
  "usuarios.limite": (a: string) => `mudou o limite de disco do usuário ${a}`,
  "usuarios.apagar": (a: string) => `apagou o usuário ${a} desta máquina`,
  "usuarios.seletor": (a: string) => `pôs o usuário ${a} nos seletores do meu-bot e do admin`,
  "usuarios.apelido": (a: string) => `mudou o apelido do usuário ${a}`,
  "usuarios.whatsapp-alvo": (a: string) => `mudou onde vive o WhatsApp do usuário ${a}`,
  "usuarios.ligado": (a: string) => `deixou o usuário ${a} sempre ligado (o agente dele roda sem ele conectado)`,
  "maquina.preparar": (a: string) => `preparou esta máquina${a ? ` (${a})` : ""}`,
  "maquina.cota": (a: string) => `ligou a cota de disco por usuário nesta máquina${a ? ` (${a})` : ""}`,
  "maquina.pacotes": (a: string) => `instalou pacotes do sistema nesta máquina${a ? ` (${a})` : ""}`,
  "maquina.gh": (a: string) => `instalou o GitHub CLI para todos nesta máquina${a ? ` (${a})` : ""}`,
  "maquina.swap": (a: string) => `ligou a memória de reserva (swap) desta máquina${a ? ` (${a})` : ""}`,
  "maquina.reserva": (a: string) => `reservou memória para o sistema desta máquina (teto dos usuários${a ? ` ${a}` : ""})`,
  "maquina.isolamento": (a: string) => `aplicou o isolamento de RAM/CPU às boxes desta máquina${a ? ` (${a})` : ""}`,
  "maquina.box": (a: string) => `o vigia avisou que a box está no limite de RAM/CPU${a ? ` (${a})` : ""}`,
  "maquina.memoria": (a: string) => `o vigia avisou que a memória da máquina está no fim${a ? ` (${a})` : ""}`,
  "maquina.disco": (a: string) => `o vigia avisou que o disco da máquina está quase cheio${a ? ` (${a})` : ""}`,
  "maquina.lag": (a: string) => `o vigia avisou que o backend está travando${a ? ` (${a})` : ""}`,
  "cota.aviso": (a: string) => `o vigia avisou que o espaço dela na máquina está em ${a || "alta"}`,
  "cota.pedir-mais": (a: string) => `pediu mais espaço na máquina${a ? ` (estava em ${a})` : ""}`,
  "cota.liberar": (a: string) => `apagou ${a || "um item"} para liberar espaço`,
  "maquina.hermes-global": (a: string) => `instalou o Hermes${a ? ` ${a}` : ""} para todos os usuários desta máquina`,
  "usuarios.preparar": (a: string) => `preparou a conta de ${a} (Claude Code, backend do meu-bot, Hermes e transcrição)`,
  "maquina.claude-global": (a: string) => `instalou o Claude Code Global desta máquina${a ? ` (conta ${a})` : ""}`,
  "maquina.claude-global-conta": (a: string) => `pôs uma conta no rodízio do Claude Code Global (${a})`,
  "usuarios.claude-global-ligar": (a: string) => `ligou o Claude Code Global para ${a}`,
  "usuarios.claude-global-desligar": (a: string) => `desligou o Claude Code Global para ${a}`,
  "maquina.link-publico": (a: string) => `instalou o Link Público Global desta máquina${a ? ` (*.${a})` : ""}`,
  "maquina.link-publico-tunel": (a: string) => `subiu o túnel da Cloudflare do Link Público Global${a ? ` (${a})` : ""}`,
  "usuarios.link-publico-ligar": (a: string) => `ligou o link público de ${a}`,
  "usuarios.link-publico-desligar": (a: string) => `desligou o link público de ${a}`,
  "usuarios.link-publico-publicar": (a: string) => `publicou um arquivo no link público de ${a}`,
  "usuarios.link-publico-remover": (a: string) => `tirou um item do ar no link público de ${a}`,
  "link-publico.nome": (a: string) => `trocou o nome do link público dela${a ? ` para ${a}` : ""}`,
  "link-publico.publicar": (a: string) => `publicou ${a || "um arquivo"} no link público dela`,
  "link-publico.remover": (a: string) => `tirou ${a || "um item"} do ar no link público dela`,
  "maquina.transcritor": (a: string) => `instalou o transcritor de áudio para todos os usuários desta máquina${a ? ` (${a})` : ""}`,
  "usuarios.recursos": (a: string) => `mudou os tetos de RAM e CPU do usuário ${a}`,
  "usuarios.liberar": (a: string) => `apagou arquivos do usuário ${a} para liberar espaço`,
  "backup.dados-drive": (a: string) => `guardou uma cópia dos dados desta máquina no Google Drive do dono${a ? ` (${a})` : ""}`,
  "gmail.apagar": (a: string) => `moveu um e-mail para a lixeira do Gmail${a ? ` (${a})` : ""}`,
  "gmail.restaurar": (a: string) => `tirou um e-mail da lixeira do Gmail${a ? ` (${a})` : ""}`,
} satisfies Record<string, (alvo: string) => string>;
export type Acao = keyof typeof ACOES;
export const isAcao = (v: string): v is Acao => Object.prototype.hasOwnProperty.call(ACOES, v);

/** Frase da tela: "Lucas (admin) pausou o agente do WhatsApp para +55…"; legado mostra o texto antigo. */
export function textoDaLinha(l: Pick<AuditoriaLinha, "acao" | "alvo" | "detalhe">): string {
  if (isAcao(l.acao)) return ACOES[l.acao](l.alvo);
  return l.detalhe || l.acao;
}

/** JSON canônico (chaves em ordem, sem espaços), o mesmo do auditoria.py (json.dumps sort_keys, separators). */
export function canonica(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => (x !== null && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));
}
const selo = (o: { prev: string; hash: string }): string => { const { hash: _h, ...sem } = o; return createHash("sha256").update(o.prev + canonica(sem)).digest("hex"); };

/** Onde a corrente quebra: índice da primeira linha com hash errado ou que não aponta para a anterior; null = íntegra. */
export function quebraDaCorrente(linhas: readonly { prev: string; hash: string }[]): number | null {
  let prev = "";
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i]!;
    if (l.prev !== prev || selo(l) !== l.hash) return i;
    prev = l.hash;
  }
  return null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
function parseLinha(o: unknown): AuditoriaLinha | null {
  if (!isObj(o) || !isObj(o.quem) || !/^[0-9a-f]{64}$/.test(str(o.hash))) return null;
  const tipo = str(o.quem.tipo);
  return { v: typeof o.v === "number" ? o.v : 1, em: str(o.em), maquina: str(o.maquina), quem: { tipo: (["dono", "admin", "agente", "sistema", "legado"].includes(tipo) ? tipo : "legado") as QuemTipo, nome: str(o.quem.nome) }, app: str(o.app), acao: str(o.acao), alvo: str(o.alvo), detalhe: str(o.detalhe), prev: str(o.prev), hash: str(o.hash) };
}
/**
 * Linhas do auditoria.jsonl como a máquina imprimiu (uma por linha). O objeto original fica junto para a corrente
 * ser conferida sobre o que foi gravado, não sobre a versão já saneada.
 */
export function parseLinhas(stdout: string): { linha: AuditoriaLinha; bruto: Record<string, unknown> }[] {
  const out: { linha: AuditoriaLinha; bruto: Record<string, unknown> }[] = [];
  for (const t of stdout.split("\n")) {
    if (!t.startsWith("{")) continue;
    try { const o = JSON.parse(t) as unknown; const l = parseLinha(o); if (l !== null && isObj(o)) out.push({ linha: l, bruto: o as Record<string, unknown> }); } catch { /* linha cortada */ }
  }
  return out;
}
export function parseCentral(stdout: string): { registro: AuditoriaCentral; bruto: Record<string, unknown> }[] {
  const out: { registro: AuditoriaCentral; bruto: Record<string, unknown> }[] = [];
  for (const t of stdout.split("\n")) {
    if (!t.startsWith("{")) continue;
    try {
      const o = JSON.parse(t) as unknown;
      if (!isObj(o) || !isObj(o.via)) continue;
      const linha = parseLinha(o.linha);
      const papel = str(o.via.papel);
      if (linha === null || !/^[0-9a-f]{64}$/.test(str(o.hash)) || !["admin", "maquina", "super"].includes(papel)) continue;
      out.push({ registro: { n: typeof o.n === "number" ? o.n : 0, recebidoEm: str(o.recebidoEm), via: { papel: papel as AuditoriaCentral["via"]["papel"], nome: str(o.via.nome) }, linha, prev: str(o.prev), hash: str(o.hash) }, bruto: o as Record<string, unknown> });
    } catch { /* linha cortada */ }
  }
  return out;
}

/**
 * Comparação da máquina com a central: linhas que a central recebeu e sumiram da máquina (alguém apagou), e se
 * cada corrente está íntegra.
 */
export function conferir(maquina: readonly Record<string, unknown>[], central: readonly Record<string, unknown>[]): { maquinaQuebraEm: number | null; centralQuebraEm: number | null; faltamNaMaquina: string[] } {
  const naMaquina = new Set(maquina.map((l) => str(l.hash)));
  const faltam = central.map((r) => (isObj(r.linha) ? str(r.linha.hash) : "")).filter((h) => h !== "" && !naMaquina.has(h));
  const asCorrente = (xs: readonly Record<string, unknown>[]): { prev: string; hash: string }[] => xs as unknown as { prev: string; hash: string }[];
  return { maquinaQuebraEm: quebraDaCorrente(asCorrente(maquina)), centralQuebraEm: quebraDaCorrente(asCorrente(central)), faltamNaMaquina: faltam };
}

/** Script que grava uma linha na máquina: o auditoria.py vai pela entrada padrão (a máquina não precisa tê-lo). */
export function auditoriaSh(py: string, e: AuditoriaEntrada): string {
  const b64 = Buffer.from(JSON.stringify(e), "utf8").toString("base64url");
  return `python3 - gravar '${b64}' <<'MEUBOT_AUDITORIA_PY'\n${py.replace(/\n?$/, "\n")}MEUBOT_AUDITORIA_PY`;
}
/** Script que lê as linhas da máquina: as `n` últimas, ou todas depois do hash `apos`. */
export function auditoriaLerSh(py: string, o: { n?: number; apos?: string | undefined }): string {
  const args = [o.n !== undefined ? `--n ${Math.max(0, Math.trunc(o.n))}` : "", o.apos !== undefined && /^[0-9a-f]{64}$/.test(o.apos) ? `--apos ${o.apos}` : ""].filter(Boolean).join(" ");
  return `python3 - ler ${args} <<'MEUBOT_AUDITORIA_PY'\n${py.replace(/\n?$/, "\n")}MEUBOT_AUDITORIA_PY`;
}

/** Ações de marca da lista do WhatsApp (whatsapp:mark) → ação do catálogo; migração e cache de nomes não contam. */
export function acaoDaMarca(p: { deleted?: boolean; archived?: boolean; alias?: string; at?: string }): Acao | null {
  if (p.at !== undefined) return null;
  if (p.deleted === true) return "whatsapp.excluir";
  if (p.deleted === false) return "whatsapp.restaurar";
  if (p.archived === true) return "whatsapp.arquivar";
  if (p.archived === false) return "whatsapp.desarquivar";
  if (p.alias !== undefined) return "whatsapp.renomear";
  return null;
}
