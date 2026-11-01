/**
 * Página "E-mail" (31 out; chamou-se "Gmail" no primeiro dia, e "Gmail" agora é só o site do Google no Navegador): os
 * e-mails da Conta Google da máquina, com busca, leitura e lixeira (desfazível).
 * Recurso Pro, com a trava da Conta Google. O token fica no Mac (main › conta-google.ts); aqui só se lê e se pede.
 * Fábrica com dependências explícitas, como conta-google-page.ts. Saiu do cartão de teste da Conta Google para ter
 * um lugar próprio. O cartão "Agente do chat" liga a ponte (socket + túnel reverso, main › gmail-api.ts) pela qual o
 * agente da máquina lista, lê e manda para a lixeira pela mesma API, sempre com o token aqui no Mac.
 */
import type { GmailAgenteState, GmailApagado, GmailDetalhe, GmailLista, GmailMensagem, GoogleContaStatus, MeuBotApi } from "../../shared/ipc";
import type { LicenseView, PlanName } from "../../shared/ipc";
import { browserAccess, proBlockText, pagamentoDoBloqueio } from "../lib/pro.js";
import { blocoPagamento } from "../lib/aviso-pagamento.js";
import { el } from "../lib/dom.js";
import { carregando } from "../lib/carregando.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { ehContaDesconectada, erroGoogleTexto, statusAposErro } from "../lib/erro-google.js";
import { blocosDoCorpo } from "../lib/email-texto-core.js";

/** O que a página conta ao guia (tutorial 16): a pessoa leu uma mensagem, buscou, mandou para a lixeira, desfez. */
export type GmailFato = "lido" | "buscou" | "lixeira" | "desfez";

export interface GmailDeps {
  /** Chamado quando a pessoa usa a página; o guia marca o passo (opcional: o cartão de teste antigo não tinha guia). */
  aoUsar?: (fato: GmailFato) => void;
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  /** Sem conta conectada, a página manda para a Conta Google. */
  openContaGoogle: () => void;
  host: () => string;
  license: () => LicenseView | null;
  licenseKnown: () => boolean;
  planoExigido: PlanName;
  produto: string;
  api: Pick<MeuBotApi, "browserRequestPro" | "googleContaStatus" | "googleContaConectar" | "gmailListar" | "gmailLer" | "gmailApagar" | "gmailRestaurar" | "gmailAgente" | "gmailInstalado" | "instalarGmail" | "openExternal" | "on">;
}

/** "Ana Silva <ana@x.com>" → "Ana Silva"; sem nome, o e-mail. */
export const remetenteCurto = (de: string): string => de.replace(/<.*>/, "").replace(/^"|"$/g, "").trim() || de;
/** Data do cabeçalho do e-mail em dd/mm hh:mm (pt-BR); o que não for data fica como veio. */
export const dataCurta = (data: string): string => { if (data === "") return ""; const d = new Date(data); return Number.isNaN(d.getTime()) ? data : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const tamanho = (bytes: number): string => { const kb = bytes / 1024; return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, kb).toFixed(0)} KB`; };

export function mountGmail(deps: GmailDeps): { open: () => void; refresh: () => Promise<void>; repintar: () => void } {
  const panel = el("section", "acervo-panel gmail-panel"); panel.hidden = true;
  deps.panelsEl.append(panel);
  let status: GoogleContaStatus | null = null;
  let lista: GmailLista | null = null; let listaErro: string | null = null;
  let detalhe: GmailDetalhe | null = null; let detalheErro: string | null = null; let abrindo: string | null = null;
  /** A última mensagem que foi para a lixeira por aqui: dá o "Desfazer". */
  let apagado: GmailApagado | null = null;
  let busca = "";
  let busy = false; let msg: { text: string; bad: boolean } | null = null;
  let proPedido = false;
  /** Ponte do agente: estado da chave (null = ainda não perguntado) e se a máquina tem o MCP (null = este Mac). */
  let agente: GmailAgenteState | null = null; let instalado: boolean | null | "?" = "?"; let instalando = false;
  deps.api.on("google-conta:changed", (st) => { status = st; if (!panel.hidden) { render(); if (st.conectado && !st.precisaReconectar) void carregarLista(); } });
  deps.api.on("gmail:agent", (st) => { agente = st; if (!panel.hidden) render(); });

  async function refresh(): Promise<void> {
    try { status = await deps.api.googleContaStatus(); } catch (e) { msg = { text: ipcErrorText(e), bad: true }; }
    render();
    if (status?.conectado && !status.precisaReconectar) {
      // A chave do agente: perguntar liga sozinha (padrão ligado, salvo se a pessoa desligou); e se a máquina já tem o MCP (uma vez).
      void deps.api.gmailAgente().then((a) => { agente = a; render(); }).catch(() => undefined);
      if (instalado === "?") void deps.api.gmailInstalado().then((i) => { instalado = i; render(); }).catch(() => { instalado = false; render(); });
      if (lista === null) await carregarLista();
    }
  }
  async function ligarAgente(on: boolean): Promise<void> {
    await agir(async () => { agente = await deps.api.gmailAgente(on); }, on ? "o agente do chat pode ler seus e-mails nesta máquina" : "o agente do chat não lê mais seus e-mails");
  }
  /**
   * A conta caiu no meio da sessão (o Google recusou renovar e o main apagou o token): em vez de uma frase sem saída
   * dentro da lista, a página volta ao cartão "Conecte a Conta Google", com os botões que levam ao login. O main também
   * avisa por google-conta:changed; aqui é para a resposta do próprio pedido já desenhar certo.
   */
  function contaCaiu(e: unknown): boolean {
    if (!ehContaDesconectada(e)) return false;
    status = statusAposErro(status, e); lista = null; listaErro = null; detalhe = null; detalheErro = null; abrindo = null;
    msg = { text: erroGoogleTexto(e), bad: true };
    return true;
  }
  async function instalarNaMaquina(): Promise<void> {
    instalando = true; render();
    try { const r = await deps.api.instalarGmail(); instalado = r.ok; msg = { text: r.ok ? "lado do agente instalado na máquina" : `não instalou: ${r.log.at(-1) ?? "sem detalhes"}`, bad: !r.ok }; }
    catch (e) { if (!contaCaiu(e)) msg = { text: erroGoogleTexto(e), bad: true }; }
    instalando = false; render();
  }
  async function carregarLista(pagina?: string): Promise<void> {
    if (pagina === undefined) { lista = null; listaErro = null; render(); }
    try {
      const r = await deps.api.gmailListar({ busca, max: 20, pagina });
      lista = pagina !== undefined && lista !== null ? { ...r, mensagens: [...lista.mensagens, ...r.mensagens] } : r;
      if (busca !== "") deps.aoUsar?.("buscou");
    } catch (e) { if (!contaCaiu(e)) { if (pagina === undefined) listaErro = erroGoogleTexto(e); else msg = { text: erroGoogleTexto(e), bad: true }; } }
    render();
  }
  async function abrir(id: string): Promise<void> {
    abrindo = id; detalhe = null; detalheErro = null; render();
    try { detalhe = await deps.api.gmailLer(id); deps.aoUsar?.("lido"); } catch (e) { if (!contaCaiu(e)) detalheErro = erroGoogleTexto(e); }
    render();
  }
  function fechar(): void { detalhe = null; detalheErro = null; abrindo = null; render(); }
  async function agir(run: () => Promise<unknown>, ok: string): Promise<void> {
    if (busy) return; busy = true; msg = null; render();
    try { await run(); msg = { text: ok, bad: false }; } catch (e) { if (!contaCaiu(e)) msg = { text: erroGoogleTexto(e), bad: true }; }
    busy = false; render();
  }
  /** Lixeira: tira a mensagem da lista na hora e guarda o "Desfazer"; a lista inteira só recarrega na próxima busca. */
  async function apagar(m: GmailMensagem | GmailDetalhe): Promise<void> {
    await agir(async () => {
      apagado = await deps.api.gmailApagar(m.id); deps.aoUsar?.("lixeira");
      if (lista !== null) lista = { ...lista, mensagens: lista.mensagens.filter((x) => x.id !== m.id) };
      if (detalhe?.id === m.id) { detalhe = null; abrindo = null; }
    }, `"${m.assunto}" foi para a lixeira`);
  }
  async function restaurar(): Promise<void> {
    const a = apagado; if (a === null) return;
    await agir(async () => { await deps.api.gmailRestaurar(a.id); apagado = null; deps.aoUsar?.("desfez"); }, `"${a.assunto}" voltou da lixeira`);
    await carregarLista();
  }
  const btn = (label: string, cls: string, run: () => void): HTMLButtonElement => { const b = el("button", `btn ${cls} btn-small`, label); b.type = "button"; b.disabled = busy; b.addEventListener("click", run); return b; };
  const card = (titulo: string): HTMLElement => { const c = el("div", "admin-card"); c.append(el("strong", "", titulo)); return c; };

  function render(): void {
    panel.replaceChildren();
    const head = el("div", "guide-head"); const hb = el("div", "tut-body");
    hb.append(el("span", "tut-badge", "e-mail"), el("h2", "", "E-mail"), el("p", "", status !== null ? `Seus e-mails da Conta Google da máquina ${status.maquina}, aqui dentro do meu-bot. Leia, busque e mande para a lixeira; o que vai para a lixeira pode voltar por 30 dias. O acesso fica só neste Mac.` : "Seus e-mails da Conta Google desta máquina, aqui dentro do meu-bot."));
    head.append(hb); panel.append(head);
    // Módulo Pro: sem o plano, a página é o bloqueio (como a Conta Google), com o pedido ao admin.
    if (!deps.licenseKnown()) { panel.append(carregando("Consultando a licença desta máquina…")); return; }
    const acesso = browserAccess(deps.license(), deps.host(), deps.planoExigido, deps.produto);
    if (acesso !== "ok") {
      const t = proBlockText(acesso, deps.license(), "google", deps.produto);
      const c = card(t.title); c.append(el("p", "", t.text));
      const pg = pagamentoDoBloqueio(acesso, deps.license());
      if (pg !== null) c.append(blocoPagamento(pg));
      if (t.askAdmin) {
        const b = btn(proPedido ? "Pedido enviado ao admin ✓" : acesso === "assinatura" ? "Avisar o admin" : acesso === "expired" ? "Pedir a renovação ao admin" : "Pedir o Pro ao admin", "btn-primary", () => { void agir(async () => { await deps.api.browserRequestPro(); proPedido = true; }, "pedido enviado ao admin; assim que ele liberar, esta página abre"); });
        b.disabled = busy || proPedido; c.append(b);
      }
      panel.append(c); if (msg) panel.append(el("p", `hint ${msg.bad ? "bad-hint" : ""}`, msg.text)); return;
    }
    if (status === null) { panel.append(carregando("Consultando a Conta Google desta máquina…")); return; }
    if (!status.configurado || !status.conectado || status.precisaReconectar) {
      const c = card(!status.configurado ? "Google ainda não configurado neste app" : !status.conectado ? "Conecte a Conta Google desta máquina" : "A Conta Google precisa reautorizar");
      c.append(el("p", "hint", !status.configurado ? "Este build veio sem o client OAuth do Google. A página Conta Google explica e busca sozinha na release." : !status.conectado ? "O E-mail usa a conta conectada na página Conta Google. Entre lá uma vez e volte aqui." : "Faltam permissões na autorização atual. Reconecte na página Conta Google e volte aqui."));
      const a = el("div", "admin-actions");
      a.append(btn("Abrir a Conta Google", "btn-primary", deps.openContaGoogle));
      if (status.configurado && !status.conectado) a.append(btn("Entrar com Google", "btn-ghost", () => { void agir(() => deps.api.googleContaConectar(), "login aberto no Navegador desta máquina; conclua lá e volte"); }));
      c.append(a); panel.append(c);
      if (msg) panel.append(el("p", `hint ${msg.bad ? "bad-hint" : "audio-ok"}`, msg.text));
      return;
    }

    if (msg) panel.append(el("p", `hint ${msg.bad ? "bad-hint" : "audio-ok"}`, msg.text));
    if (apagado !== null) {
      const u = el("div", "admin-actions");
      u.append(el("span", "hint", `Na lixeira: "${apagado.assunto}" (${remetenteCurto(apagado.de)})`), btn("Desfazer", "btn-ghost", () => { void restaurar(); }));
      panel.append(u);
    }
    if (abrindo !== null) { renderDetalhe(); return; }

    // Busca: a sintaxe é a do próprio Gmail; vazia, mostra a caixa de entrada.
    const bc = card("Caixa de entrada");
    const form = el("form", "admin-actions");
    const campo = el("label", "admin-field"); const inp = el("input"); inp.type = "search"; inp.placeholder = "buscar como no Gmail: from:ana is:unread has:attachment"; inp.value = busca; inp.maxLength = 200; inp.disabled = busy;
    campo.append(el("span", "hint", "Busca"), inp); form.append(campo);
    form.append(btn("Buscar", "btn-primary", () => { busca = inp.value.trim(); void carregarLista(); }));
    if (busca !== "") form.append(btn("Caixa de entrada", "btn-ghost", () => { busca = ""; void carregarLista(); }));
    form.append(btn("Atualizar", "btn-ghost", () => { void carregarLista(); }));
    form.addEventListener("submit", (ev) => { ev.preventDefault(); busca = inp.value.trim(); void carregarLista(); });
    bc.append(form);
    if (lista === null) {
      if (listaErro === null) bc.append(carregando("Carregando os e-mails…"));
      else bc.append(el("p", "hint bad-hint", `Não deu para ler os e-mails: ${listaErro}`), btn("Tentar de novo", "btn-ghost", () => { void carregarLista(); }));
    } else {
      bc.append(el("p", "hint", `${lista.email ?? ""} · ${lista.naoLidas} não ${lista.naoLidas === 1 ? "lida" : "lidas"} na caixa de entrada${lista.busca !== "" ? ` · busca: ${lista.busca}` : ""}`));
      if (lista.mensagens.length === 0) bc.append(el("p", "hint", lista.busca === "" ? "Nenhuma mensagem na caixa de entrada." : "Nada encontrado com essa busca."));
      for (const m of lista.mensagens) {
        const r = el("div", `conta-msg gmail-msg${m.naoLida ? " nova" : ""}`); r.tabIndex = 0; r.setAttribute("role", "button"); r.title = "Abrir a mensagem";
        const topo = el("div", "gmail-msg-topo"); topo.append(el("span", "hint conta-msg-de", remetenteCurto(m.de)), el("span", "hint gmail-msg-data", dataCurta(m.data)));
        r.append(topo, el("strong", "conta-msg-assunto", m.assunto), el("span", "hint conta-msg-resumo", m.resumo.slice(0, 140)));
        const ir = (): void => { void abrir(m.id); };
        r.addEventListener("click", ir); r.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ir(); } });
        bc.append(r);
      }
      if (lista.proxima !== null) { const pr = lista.proxima; bc.append(btn("Mais mensagens", "btn-ghost", () => { void carregarLista(pr); })); }
    }
    panel.append(bc);
    panel.append(cartaoAgente());
  }

  /** "O agente do chat pode ler seus e-mails": a chave da ponte, o estado do túnel e, se faltar, o instalador na máquina. */
  function cartaoAgente(): HTMLElement {
    const c = card("Agente do chat");
    c.append(el("p", "hint", "Ligado por padrão quando a conta está conectada e a máquina tem o Pro: o agente desta máquina lista, busca, lê e manda e-mails para a lixeira quando você pede no chat (\"detalha o segundo\", \"apaga esse\"). Antes de apagar ele diz qual mensagem é e espera você confirmar; a lixeira é reversível. O acesso à conta continua só neste Mac: a máquina recebe o conteúdo, nunca o token."));
    if (instalado === null) { c.append(el("p", "hint", "O agente do chat lê e-mails só em máquinas por SSH; neste Mac a página basta.")); return c; }
    if (instalado === false) {
      c.append(el("p", "hint bad-hint", "A máquina ainda não tem o lado dela (o servidor que apresenta os e-mails ao agente)."));
      c.append(btn(instalando ? "Instalando…" : "Instalar na máquina", "btn-primary", () => { void instalarNaMaquina(); }));
      return c;
    }
    const a = agente;
    const estado = a === null ? "consultando…" : !a.on ? "desligado" : a.state === "up" ? `ligado · túnel de pé (porta ${a.port ?? "?"} na máquina)` : a.state === "connecting" ? "ligando o túnel…" : "ligado, mas o túnel está fora: volta sozinho quando a máquina responder";
    c.append(el("p", `hint ${a?.on && a.state === "up" ? "audio-ok" : ""}`, `Estado: ${estado}${instalado === "?" ? " · conferindo a máquina…" : ""}`));
    const acoes = el("div", "admin-actions");
    const on = a?.on === true;
    acoes.append(btn(on ? "Desligar para o agente" : "Deixar o agente ler os e-mails", on ? "btn-ghost" : "btn-primary", () => { void ligarAgente(!on); }));
    c.append(acoes);
    return c;
  }

  /** O corpo em parágrafos, separadores, citações e links curtos (email-texto-core); o link abre no navegador do Mac. */
  function corpoEl(corpo: string): HTMLElement {
    const box = el("div", "gmail-corpo");
    const blocos = blocosDoCorpo(corpo);
    if (blocos.length === 0) { box.append(el("p", "hint", "(sem texto; a mensagem pode ser só imagem ou anexo)")); return box; }
    for (const b of blocos) {
      if (b.tipo === "separador") { box.append(el("hr")); continue; }
      const p = el(b.tipo === "citacao" ? "blockquote" : "p");
      for (const t of b.trechos) {
        if (t.tipo === "texto") { p.append(t.texto); continue; }
        const a = el("a", "gmail-link", t.rotulo); a.href = "#"; a.title = t.url;
        a.addEventListener("click", (ev) => { ev.preventDefault(); void deps.api.openExternal(t.url); });
        p.append(a);
      }
      box.append(p);
    }
    return box;
  }
  function renderDetalhe(): void {
    const dc = card(detalhe?.assunto ?? "Mensagem");
    const acoes = el("div", "admin-actions");
    acoes.append(btn("← Voltar", "btn-ghost", fechar));
    if (detalhe === null) {
      dc.append(acoes);
      if (detalheErro === null) dc.append(carregando("Abrindo a mensagem…"));
      else dc.append(el("p", "hint bad-hint", `Não deu para abrir: ${detalheErro}`));
      panel.append(dc); return;
    }
    const d = detalhe;
    dc.append(el("p", "hint", `De: ${d.de}`), el("p", "hint", `Para: ${d.para || "(sem destinatário)"}`), el("p", "hint", `Data: ${dataCurta(d.data)}${d.naoLida ? " · não lida" : ""}`));
    if (d.anexos.length > 0) dc.append(el("p", "hint", `Anexos: ${d.anexos.map((a) => `${a.nome} (${tamanho(a.bytes)})`).join(", ")} · abra no Gmail para baixar`));
    dc.append(corpoEl(d.corpo));
    if (d.truncado) dc.append(el("p", "hint", "A mensagem é longa e foi cortada aqui; abra no Gmail para ver inteira."));
    acoes.append(btn("Abrir no Gmail", "btn-ghost", () => { void deps.api.openExternal(d.link); }));
    // Sem confirmação (pedido de 31 out): a lixeira é reversível e o "Desfazer" aparece logo em seguida.
    if (status?.gmailEscreve) acoes.append(btn("Mover para a lixeira", "btn-ghost", () => { void apagar(d); }));
    else acoes.append(btn("Reconectar para poder apagar", "btn-ghost", () => { void agir(() => deps.api.googleContaConectar(), "reautorização aberta no Navegador; conclua lá e volte"); }));
    dc.append(acoes);
    panel.append(dc);
  }

  const page = deps.definePage("gmail", "E-mail", panel, () => { render(); void refresh(); });
  // `repintar`: a licença chegou depois de a página abrir (ela mostrava "consultando a licença").
  return { open: () => deps.openPage(page), refresh, repintar: () => { if (!panel.hidden) render(); } };
}
