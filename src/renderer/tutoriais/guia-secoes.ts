import type { StatusLineSegments, SupportInfo, SupportShare } from "../../shared/ipc";
import { byId as $, el } from "../lib/dom.js";
import { esperaOuFalha } from "../lib/carregando.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { hostLabel } from "../lib/probe-text.js";
import { previewLine, SL_TEST_COMMAND } from "../lib/status-line.js";
import { ctx } from "../app/ctx.js";
import { registrarPassos } from "./passos.js";
import { registrarFonte } from "./fontes.js";


let supportBusy = false;
const supportGroup = $<HTMLDetailsElement>("support-group");
const supportBody = $<HTMLElement>("support-body");
/** Liga sozinho uma vez por janela (máquina por SSH com o pacote), a não ser que o admin tenha desligado. */
let supportAutoTried = false;
let supportMsg: { text: string; bad: boolean } | null = null;
/** Código de suporte revelado (plano B; some ao fechar as Configurações ou esconder). */
let supportCodeShown: string | null = null;
let supportPoll: number | null = null;
/** Status line do Claude nesta máquina: instalada? (null = ainda não consultado); limites = a conta já tem números. */
let statusLineState: boolean | null = null;
let statusLineErro: string | null = null;
let statusLineBusy = false;
let statusLineLog: string[] = [];
let statusLineMsg: { text: string; bad: boolean } | null = null;
const accountHasLimits = (): boolean => ctx.account !== null && (ctx.account.sessionPct !== null || ctx.account.weeklyPct !== null);
let statusLineSegsBusy = false;
let statusLineSegsMsg: string | null = null;

export async function refreshStatusLine(): Promise<void> {
  if (!ctx.caps.install || ctx.windowHost === "") return;
  try { statusLineState = await window.meuBot.statusLineInstalled(); statusLineErro = null; } catch (err) { statusLineErro = ipcErrorText(err); /* fica o estado que havia */ }
  try { ctx.statusLineSegs = await window.meuBot.statusLineSegments(); } catch { /* idem */ }
  ctx.paintContext(ctx.active());
  ctx.paintGuide();
}
const SEGMENT_LABELS: { key: keyof StatusLineSegments; label: string; hint: string }[] = [
  { key: "model", label: "Modelo", hint: "qual modelo está respondendo" },
  { key: "ctx", label: "Contexto", hint: "quanto da janela de contexto já foi usado" },
  { key: "account", label: "Conta", hint: "e-mail e plano (Premium/Padrão)" },
  { key: "session", label: "Sessão", hint: "limite de 5 horas e quando reinicia" },
  { key: "weekly", label: "Semanal", hint: "limite de 7 dias e quando reinicia" },
  { key: "espaco", label: "Espaço", hint: "quanto do seu espaço na máquina já está usado (só no rodapé do meu-bot)" },
];
/** Passo "Escolher o que aparece": cinco interruptores, prévia da linha, gravação na máquina a cada troca. */
export function renderStatusLineSegments(container: HTMLElement): void {
  const cur: StatusLineSegments = ctx.statusLineSegs ?? { model: true, ctx: true, account: true, session: true, weekly: true, espaco: true };
  const box = el("div", "audio-controls");
  box.append(el("code", "sl-preview", previewLine(cur) || "(nada ligado)"));
  const list = el("div", "sl-switches");
  for (const s of SEGMENT_LABELS) {
    const sw = el("label", "switch switch-row"); sw.title = s.hint;
    const inp = el("input"); inp.type = "checkbox"; inp.checked = cur[s.key]; inp.disabled = statusLineSegsBusy || statusLineState !== true;
    sw.append(inp, el("span", "track"), el("span", "switch-label", s.label));
    inp.addEventListener("change", () => {
      const next = { ...cur, [s.key]: inp.checked };
      if (!Object.values(next).some(Boolean)) { inp.checked = true; statusLineSegsMsg = "Deixe pelo menos um ligado."; ctx.paintGuide(); return; }
      statusLineSegsBusy = true; statusLineSegsMsg = null; ctx.statusLineSegs = next; ctx.paintContext(ctx.active()); ctx.paintGuide();
      void window.meuBot.setStatusLineSegments(next)
        .then((saved) => { ctx.statusLineSegs = saved; })
        .catch((err: unknown) => { statusLineSegsMsg = ipcErrorText(err); })
        .finally(() => { statusLineSegsBusy = false; ctx.paintContext(ctx.active()); ctx.paintGuide(); });
    });
    list.append(sw);
  }
  box.append(list);
  // Nunca gravou nada (está no padrão): o passo só conclui quando a escolha vai para a máquina. O botão
  // grava a escolha atual, mesmo que seja o padrão; pulsa para dizer "é aqui".
  if (ctx.statusLineSegs === null && statusLineState === true) {
    const done = el("button", "btn btn-primary btn-small attention", statusLineSegsBusy ? "Gravando…" : "Concluir com esta escolha"); done.type = "button"; done.disabled = statusLineSegsBusy;
    done.title = "Grava a escolha nesta máquina e conclui o passo";
    done.addEventListener("click", () => {
      statusLineSegsBusy = true; statusLineSegsMsg = null; ctx.paintGuide();
      void window.meuBot.setStatusLineSegments(cur)
        .then((saved) => { ctx.statusLineSegs = saved; })
        .catch((err: unknown) => { statusLineSegsMsg = ipcErrorText(err); })
        .finally(() => { statusLineSegsBusy = false; ctx.paintContext(ctx.active()); ctx.paintGuide(); });
    });
    box.append(done);
  }
  if (statusLineState !== true) box.append(el("p", "hint", "Instale a status line (passo 1) para escolher."));
  if (statusLineSegsBusy) box.append(el("p", "hint", "gravando na máquina…"));
  if (statusLineSegsMsg !== null) box.append(el("p", "hint guide-pair-note", statusLineSegsMsg));
  container.append(box);
}
/** Passo "Conferir no terminal": digita o teste do script num terminal desta máquina; a pessoa dá Enter. */
export function renderStatusLineTest(container: HTMLElement): void {
  const b = el("button", "btn btn-primary btn-small", "Testar no terminal"); b.type = "button";
  b.addEventListener("click", () => { void ctx.runInTerminal(SL_TEST_COMMAND, "bash", true); });
  container.append(b);
}
/** Passo "Instalar a status line": Instalar (ou ✓ + Reinstalar), progresso do instalador e erro no próprio passo. */
export function renderStatusLineInstall(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  const row = el("div", "audio-row");
  if (statusLineState === true && !statusLineBusy) row.append(el("span", "audio-ok", "✓ instalada nesta máquina"));
  const b = el("button", `btn ${statusLineState === true ? "btn-ghost" : "btn-primary"} btn-small`, statusLineBusy ? "Instalando…" : statusLineState === true ? "Reinstalar" : "Instalar");
  b.type = "button"; b.disabled = statusLineBusy || statusLineState === null;
  b.addEventListener("click", () => {
    statusLineBusy = true; statusLineLog = []; statusLineMsg = null; ctx.paintGuide();
    void window.meuBot.installStatusLine()
      .then((r) => { statusLineMsg = r.ok ? { text: "Status line instalada.", bad: false } : { text: r.log.at(-1) ?? "a instalação falhou", bad: true }; })
      .catch((err: unknown) => { statusLineMsg = { text: ipcErrorText(err), bad: true }; })
      .finally(() => { statusLineBusy = false; void refreshStatusLine(); });
  });
  row.append(b);
  box.append(row);
  if (statusLineState === null) box.append(esperaOuFalha({ erro: statusLineErro, chave: "guia-statusline", tentar: () => { statusLineErro = null; ctx.paintGuide(); void refreshStatusLine(); } }));
  if (statusLineBusy && statusLineLog.length > 0) box.append(el("pre", "admin-logs", statusLineLog.join("\n")));
  if (statusLineMsg !== null) box.append(el("p", `hint ${statusLineMsg.bad ? "guide-pair-note" : "audio-ok"}`, statusLineMsg.text));
  container.append(box);
}

export async function refreshSupportState(): Promise<void> {
  if (ctx.windowHost === "" || ctx.windowHost === "local" || !ctx.caps.supportClient) return;
  try { ctx.supportState = await window.meuBot.supportInfo(); } catch { /* sem resposta: fica o que havia */ }
  repaintSupport();
  const s = ctx.supportState;
  if (s !== null && s.available && !s.on && !s.blockedByAdmin && !supportBusy && !supportAutoTried) {
    supportAutoTried = true;
    void supportDo(() => window.meuBot.setSupport(true, s.name !== "" ? s.name : s.suggestedName), "Suporte ligado. Avisando o admin…");
  } else if (s !== null && s.available && s.on && s.staleId && !supportBusy && !supportAutoTried) {
    // Código antigo na máquina (id só pela chave): regrava para esta conta não se misturar com outra na mesma máquina.
    supportAutoTried = true;
    void supportDo(() => window.meuBot.setSupport(true, s.name !== "" ? s.name : s.suggestedName), null);
  }
}
export function paintSupport(): void {
  const s = ctx.supportState;
  supportGroup.hidden = s === null || !s.available;
  if (s === null || !s.available) return;
  supportBody.replaceChildren();
  supportBody.append(el("p", "hint", s.on
    ? `Ligado: o admin consegue entrar em ${hostLabel(ctx.windowHost)} para te ajudar. Tudo o que ele fizer aparece abaixo. Só o admin desliga.`
    : s.blockedByAdmin ? "Desligado pelo admin. Se quiser pedir suporte de novo, clique em Ligar o suporte."
      : "Ligando o suporte…"));
  renderSupportParts(supportBody, ["name", "share", "delivery", "log"]);
}
export function repaintSupport(): void {
  if (ctx.dialog.open) paintSupport();
  ctx.paintGuide();
  // Ligado e o aviso ainda não chegou: confere de novo em 10 s (a máquina entrega sozinha).
  if (supportPoll !== null) { clearTimeout(supportPoll); supportPoll = null; }
  if (ctx.supportState?.on === true && ctx.supportState.deliveredAt === null) supportPoll = window.setTimeout(() => { supportPoll = null; void refreshSupportState(); }, 10_000);
}
async function supportDo(run: () => Promise<SupportInfo>, ok: string | null): Promise<void> {
  supportBusy = true; supportMsg = null; repaintSupport();
  try { ctx.supportState = await run(); supportMsg = ok === null ? null : { text: ok, bad: false }; }
  catch (err) { supportMsg = { text: ipcErrorText(err), bad: true }; }
  finally { supportBusy = false; repaintSupport(); }
}

type SupportPart = "name" | "share" | "delivery" | "log";
const SHOW_SUPPORT_SHARE = false;
export function renderSupportParts(container: HTMLElement, parts: readonly SupportPart[]): void {
  const s = ctx.supportState;
  if (s === null || !s.available) return;
  if (parts.includes("name")) {
    const row = el("div", "support-name");
    // Vazio, já vem com a sugestão (git/usuário do Mac): salvar liga o suporte com um clique.
    const name = el("input"); name.type = "text"; name.placeholder = "Seu nome"; name.value = s.name !== "" ? s.name : s.suggestedName; name.maxLength = 40;
    name.disabled = supportBusy;
    const save = el("button", `btn ${s.on ? "btn-ghost" : "btn-primary"} btn-small`, s.on ? "Salvar nome" : "Ligar o suporte"); save.type = "button"; save.disabled = supportBusy;
    // Salvar o nome liga o suporte (ligado, só regrava o aviso com o nome novo). Não há interruptor para a pessoa
    // desligar: quem desliga é o admin, pela página Suporte.
    save.addEventListener("click", () => { void supportDo(() => window.meuBot.setSupport(true, name.value), s.on ? null : "Suporte ligado. Avisando o admin…"); });
    name.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); save.click(); } });
    row.append(name, save);
    container.append(row, el("p", "hint", "É assim que o admin vai te ver (não é o nome da máquina)."));
  }
  // Escolha do que o admin vê: oculta por ora (poluía a tela); tudo segue compartilhado por padrão. SHOW_SUPPORT_SHARE religa.
  if (SHOW_SUPPORT_SHARE && parts.includes("share") && s.on) {
    container.append(el("p", "hint strong-hint", "O que o app do admin pode ver"));
    const SHARE_LABELS: { key: keyof SupportShare; label: string }[] = [
      { key: "progress", label: "Meu progresso nos tutoriais" },
      { key: "whatsapp", label: "O WhatsApp (estado e conversas, só leitura)" },
      { key: "logs", label: "Os registros do gateway e do backend" },
      { key: "chat", label: "Minhas conversas com o meu-bot (só leitura)" },
    ];
    const list = el("div", "support-share");
    for (const o of SHARE_LABELS) {
      const sw = el("label", "switch switch-row");
      const box = el("input"); box.type = "checkbox"; box.checked = s.share[o.key]; box.disabled = supportBusy;
      sw.append(box, el("span", "track"), el("span", "switch-label", o.label));
      box.addEventListener("change", () => { void supportDo(() => window.meuBot.setSupportShare({ ...s.share, [o.key]: box.checked }), null); });
      list.append(sw);
    }
    container.append(list);
  }
  // Backup completo pelo admin: sempre visível (é a única permissão desligada por padrão) e sempre escolha da pessoa.
  if (parts.includes("share") && s.on) {
    const sw = el("label", "switch switch-row");
    const box = el("input"); box.type = "checkbox"; box.checked = s.share.backup; box.disabled = supportBusy;
    sw.append(box, el("span", "track"), el("span", "switch-label", "Permitir backup completo pelo admin (para mudar de máquina; inclui a sessão do WhatsApp e seus logins)"));
    box.addEventListener("change", () => { void supportDo(() => window.meuBot.setSupportShare({ ...s.share, backup: box.checked }), null); });
    container.append(sw);
  }
  if (parts.includes("delivery") && s.on) {
    const box = el("div", "support-delivery");
    // "Avisar o admin agora": entrega o aviso na hora e o admin sincroniza (a máquina também avisa sozinha a cada 30 min).
    const now = el("button", "btn btn-ghost btn-small", supportBusy ? "Avisando…" : "Avisar o admin agora"); now.type = "button"; now.disabled = supportBusy;
    now.addEventListener("click", () => { void supportDo(() => window.meuBot.supportDeliver(), "Aviso entregue: o admin já vê esta máquina."); });
    if (s.deliveredAt !== null) { const row = el("div", "support-name"); row.append(el("p", "audio-ok", `✓ O admin recebeu o aviso (${new Date(s.deliveredAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}).`), now); box.append(row); }
    else {
      const wait = el("div", "wa-progress"); wait.append(el("span", "wa-pulse"), el("span", "grow", "Avisando o admin…"), now);
      box.append(wait);
    }
    // O código de suporte, para colar no meu-bot-admin ("Adicionar pessoa") quando a entrega automática não serve.
    const more = el("details", "support-more");
    more.open = supportCodeShown !== null;
    more.append(el("summary", "", "Código de suporte (para colar no meu-bot-admin)"));
    if (supportCodeShown === null) {
      const reveal = el("button", "btn btn-ghost btn-small", "Mostrar código"); reveal.type = "button";
      reveal.addEventListener("click", () => {
        reveal.disabled = true; reveal.textContent = "Gerando…";
        void window.meuBot.supportCode().then((code) => { supportCodeShown = code; repaintSupport(); })
          .catch((err: unknown) => { supportMsg = { text: ipcErrorText(err), bad: true }; repaintSupport(); });
      });
      more.append(reveal);
    } else {
      const code = el("textarea"); code.readOnly = true; code.rows = 3; code.value = supportCodeShown;
      code.addEventListener("focus", () => code.select());
      const copy = el("button", "btn btn-primary btn-small", "Copiar"); copy.type = "button";
      copy.addEventListener("click", () => { void navigator.clipboard.writeText(supportCodeShown ?? "").then(() => { copy.textContent = "Copiado"; window.setTimeout(() => { copy.textContent = "Copiar"; }, 1500); }); });
      more.append(code, copy, el("p", "hint", "Mande para o admin (WhatsApp, e-mail); ele cola em \"Adicionar pessoa\" no meu-bot-admin. Não é senha: diz só como o admin chega nesta máquina."));
    }
    box.append(more);
    container.append(box);
  }
  if (supportMsg !== null) container.append(el("p", `hint ${supportMsg.bad ? "guide-pair-note" : "audio-ok"}`, supportMsg.text));
  if (parts.includes("log") && s.log.length > 0) {
    // Registro de auditoria da máquina: por padrão só o que o suporte fez; "ver tudo" mostra também o que você, o
    // agente e o sistema fizeram.
    const box = el("div", "support-log-box");
    const draw = (): void => {
      const lista = supportLogAll ? s.log : s.log.filter((e) => e.tipo === "admin" || e.tipo === "legado");
      const head = el("p", "hint strong-hint", supportLogAll ? "Tudo o que aconteceu nesta máquina " : "O que o suporte fez nesta máquina ");
      const toggle = el("button", "btn btn-ghost btn-small", supportLogAll ? "só o suporte" : "ver tudo"); toggle.type = "button";
      toggle.addEventListener("click", () => { supportLogAll = !supportLogAll; draw(); });
      head.append(toggle);
      const ul = el("ul", "support-log");
      for (const e of lista) ul.append(el("li", "", `${new Date(e.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · ${e.who}: ${e.what}`));
      if (lista.length === 0) ul.append(el("li", "", "O suporte ainda não fez nada nesta máquina."));
      box.replaceChildren(head, ul);
    };
    draw();
    container.append(box);
  }
}
/** "ver tudo" no registro da máquina (Configurações › Suporte). */
let supportLogAll = false;

/** Liga eventos e registra os passos sem dono próprio (status line, suporte); o renderer.ts chama uma vez. */
export function ligarGuiaSecoes(): void {
  registrarFonte("statusline", () => ({ known: statusLineState !== null || !ctx.caps.install || ctx.windowHost === "", dados: { statusLine: { installed: statusLineState, limits: accountHasLimits(), segments: ctx.statusLineSegs } } }));
  registrarFonte("support", () => ({ known: ctx.supportState !== null || !ctx.caps.supportClient || ctx.windowHost === "" || ctx.windowHost === "local", dados: { support: ctx.supportState } }));
  registrarPassos({
    "statusline-install": (txt) => renderStatusLineInstall(txt),
    "statusline-segments": (txt) => renderStatusLineSegments(txt),
    "statusline-test": (txt) => renderStatusLineTest(txt),
    "support-name": (txt) => renderSupportParts(txt, ["name"]),
    "support-switch": (txt) => renderSupportParts(txt, ["share", "delivery", "log"]),
    "support-delivery": (txt) => renderSupportParts(txt, ["share", "delivery", "log"]),
  });
  window.meuBot.on("statusline:progress", ({ line }) => {
    statusLineLog = [...statusLineLog, line].slice(-6);
    ctx.paintGuide();
  });
}
