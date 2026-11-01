/**
 * Variante: admin. Aba "Claude Code Global", abaixo de Usuários: a assinatura do root servindo todos os usuários desta
 * máquina, gerida só aqui. Instala o intermediário do root, entra na conta do root (Terminal), mantém o rodízio de
 * contas do root (o que o tutorial 2 faz para uma pessoa, aqui para todos) e liga ou desliga o global por usuário.
 * Quem está no global vê isso no meu-bot dele, sem poder mexer; se o global esgotar, cai para a conta própria dele.
 * Fábrica como usuarios-page.ts; o main confere tudo como root.
 */
import type { CgConta, CgEstado, MeuBotApi } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { carregando as espera } from "../lib/carregando.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";

export interface ClaudeGlobalPageDeps {
  who: string;
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  api: Pick<MeuBotApi, "adminClaudeGlobal" | "adminClaudeGlobalInstalar" | "adminClaudeGlobalEntrar" | "adminClaudeGlobalContaNova" | "adminClaudeGlobalContaRemover" | "adminClaudeGlobalContaUsar" | "adminClaudeGlobalUsuario" | "adminClaudeGlobalLimiares" | "adminClaudeGlobalContaEditar" | "on">;
}

const quando = (s: number | null): string => (s === null ? "nunca" : new Date(s * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }));
const pct = (v: number | null): string => (v === null ? "—" : `${Math.round(v)}%`);
function estadoConta(c: CgConta): string {
  if (!c.logada) return "sem login";
  if (c.estado === "esgotada") return `no limite${c.ate !== null ? ` até ${quando(c.ate)}` : ""}`;
  if (c.estado === "bloqueada") return c.motivo ?? "recusada";
  if (c.estado === "aviso") return "perto do limite";
  return "disponível";
}

export function mountClaudeGlobalPage(deps: ClaudeGlobalPageDeps): { open: () => void } {
  let page: PageTab | null = null;
  let estado: CgEstado | null = null;
  let erro: string | null = null;
  let ocupado: string | null = null;
  let msg: { text: string; bad: boolean } | null = null;
  /** Depois de abrir um login no Terminal, relê sozinho até o login aparecer (no máximo 15 min). */
  let vigia: ReturnType<typeof setInterval> | null = null;

  async function ler(): Promise<void> {
    erro = null; render();
    try { estado = await deps.api.adminClaudeGlobal(); } catch (e) { erro = ipcErrorText(e); }
    render();
  }
  async function rodar(chave: string, f: () => Promise<CgEstado | void>, ok: string): Promise<void> {
    ocupado = chave; msg = null; render();
    try { const r = await f(); if (r) estado = r; msg = { text: ok, bad: false }; }
    catch (e) { msg = { text: `✗ ${ipcErrorText(e)}`, bad: true }; }
    finally { ocupado = null; render(); }
  }
  /** Acompanha um login aberto no Terminal: relê a cada 10 s até `pronto(estado)` ou 15 min. */
  function vigiar(pronto: (e: CgEstado) => boolean): void {
    if (vigia !== null) clearInterval(vigia);
    const ate = Date.now() + 15 * 60_000;
    vigia = setInterval(() => {
      if (Date.now() > ate) { if (vigia !== null) clearInterval(vigia); vigia = null; return; }
      void deps.api.adminClaudeGlobal().then((e) => { estado = e; if (pronto(e) && vigia !== null) { clearInterval(vigia); vigia = null; msg = { text: "✓ Login confirmado.", bad: false }; } render(); }).catch(() => { /* tenta de novo */ });
    }, 10_000);
  }
  // O onboarding (aba Usuários) liga o global para a conta nova no fim do job. Quando esse passo chega, a lista daqui
  // relê sozinha: antes, uma aba aberta no meio do job mostrava a conta nova como "desligada" até ser reaberta.
  let releitura: ReturnType<typeof setTimeout> | null = null;
  deps.api.on("admin:usuarios-progresso", (p) => {
    if (page === null || !/Claude Code Global|^pronto|^✗ parou|^usuário .* criado/.test(p.line)) return;
    if (releitura !== null) clearTimeout(releitura);
    releitura = setTimeout(() => { releitura = null; if (ocupado === null) void ler(); }, 1500);
  });
  const botao = (rotulo: string, chave: string, primario = false): HTMLButtonElement => {
    const b = el("button", `btn ${primario ? "btn-primary" : "btn-ghost"} btn-small`, ocupado === chave ? "…" : rotulo) as HTMLButtonElement;
    b.type = "button"; b.disabled = ocupado !== null; return b;
  };

  function render(): void {
    if (page === null) return;
    const panel = page.panel; panel.replaceChildren();
    const head = el("div", "guide-head"); const hb = el("div", "tut-body");
    hb.append(el("span", "tut-badge", "claude code global"), el("h2", "", `Claude Code Global · ${deps.who}`),
      el("p", "", "A assinatura do root responde por todos os usuários desta máquina. A gestão é só daqui: cada usuário vê no meu-bot dele que está no global, sem poder mexer. Se o global chegar ao limite, quem tiver uma conta própria segue por ela; sem conta própria, o Grok assume, se a xAI estiver logada na máquina."));
    head.append(hb); panel.append(head);
    if (estado === null) { panel.append(erro !== null ? el("p", "hint bad-hint", `✗ ${erro}`) : espera("Lendo o Claude Code Global…")); return; }
    const e = estado;

    // 1. Conta do root e o intermediário.
    const conta = el("div", "admin-card"); conta.append(el("strong", "", "Conta do root"));
    if (!e.login) {
      conta.append(el("p", "hint", "O root ainda não entrou no Claude Code. O login abre no Terminal deste Mac: aprove no navegador e volte; esta aba confirma sozinha."));
      const b = botao("Entrar no Claude Code do root", "entrar", true);
      b.addEventListener("click", () => { void rodar("entrar", () => deps.api.adminClaudeGlobalEntrar(), "Login aberto no Terminal. Esta aba confirma sozinha quando terminar.").then(() => vigiar((x) => x.login)); });
      conta.append(b);
    } else {
      conta.append(el("p", "", `${e.email ?? "conta sem e-mail"}${e.plano !== null ? ` · ${e.plano}` : ""}`));
    }
    const servico = el("p", "hint", !e.instalado ? "O intermediário ainda não está instalado nesta máquina." : e.ativo ? `Intermediário no ar (127.0.0.1:${e.porta ?? "?"}); o token fica só com o root.` : "O intermediário está instalado, mas parado: instale de novo para subir.");
    conta.append(servico);
    const inst = botao(e.instalado ? "Atualizar o intermediário" : "Instalar o Claude Code Global", "instalar", !e.instalado && e.login);
    inst.disabled = ocupado !== null || !e.login;
    if (!e.login) inst.title = "Entre no Claude Code do root antes";
    inst.addEventListener("click", () => { void rodar("instalar", () => deps.api.adminClaudeGlobalInstalar(), "✓ Claude Code Global no ar. Ligue-o para os usuários abaixo; os criados daqui para frente já nascem nele."); });
    conta.append(inst);
    panel.append(conta);

    // 2. Rodízio do root (o tutorial 2, aqui para todos).
    if (e.instalado) {
      const rod = el("div", "admin-card"); rod.append(el("strong", "", "Rodízio de contas do root"));
      rod.append(el("p", "hint", "Quando uma conta chega ao limite, a próxima assume para todos. O login do root é a base e fica por último."));
      const t = el("table", "usuarios-tabela");
      const th = el("tr"); for (const h of ["Conta", "Sessão", "Semana", "Estado", ""]) th.append(el("th", "", h)); t.append(th);
      // As contas que a pessoa ordena (o login do root fica sempre por último, como a padrão no tutorial 2).
      const isoladas = e.contas.filter((x) => x.id !== "padrao");
      for (const c of e.contas) {
        const tr = el("tr");
        tr.append(el("td", "", c.email ?? c.rotulo), el("td", "", pct(c.sessaoPct)), el("td", "", pct(c.semanalPct)), el("td", "", c.ativa ? estadoConta(c) : "desligada do rodízio"));
        const acoes = el("td", "");
        const i = isoladas.findIndex((x) => x.id === c.id);
        if (i > 0) {
          const up = botao("↑", `ordem:${c.id}`); up.title = "Preferir antes";
          up.addEventListener("click", () => { const ids = isoladas.map((x) => x.id); [ids[i - 1], ids[i]] = [ids[i]!, ids[i - 1]!]; void rodar(`ordem:${c.id}`, () => deps.api.adminClaudeGlobalContaEditar({ ordem: ids }), "✓ Ordem do rodízio gravada."); });
          acoes.append(up, " ");
        }
        if (i >= 0 && i < isoladas.length - 1) {
          const down = botao("↓", `ordem:${c.id}`); down.title = "Preferir depois";
          down.addEventListener("click", () => { const ids = isoladas.map((x) => x.id); [ids[i], ids[i + 1]] = [ids[i + 1]!, ids[i]!]; void rodar(`ordem:${c.id}`, () => deps.api.adminClaudeGlobalContaEditar({ ordem: ids }), "✓ Ordem do rodízio gravada."); });
          acoes.append(down, " ");
        }
        const lg = botao(c.ativa ? "Desligar" : "Ligar", `ativa:${c.id}`);
        lg.title = c.ativa ? "Tira esta conta do rodízio (sem sair dela)" : "Devolve esta conta ao rodízio";
        lg.addEventListener("click", () => { void rodar(`ativa:${c.id}`, () => deps.api.adminClaudeGlobalContaEditar({ id: c.id, ativa: !c.ativa }), c.ativa ? "✓ Conta fora do rodízio." : "✓ Conta de volta ao rodízio."); });
        acoes.append(lg, " ");
        const cf = botao("Conferir", `conferir:${c.id}`); cf.title = "Relê login, e-mail e uso desta conta";
        cf.addEventListener("click", () => { void rodar(`conferir:${c.id}`, () => deps.api.adminClaudeGlobalContaEditar({ id: c.id, conferir: true }), "✓ Conta conferida."); });
        acoes.append(cf, " ");
        if (c.estado === "esgotada") {
          const u = botao("Usar agora", `usar:${c.id}`);
          u.title = "O limite voltou antes do previsto: devolve a conta ao rodízio";
          u.addEventListener("click", () => { void rodar(`usar:${c.id}`, () => deps.api.adminClaudeGlobalContaUsar(c.id), "✓ Conta de volta ao rodízio."); });
          acoes.append(u, " ");
        }
        if (c.id !== "padrao") {
          const r = botao("Remover", `remover:${c.id}`);
          r.addEventListener("click", () => { void rodar(`remover:${c.id}`, () => deps.api.adminClaudeGlobalContaRemover(c.id), "✓ Conta removida do rodízio."); });
          acoes.append(r);
        }
        tr.append(acoes); t.append(tr);
      }
      const rolo = el("div", "usuarios-rolo"); rolo.append(t); rod.append(rolo);
      const nova = botao("Adicionar conta ao rodízio", "nova");
      nova.addEventListener("click", () => {
        const antes = e.contas.filter((c) => c.logada).length;
        void rodar("nova", () => deps.api.adminClaudeGlobalContaNova(), "Login da conta nova aberto no Terminal. Esta aba confirma sozinha.").then(() => vigiar((x) => x.contas.filter((c) => c.logada).length > antes));
      });
      rod.append(nova);
      // Os limiares do tutorial 2, para o rodízio do root: o intermediário anota o uso a cada resposta.
      if (e.limiares !== null) {
        const lim = el("div", "conta-claude-limiares");
        const num = (rotulo: string, k: "sessao" | "semanal"): HTMLLabelElement => {
          const l = el("label", "", `${rotulo} `); const i = el("input") as HTMLInputElement; i.type = "number"; i.min = "50"; i.max = "100"; i.step = "1"; i.value = String(e.limiares![k]); i.disabled = ocupado !== null;
          i.addEventListener("change", () => { const n = Number(i.value); if (Number.isInteger(n)) void rodar("limiares", () => deps.api.adminClaudeGlobalLimiares({ [k]: n }), "✓ Limiar do rodízio gravado."); });
          l.append(i, "%"); return l;
        };
        const sel = el("select") as HTMLSelectElement; sel.disabled = ocupado !== null;
        for (const [v, txt] of [["ordem", "pela ordem da lista"], ["folga", "quem tem mais cota sobrando"]] as const) { const o = el("option", "", txt) as HTMLOptionElement; o.value = v; o.selected = e.limiares.estrategia === v; sel.append(o); }
        sel.addEventListener("change", () => { const v = sel.value; if (v === "ordem" || v === "folga") void rodar("limiares", () => deps.api.adminClaudeGlobalLimiares({ estrategia: v }), "✓ Ordem do rodízio gravada."); });
        const selL = el("label", "", "Qual conta vai primeiro: "); selL.append(sel);
        lim.append(el("span", "hint", "Troca de conta ao passar de"), num("sessão (5 h)", "sessao"), num("semana", "semanal"), selL);
        rod.append(lim);
      }
      panel.append(rod);

      // 3. Usuários no global.
      const us = el("div", "admin-card");
      const cab = el("div", "admin-actions"); cab.append(el("strong", "", "Usuários no global"));
      const atualizar = botao("Atualizar", "ler"); atualizar.title = "Relê a lista agora (ela também relê sozinha quando um usuário é criado ou preparado)";
      atualizar.addEventListener("click", () => { void ler(); });
      cab.append(atualizar); us.append(cab);
      if (e.usuarios.length === 0) us.append(el("p", "hint", "Nenhum usuário de login além do root."));
      else {
        const tu = el("table", "usuarios-tabela");
        const hu = el("tr"); for (const h of ["Usuário", "Global", "Chamadas", "Última vez", "No limite", ""]) hu.append(el("th", "", h)); tu.append(hu);
        for (const u of e.usuarios) {
          const tr = el("tr");
          tr.append(el("td", "", u.nome), el("td", u.ligado ? "audio-ok" : "hint", u.ligado ? "ligado" : "desligado"), el("td", "", String(u.chamadas)), el("td", "", quando(u.ultima)), el("td", "", String(u.limites)));
          const td = el("td", "");
          const b = botao(u.ligado ? "Desligar" : "Ligar", `usuario:${u.nome}`, !u.ligado);
          b.title = u.ligado ? "Ele passa a responder só pela conta própria (ou pelo Grok, se a xAI estiver logada); a chave dele deixa de valer" : "Ele passa a responder pela assinatura do root, sem ver o token";
          b.addEventListener("click", () => { void rodar(`usuario:${u.nome}`, () => deps.api.adminClaudeGlobalUsuario(u.nome, !u.ligado), u.ligado ? `✓ Global desligado para ${u.nome}.` : `✓ Global ligado para ${u.nome}: o agente dele já responde pela conta do root.`); });
          td.append(b); tr.append(td); tu.append(tr);
        }
        const rolo2 = el("div", "usuarios-rolo"); rolo2.append(tu); us.append(rolo2);
      }
      panel.append(us);
    }
    if (msg !== null) panel.append(el("p", `hint ${msg.bad ? "bad-hint" : "audio-ok"}`, msg.text));
  }

  return {
    open: () => {
      if (page === null) {
        const panel = el("section", "acervo-panel usuarios-panel"); panel.hidden = true; deps.panelsEl.append(panel);
        page = deps.definePage("claude-global", `Claude Code Global · ${deps.who}`, panel, () => { render(); void ler(); });
      }
      deps.openPage(page);
    },
  };
}
