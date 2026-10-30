/**
 * Página "Conta Google" (login + Gmail + Agenda + Sheets) no visual do meu-bot. A conta mora neste Mac (token cifrado
 * no Keychain, via main › conta-google.ts); aqui só se conecta, lê e escreve. A verificação de telefone/QR, quando o
 * Google pede, é feita pela pessoa na tela oficial. Fábrica com dependências explícitas, como finance-page.ts.
 */
import type { AgendaEvento, BackupDadosView, GmailResumo, GoogleContaStatus, MeuBotApi, PlanilhaLeitura } from "../../shared/ipc";
import type { LicenseView, PlanName } from "../../shared/ipc";
import { browserAccess, proBlockText, pagamentoDoBloqueio } from "../lib/pro.js";
import { blocoPagamento } from "../lib/aviso-pagamento.js";
import { el } from "../lib/dom.js";
import { carregando } from "../lib/carregando.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";

export interface ContaGoogleDeps {
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  armConfirm(btn: HTMLButtonElement, label: string, run: () => void): void;
  /** Conta Google é do plano Pro (27 out): a mesma regra do Navegador; a licença chega depois da janela abrir. */
  host: () => string;
  license: () => LicenseView | null;
  licenseKnown: () => boolean;
  planoExigido: PlanName;
  produto: string;
  api: Pick<MeuBotApi, "browserRequestPro" | "googleContaStatus" | "googleContaConectar" | "googleContaDesconectar" | "googleContaAdotarDoMac" | "gmailResumo" | "agendaProximos" | "agendaCriar" | "planilhaLer" | "planilhaEscrever" | "backupDadosStatus" | "backupDadosAgora" | "backupDadosLigar" | "backupDadosAbrirPasta" | "backupDadosSenha" | "backupDadosLimparSenha" | "on">;
}

export function mountContaGoogle(deps: ContaGoogleDeps): { open: () => void; refresh: () => Promise<void>; repintar: () => void } {
  const panel = el("section", "acervo-panel conta-google-panel"); panel.hidden = true;
  deps.panelsEl.append(panel);
  let status: GoogleContaStatus | null = null;
  let gmail: GmailResumo | null = null;
  let agenda: AgendaEvento[] | null = null;
  let planilha: PlanilhaLeitura | null = null;
  let backup: BackupDadosView | null = null;
  // Cada cartão guarda o próprio erro: "Carregando…" para sempre escondia o motivo (Gmail e Backup, 25 out).
  let gmailErro: string | null = null; let agendaErro: string | null = null; let backupErro: string | null = null;
  const erroTexto = (e: unknown): string => ipcErrorText(e).replace(/^GOOGLE_CONTA_DESCONECTADA$/, "a conta Google desconectou; entre de novo").replace(/^PRO_REQUIRED$/, "esta máquina não tem o plano Pro");
  let busy = false; let msg: { text: string; bad: boolean } | null = null;
  /** "Pedir o Pro ao admin" já foi clicado nesta janela. */
  let proPedido = false;
  let plId = ""; let plRange = "Página1!A1:C10";
  // Gmail, Agenda e Planilha são ferramentas de teste: ficam ocultas (e sem carregar) até a pessoa pedir.
  let mostrarFerramentas = false;
  deps.api.on("google-conta:changed", (st) => { status = st; if (!panel.hidden) { render(); if (st.conectado) void carregarDados(); } });

  async function refresh(): Promise<void> {
    try { status = await deps.api.googleContaStatus(); } catch (e) { msg = { text: ipcErrorText(e), bad: true }; }
    render();
    if (status?.conectado && !status.precisaReconectar) await carregarDados();
  }
  /** Os três cartões carregam em paralelo e cada um aparece quando chega (o Gmail faz até doze chamadas; antes ele segurava os outros). */
  async function carregarDados(): Promise<void> {
    backup = null; backupErro = null; render();
    await Promise.all([
      deps.api.backupDadosStatus().then((b) => { backup = b; }, (e: unknown) => { backupErro = erroTexto(e); }).then(render),
      mostrarFerramentas ? carregarFerramentas() : Promise.resolve(),
    ]);
  }
  async function carregarFerramentas(): Promise<void> {
    gmail = null; agenda = null; gmailErro = null; agendaErro = null; render();
    await Promise.all([
      deps.api.gmailResumo().then((g) => { gmail = g; }, (e: unknown) => { gmailErro = erroTexto(e); }).then(render),
      deps.api.agendaProximos(7).then((a) => { agenda = a; }, (e: unknown) => { agendaErro = erroTexto(e); }).then(render),
    ]);
  }
  /** Cartão sem dado: o erro, com "Tentar de novo", ou "Carregando…" enquanto não chegou. */
  const pendente = (c: HTMLElement, erro: string | null, oQue: string): void => {
    if (erro === null) { c.append(carregando(`Carregando ${oQue}…`)); return; }
    c.append(el("p", "hint bad-hint", `Não deu para ler ${oQue}: ${erro}`), btn("Tentar de novo", "btn-ghost", () => { void (oQue === "o estado do backup" ? carregarDados() : carregarFerramentas()); }));
  };
  async function agir(run: () => Promise<unknown>, ok: string): Promise<void> {
    if (busy) return; busy = true; msg = null; render();
    try { await run(); msg = { text: ok, bad: false }; } catch (e) { msg = { text: ipcErrorText(e).replace(/^GOOGLE_CONTA_DESCONECTADA$/, "a conta Google desconectou; entre de novo"), bad: true }; }
    busy = false; await refresh();
  }
  const btn = (label: string, cls: string, run: () => void): HTMLButtonElement => { const b = el("button", `btn ${cls} btn-small`, label); b.type = "button"; b.disabled = busy; b.addEventListener("click", run); return b; };
  const input = (ph: string, val = "", max = 120): HTMLInputElement => { const i = el("input"); i.type = "text"; i.placeholder = ph; i.value = val; i.maxLength = max; i.disabled = busy; return i; };
  const field = (label: string, ctl: HTMLElement): HTMLElement => { const w = el("label", "admin-field"); w.append(el("span", "hint", label), ctl); return w; };
  const card = (titulo: string): HTMLElement => { const c = el("div", "admin-card"); c.append(el("strong", "", titulo)); return c; };

  function render(): void {
    panel.replaceChildren();
    const head = el("div", "guide-head"); const hb = el("div", "tut-body");
    hb.append(el("span", "tut-badge", "conta google"), el("h2", "", "Conta Google"), el("p", "", status !== null ? `Conta Google da máquina ${status.maquina}: cada máquina entra com a sua, e desconectar aqui não mexe nas outras. É por ela que o meu-bot lê o Gmail, a Agenda e as planilhas e guarda o backup no Drive. O acesso fica guardado só neste Mac.` : "Entre com a conta do Google desta máquina."));
    head.append(hb); panel.append(head);
    // Módulo Pro: sem o plano, a página é o bloqueio (como a aba Navegador), com o pedido ao admin.
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
    if (!status.configurado) { const c = card("Google não configurado neste app"); c.append(el("p", "", "Falta o client OAuth do Google (google-conta-oauth.json) neste build. Para testar sem reempacotar, coloque o JSON em ~/Library/Application Support/<nome do app>/google-conta-oauth.json e reabra o app; para distribuir, empacote com o arquivo em config/ (veja docs/guia/google.md).")); panel.append(c); return; }

    // Perfil
    const pc = card("Sua conta");
    if (!status.conectado) {
      pc.append(el("p", "hint", "Ao entrar, o login abre no Navegador. Qualquer verificação de telefone é feita por você, no seu celular, na tela do Google."));
      // Procedência do client: um arquivo velho vencendo em silêncio já custou uma caçada longa, e
      // o Google só diz "access_denied" no navegador, longe daqui. Aqui a origem fica à vista.
      if (status.cliente !== null) pc.append(el("p", "hint", `Entrando pelo projeto ${status.cliente.projeto} do Google Cloud (client vindo do ${status.cliente.origem}). Se o Google recusar dizendo que o app não foi verificado, é este projeto que precisa liberar o seu e-mail.`));
      pc.append(btn("Entrar com Google", "btn-primary", () => { void agir(() => deps.api.googleContaConectar(), "login aberto no Navegador desta máquina; conclua lá e volte"); }));
      // A conta que estava conectada no Mac antes de a conta ser por máquina: só vale aqui por escolha explícita.
      if (status.contaDoMac !== null) {
        pc.append(el("p", "hint", `Antes, este Mac tinha uma conta só para todas as máquinas: ${status.contaDoMac}. Se ela é a certa para ${status.maquina}, use-a aqui sem entrar de novo.`));
        pc.append(btn(`Usar ${status.contaDoMac} nesta máquina`, "btn-ghost", () => { void agir(() => deps.api.googleContaAdotarDoMac(), `conta ${status?.contaDoMac ?? ""} em uso nesta máquina`); }));
      }
    } else {
      const linha = el("div", "conta-perfil");
      // Sempre a `fotoLocal` (data URL): a URL do Google cai no CSP `img-src 'self' data:` e nao carregaria.
      if (status.perfil?.fotoLocal) { const img = el("img", "conta-foto"); img.src = status.perfil.fotoLocal; img.alt = ""; linha.append(img); }
      const info = el("div"); info.append(el("strong", "", status.perfil?.nome ?? "conta conectada"), el("div", "hint", status.perfil?.email ?? ""));
      linha.append(info); pc.append(linha);
      if (status.precisaReconectar) { pc.append(el("p", "hint bad-hint", "Faltam permissões (Gmail, Agenda, Sheets ou Drive). Quem conectou antes do backup no Drive precisa reconectar uma vez para a cópia diária funcionar."));pc.append(btn("Reconectar", "btn-primary", () => { void agir(() => deps.api.googleContaConectar(), "reautorização aberta no Navegador"); })); }
      const d = btn("Desconectar", "btn-ghost", () => { deps.armConfirm(d, "Confirmar? tira a conta só desta máquina", () => { void agir(() => deps.api.googleContaDesconectar(), "conta desconectada"); }); });
      pc.append(d);
    }
    panel.append(pc);
    if (msg) panel.append(el("p", `hint ${msg.bad ? "bad-hint" : "audio-ok"}`, msg.text));
    if (status.conectando) panel.append(el("p", "hint", "Esperando você concluir o login no Navegador…"));
    if (!status.conectado || status.precisaReconectar) return;

    // Backup: a cópia do CRM e do financeiro desta máquina no Drive desta conta.
    const bc = card("Backup no Drive");
    if (backup === null) pendente(bc, backupErro, "o estado do backup");
    else {
      bc.append(el("p", "hint", "Uma vez por dia o CRM e o financeiro desta máquina são guardados no Drive desta conta, em pastas separadas, e uma cópia fica aqui no Mac. Fica só a mais recente de cada um."));
      if (backup.ultimaEm !== null) {
        bc.append(el("p", "hint audio-ok", `Última cópia em ${fmtData(backup.ultimaEm)}.`));
        for (const e of backup.enviados) {
          const r = el("div", "conta-evento");
          const kb = e.bytes / 1024;
          r.append(el("strong", "", e.conjunto), el("span", "hint", `${e.caminho} · ${kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(0)} KB`}`));
          bc.append(r);
        }
      } else if (backup.erro === null) bc.append(el("p", "hint", "Ainda não foi feita nenhuma cópia desta máquina."));
      if (backup.erro !== null) bc.append(el("p", "hint bad-hint", `${backup.tentativaEm !== null ? `Última tentativa em ${fmtData(backup.tentativaEm)}: ` : ""}${backup.erro}`));
      // Senha do pacote de credenciais. Sem ela esse conjunto é pulado; os outros sobem normalmente.
      const sc = el("div", "admin-actions");
      if (backup.temSenha) {
        sc.append(el("p", "hint audio-ok", "As credenciais da máquina sobem cifradas com a sua senha. Guarde-a fora do computador: sem ela esse pacote não abre."));
        // Sem prompt(): o Electron não implementa window.prompt (devolvia undefined e o botão virava no-op). Campo inline.
        const nova = input("nova senha (mínimo 8 caracteres)", "", 200); nova.type = "password";
        sc.append(field("Trocar a senha", nova), btn("Trocar", "btn-ghost", () => { if (nova.value.trim().length < 8) return; void agir(async () => { backup = await deps.api.backupDadosSenha(nova.value); }, "senha trocada; vale a partir da próxima cópia"); }));
        const lb = btn("Apagar a senha", "btn-ghost", () => { deps.armConfirm(lb, "Confirmar? as credenciais param de ser copiadas", () => { void agir(async () => { backup = await deps.api.backupDadosLimparSenha(); }, "senha apagada; as credenciais não sobem mais"); }); });
        sc.append(lb);
      } else {
        sc.append(el("p", "hint bad-hint", "As credenciais da máquina (tokens e sessão do WhatsApp) não estão sendo copiadas: defina uma senha. Elas nunca sobem sem cifra."));
        const inp = input("senha do backup cifrado", "", 200); inp.type = "password";
        sc.append(field("Senha", inp), btn("Definir a senha", "btn-primary", () => { if (inp.value.trim().length < 8) return; void agir(async () => { backup = await deps.api.backupDadosSenha(inp.value); }, "senha definida; as credenciais entram na próxima cópia"); }));
      }
      bc.append(sc);

      const acoes = el("div", "admin-actions");
      acoes.append(btn("Guardar agora", "btn-ghost", () => { void agir(async () => { backup = await deps.api.backupDadosAgora(); }, "cópia guardada no Drive"); }));
      acoes.append(btn("Abrir a pasta no Mac", "btn-ghost", () => { void agir(() => deps.api.backupDadosAbrirPasta(), "pasta aberta no Finder"); }));
      acoes.append(btn(backup.ligado ? "Desligar a cópia diária" : "Ligar a cópia diária", "btn-ghost", () => { void agir(async () => { backup = await deps.api.backupDadosLigar(!(backup?.ligado ?? true)); }, backup?.ligado === true ? "cópia diária desligada" : "cópia diária ligada"); }));
      bc.append(acoes);
    }
    panel.append(bc);

    const tg = el("div", "admin-actions");
    tg.append(btn(mostrarFerramentas ? "Ocultar Gmail, Agenda e Planilha" : "Mostrar Gmail, Agenda e Planilha", "btn-ghost", () => { mostrarFerramentas = !mostrarFerramentas; if (mostrarFerramentas) void carregarFerramentas(); else render(); }));
    panel.append(tg);
    if (!mostrarFerramentas) return;

    // Gmail
    const gc = card("Gmail");
    if (gmail === null) pendente(gc, gmailErro, "o Gmail");
    else {
      gc.append(el("p", "hint", `${gmail.email ?? ""} · ${gmail.naoLidas} não ${gmail.naoLidas === 1 ? "lida" : "lidas"} na caixa de entrada`));
      for (const m of gmail.mensagens.slice(0, 8)) { const r = el("div", `conta-msg${m.naoLida ? " nova" : ""}`); r.append(el("strong", "conta-msg-assunto", m.assunto), el("span", "hint conta-msg-de", m.de.replace(/<.*>/, "").trim() || m.de), el("span", "hint conta-msg-resumo", m.resumo.slice(0, 120))); gc.append(r); }
      if (gmail.mensagens.length === 0) gc.append(el("p", "hint", "Nenhuma mensagem recente."));
    }
    panel.append(gc);

    // Agenda
    const ac = card("Agenda (próximos 7 dias)");
    if (agenda === null) pendente(ac, agendaErro, "a Agenda");
    else if (agenda.length === 0) ac.append(el("p", "hint", "Nenhum evento nos próximos dias."));
    else for (const e of agenda) { const r = el("div", "conta-evento"); r.append(el("strong", "", e.titulo), el("span", "hint", `${fmtData(e.inicio)}${e.local ? " · " + e.local : ""}`)); ac.append(r); }
    const nova = el("div", "admin-actions");
    const et = input("título do evento"); const ei = input("início (ex.: 2026-10-23T14:00:00-03:00)", "", 40); const ef = input("fim", "", 40);
    nova.append(field("Novo evento", et), field("Início", ei), field("Fim", ef), btn("Criar evento", "btn-ghost", () => { if (et.value.trim() === "" || ei.value.trim() === "" || ef.value.trim() === "") return; const b = nova.querySelector("button"); if (b) deps.armConfirm(b as HTMLButtonElement, "Confirmar? cria na sua Agenda", () => { void agir(() => deps.api.agendaCriar({ titulo: et.value, inicio: ei.value, fim: ef.value }), "evento criado"); }); }));
    ac.append(nova); panel.append(ac);

    // Planilha
    const sc = card("Planilha (ler e gravar)");
    sc.append(el("p", "hint", "Cole o id da planilha (da URL, entre /d/ e /edit) e o intervalo (ex.: Página1!A1:C10)."));
    const f = el("div", "admin-actions");
    const id = input("id da planilha", plId); id.addEventListener("input", () => { plId = id.value; });
    const rg = input("intervalo", plRange, 100); rg.addEventListener("input", () => { plRange = rg.value; });
    f.append(field("Planilha", id), field("Intervalo", rg), btn("Ler", "btn-ghost", () => { void agir(async () => { planilha = await deps.api.planilhaLer(id.value.trim(), rg.value.trim()); }, "leitura feita"); }));
    sc.append(f);
    if (planilha !== null) {
      const t = el("table", "conta-tabela");
      for (const linha of planilha.valores.slice(0, 20)) { const tr = el("tr"); for (const c of linha.slice(0, 12)) tr.append(el("td", "", c)); t.append(tr); }
      if (planilha.valores.length === 0) sc.append(el("p", "hint", "Intervalo vazio."));
      else sc.append(t);
    }
    const g = el("div", "admin-actions");
    const cel = input("valor a gravar na 1ª célula do intervalo", "", 200);
    g.append(field("Gravar (teste)", cel), btn("Gravar", "btn-ghost", () => { if (cel.value.trim() === "") return; const b = g.querySelector("button"); if (b) deps.armConfirm(b as HTMLButtonElement, "Confirmar? escreve na planilha", () => { void agir(() => deps.api.planilhaEscrever(id.value.trim(), rg.value.trim(), [[cel.value]]), "gravado"); }); }));
    sc.append(g); panel.append(sc);
  }
  const fmtData = (iso: string): string => { if (iso === "") return ""; const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };

  const page = deps.definePage("conta-google", "Conta Google", panel, () => { render(); void refresh(); });
  // `repintar`: a licença chegou depois de a página abrir (ela mostrava "consultando a licença").
  return { open: () => deps.openPage(page), refresh, repintar: () => { if (!panel.hidden) render(); } };
}
