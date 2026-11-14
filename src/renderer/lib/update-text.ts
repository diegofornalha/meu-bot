/**
 * Texto da verificação de atualização (Configurações → "Sobre e atualização", o ponto da barra de cima e o
 * bloqueador de versão mínima), como no Rambox: cada fase vira uma frase. Puro, testado. `now` só para "conferido há X".
 */
import type { ReleasePublicada, UpdateState } from "../../shared/ipc";

export interface UpdateText {
  text: string;
  kind: "muted" | "ok" | "warn" | "bad";
  /** Mostrar "Reiniciar e atualizar". */
  showApply: boolean;
  /** O que o botão de aplicar diz: muda para "Parar e atualizar" quando interromper uma resposta é a escolha. */
  applyLabel: string;
  /** Mostrar "Mover para Aplicativos" (o app está numa pasta sem escrita). */
  showMove: boolean;
  /** Texto curto do ponto na barra de cima (null = ponto escondido). */
  short: string | null;
}

export const APLICAR = "Reiniciar e atualizar";
export const PARAR_E_APLICAR = "Parar e atualizar";

const ago = (iso: string | null, now: number): string => {
  if (iso === null) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (Number.isNaN(s)) return "";
  if (s < 60) return "conferido agora";
  if (s < 3600) return `conferido há ${Math.round(s / 60)} min`;
  if (s < 86_400) return `conferido há ${Math.round(s / 3600)} h`;
  return `conferido há ${Math.round(s / 86_400)} d`;
};
const maiuscula = (t: string): string => (t === "" ? t : t.charAt(0).toUpperCase() + t.slice(1));
export const pct = (p: number | null): string => (p === null ? "" : `${Math.floor(p * 100)}%`);

export function updateStateText(u: UpdateState, appName: string, now: number = Date.now()): UpdateText {
  switch (u.phase) {
    case "checking": return { text: "Verificando atualizações…", kind: "muted", showApply: false, applyLabel: APLICAR, showMove: false, short: "verificando atualizações…" };
    case "up-to-date": {
      const a = ago(u.checkedAt, now);
      // Versão fixada por um super admin: o app não se atualiza sozinho, e a frase diz quem fixou e se há mais nova.
      if (u.fixada !== null && u.fixada !== undefined) {
        const nova = u.available !== null && u.available !== u.fixada.versao ? ` Há a ${u.available} publicada.` : "";
        return { text: `Versão fixada na ${u.fixada.versao} por ${u.fixada.por}: o app não se atualiza sozinho.${nova}`, kind: "warn", showApply: false, applyLabel: APLICAR, showMove: false, short: "versão fixada" };
      }
      // Build local (hook do main ou dist à mão): a versão não sobe a cada merge e nenhuma release é mais nova;
      // "versão mais recente" fazia parecer que este era o último publicado.
      if (u.buildLocal === true) return { text: `Build local${u.commit === "" ? "" : ` do commit ${u.commit}`}, à frente da última versão publicada${a === "" ? "" : ` (${a})`}. As mudanças chegam por aqui quando um novo build é empacotado, não pela release.`, kind: "ok", showApply: false, applyLabel: APLICAR, showMove: false, short: null };
      return { text: `Você está na versão mais recente${a === "" ? "" : ` (${a})`}.`, kind: "ok", showApply: false, applyLabel: APLICAR, showMove: false, short: null };
    }
    case "available": return { text: `Nova versão ${u.available ?? ""} disponível, baixando…`, kind: "warn", showApply: false, applyLabel: APLICAR, showMove: false, short: "baixando a atualização…" };
    case "downloading": { const p = pct(u.progress); return { text: `Baixando a versão ${u.available ?? ""}…${p === "" ? "" : ` ${p}`}`, kind: "warn", showApply: false, applyLabel: APLICAR, showMove: false, short: `baixando${p === "" ? "…" : ` ${p}`}` }; }
    case "verifying": return { text: `Conferindo a versão ${u.available ?? ""}…`, kind: "warn", showApply: false, applyLabel: APLICAR, showMove: false, short: "conferindo a atualização…" };
    case "ready": {
      // A troca foi pedida e o bot continuou respondendo: em vez de atropelar a conversa, o app devolve a escolha.
      if (u.ocupadoAoAplicar) return { text: `${appName} ${u.ready ?? ""} está pronta, mas há uma resposta em andamento. Posso esperar ela terminar, ou parar agora e atualizar.`, kind: "warn", showApply: true, applyLabel: PARAR_E_APLICAR, showMove: false, short: "atualização esperando a resposta" };
      return { text: `${appName} ${u.ready ?? ""} pronta para instalar.`, kind: "warn", showApply: true, applyLabel: APLICAR, showMove: false, short: null };
    }
    case "applying": return { text: u.aguardando ? "Esperando a resposta em andamento terminar para atualizar…" : `Instalando a versão ${u.ready ?? ""}…`, kind: "warn", showApply: false, applyLabel: APLICAR, showMove: false, short: u.aguardando ? "atualiza quando a resposta terminar…" : "instalando…" };
    case "needs-move": return { text: "Esta conta do Mac não tem permissão para trocar o app (nem na pasta dele, nem na pasta Aplicativos). Atualize por uma conta de administrador do Mac.", kind: "bad", showApply: false, applyLabel: APLICAR, showMove: false, short: null };
    case "error": {
      if (u.errorKind === "rede" || u.error === "sem internet") return { text: "Sem internet; verifico as atualizações de novo quando a conexão voltar.", kind: "warn", showApply: false, applyLabel: APLICAR, showMove: false, short: null };
      // Disco cheio e release que não dá para instalar têm frase própria: a genérica mandaria a pessoa procurar no
      // lugar errado, e esta é justamente a situação em que o app pararia de atualizar sem ninguém notar.
      if (u.errorKind === "disco") return { text: `${maiuscula(u.error ?? "não há espaço em disco para a atualização")}. Libere espaço e eu tento de novo na próxima verificação.`, kind: "bad", showApply: false, applyLabel: APLICAR, showMove: false, short: "sem espaço para atualizar" };
      if (u.errorKind === "release") return { text: `Há uma versão nova publicada e não consegui instalá-la: ${u.error ?? "motivo desconhecido"}. A instalada continua funcionando.`, kind: "bad", showApply: false, applyLabel: APLICAR, showMove: false, short: "atualização publicada com problema" };
      return { text: `Não consegui verificar atualizações: ${u.error ?? "erro"}.`, kind: "bad", showApply: false, applyLabel: APLICAR, showMove: false, short: null };
    }
    default: return { text: "Atualização automática só no app instalado.", kind: "muted", showApply: false, applyLabel: APLICAR, showMove: false, short: null };
  }
}

/** O bloqueador "Atualização necessária" (o backend exige uma versão mais nova): título, frase e se o botão de reiniciar entra. */
export function updateBlockerText(u: UpdateState, appName: string): { title: string; text: string; showApply: boolean; applyLabel: string; showMove: boolean; showManual: boolean } {
  const min = u.minima ?? "";
  if (u.phase === "ready") {
    const t = updateStateText(u, appName);
    if (u.ocupadoAoAplicar) return { title: "Atualização pronta", text: t.text, showApply: true, applyLabel: t.applyLabel, showMove: false, showManual: false };
    return { title: "Atualização pronta", text: `Reinicie para terminar de instalar o ${appName} ${u.ready ?? ""}. Leva poucos segundos; as conversas e o WhatsApp ficam onde estavam.`, showApply: true, applyLabel: APLICAR, showMove: false, showManual: false };
  }
  if (u.phase === "applying") return { title: "Atualizando…", text: u.aguardando ? "Esperando a resposta em andamento terminar." : "Reiniciando na versão nova.", showApply: false, applyLabel: APLICAR, showMove: false, showManual: false };
  if (u.phase === "downloading" || u.phase === "verifying" || u.phase === "available" || u.phase === "checking") return { title: "Atualização necessária", text: `Esta máquina precisa do ${appName} ${min} ou mais novo (este é o ${u.current}). ${updateStateText(u, appName).text}`, showApply: false, applyLabel: APLICAR, showMove: false, showManual: false };
  const motivo = u.phase === "needs-move" ? updateStateText(u, appName).text : u.phase === "error" ? updateStateText(u, appName).text : "";
  // Com o backend exigindo uma versão nova e o app numa pasta sem escrita, mover é o ÚNICO caminho para destravar:
  // o botão tem de estar aqui também, senão esta tela só sabe mandar a pessoa baixar à mão.
  return { title: "Atualização necessária", text: `Esta máquina precisa do ${appName} ${min} ou mais novo (este é o ${u.current}).${motivo === "" ? "" : ` ${motivo}`}`, showApply: false, applyLabel: APLICAR, showMove: false, showManual: true };
}

export const ATUALIZAR_AGORA = "Atualizar agora";
/**
 * Botão "Atualizar agora" (verifica, baixa e reinicia num clique). Some quando "Reiniciar e atualizar" ou "Mover para
 * Aplicativos" já são a ação; no meio do caminho mostra que está trabalhando; num build local fica desligado com a
 * dica, porque a release só levaria para trás (o atualizador recusa) e a versão nova vem de empacotar de novo.
 */
export function updateNowButton(u: UpdateState): { hidden: boolean; disabled: boolean; label: string; title: string } {
  const t = updateStateText(u, "");
  const emCurso = u.phase === "checking" || u.phase === "available" || u.phase === "downloading" || u.phase === "verifying" || u.phase === "applying";
  if (u.buildLocal === true) return { hidden: t.showApply || t.showMove, disabled: true, label: ATUALIZAR_AGORA, title: "Este build vem de empacotar o código deste Mac (o rebuild do main), não de uma release: ele se atualiza quando um novo build é instalado." };
  // Sem permissão para trocar (needs-move), "Atualizar agora" baixaria de novo e esbarraria no mesmo lugar: some.
  return { hidden: t.showApply || t.showMove || u.phase === "needs-move", disabled: emCurso || u.phase === "idle", label: emCurso ? "Atualizando…" : ATUALIZAR_AGORA, title: "Procura a versão mais nova, baixa e reinicia o app nela." };
}

const REPO = "https://github.com/diegofornalha/meu-bot";
/**
 * "Notas de lançamento": num build local, o CHANGELOG do main (a seção "Ainda não lançado" é o que ele traz e nenhuma
 * release tem); numa release, a página da própria versão em vez da lista inteira.
 */
export function notasUrl(u: Pick<UpdateState, "buildLocal" | "current">): string {
  if (u.buildLocal === true) return `${REPO}/blob/main/docs/CHANGELOG.md`;
  return /^\d+\.\d+\.\d+(-staging\.\d+)?$/.test(u.current) ? `${REPO}/releases/tag/v${u.current}` : `${REPO}/releases`;
}

/** Quantas versões mais velhas a lista mostra antes do "Mostrar mais": voltar uma ou duas é o caso comum. */
export const VELHAS_VISIVEIS = 2;
/**
 * A lista "Versões publicadas" recolhida: a instalada, as mais novas e só as `VELHAS_VISIVEIS` mais velhas mais
 * recentes; o resto (incluindo as abaixo da mínima do backend) fica atrás do "Mostrar mais". `todas` mostra tudo.
 */
export function releasesVisiveis<T extends Pick<ReleasePublicada, "relacao">>(rs: readonly T[], todas: boolean): { visiveis: T[]; ocultas: number } {
  if (todas) return { visiveis: [...rs], ocultas: 0 };
  let velhas = 0;
  const visiveis = rs.filter((r) => r.relacao !== "mais-velha" || ++velhas <= VELHAS_VISIVEIS);
  return { visiveis, ocultas: rs.length - visiveis.length };
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "9 nov 2026" (o ano só quando não é o de `now`). */
export function dataCurta(iso: string | null, now: number = Date.now()): string {
  if (iso === null) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const ano = d.getFullYear() === new Date(now).getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MESES[d.getMonth()]}${ano}`;
}

/**
 * Uma linha da lista "Versões publicadas" (super admin): o selo, o botão (null = não instalável) e, no segundo
 * clique (`confirmando`), o aviso do que muda. Voltar de versão é o caso que pede o aviso: os ajustes criados depois
 * dela somem enquanto se está nela (voltam ao retornar) e, numa anterior a este recurso, a fixação dura a sessão.
 */
export function linhaRelease(r: ReleasePublicada, confirmando: boolean): { selo: string; kind: "muted" | "ok" | "warn" | "bad"; botao: string | null; aviso: string | null } {
  if (r.relacao === "atual") return { selo: "instalada", kind: "ok", botao: null, aviso: null };
  if (r.abaixoDaMinima) return { selo: "abaixo da mínima do backend", kind: "bad", botao: null, aviso: null };
  if (r.motivo !== null) return { selo: r.motivo, kind: "bad", botao: null, aviso: null };
  const velha = r.relacao === "mais-velha";
  const selo = velha ? "mais velha" : "mais nova";
  if (!confirmando) return { selo, kind: velha ? "warn" : "muted", botao: "Instalar esta", aviso: null };
  const aviso = velha
    ? `Voltar para a ${r.versao}: o app reinicia nela e fica fixado até alguém clicar em "Voltar a atualizar sozinho". Ajustes criados depois dela voltam ao padrão enquanto ela estiver aberta e retornam na volta. Se ela for anterior a este recurso, a fixação dura só até fechar o app.`
    : `Instalar a ${r.versao}: o app reinicia nela e fica fixado até alguém clicar em "Voltar a atualizar sozinho".`;
  return { selo, kind: velha ? "warn" : "muted", botao: `Confirmar: instalar a ${r.versao}`, aviso };
}
