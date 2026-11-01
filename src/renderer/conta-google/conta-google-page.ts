/**
 * Página "Conta Google" (login + backup no Drive; os e-mails têm página própria, "E-mail", desde 31 out) no visual do meu-bot. A conta mora neste Mac (token cifrado
 * no Keychain, via main › conta-google.ts); aqui só se conecta, lê e escreve. A verificação de telefone/QR, quando o
 * Google pede, é feita pela pessoa na tela oficial. Fábrica com dependências explícitas, como finance-page.ts.
 */
import type { BackupDadosProgresso, BackupDadosView, GoogleContaStatus, MeuBotApi } from "../../shared/ipc";
import type { LicenseView, PlanName } from "../../shared/ipc";
import { browserAccess, proBlockText, pagamentoDoBloqueio } from "../lib/pro.js";
import { blocoPagamento } from "../lib/aviso-pagamento.js";
import { el } from "../lib/dom.js";
import { carregando } from "../lib/carregando.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { aplicarProgresso, fmtBytes, terminou, textoAndamento } from "./backup-andamento.js";

export interface ContaGoogleDeps {
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  armConfirm(btn: HTMLButtonElement, label: string, run: () => void): void;
  /** Abre a página E-mail (o cartão de teste do Gmail saiu daqui em 31 out). */
  openGmail?: () => void;
  /** Conta Google é do plano Pro (27 out): a mesma regra do Navegador; a licença chega depois da janela abrir. */
  host: () => string;
  license: () => LicenseView | null;
  licenseKnown: () => boolean;
  planoExigido: PlanName;
  produto: string;
  api: Pick<MeuBotApi, "browserRequestPro" | "googleContaStatus" | "googleContaConectar" | "googleContaDesconectar" | "googleContaAdotarDoMac" | "backupDadosStatus" | "backupDadosAgora" | "backupDadosLigar" | "backupDadosAbrirPasta" | "backupDadosSenha" | "backupDadosLimparSenha" | "on">;
}

export function mountContaGoogle(deps: ContaGoogleDeps): { open: () => void; refresh: () => Promise<void>; repintar: () => void } {
  const panel = el("section", "acervo-panel conta-google-panel"); panel.hidden = true;
  deps.panelsEl.append(panel);
  let status: GoogleContaStatus | null = null;
  let backup: BackupDadosView | null = null;
  // O cartão guarda o próprio erro: "Carregando…" para sempre escondia o motivo (25 out).
  let backupErro: string | null = null;
  // Cópia no Drive em curso (clique em "Guardar agora" ou a diária): as etapas que o main manda, conjunto a conjunto.
  // null = nenhuma; [] = começou e a primeira etapa ainda não chegou.
  let andamento: BackupDadosProgresso[] | null = null;
  const erroTexto = (e: unknown): string => ipcErrorText(e).replace(/^GOOGLE_CONTA_DESCONECTADA$/, "a conta Google desconectou; entre de novo").replace(/^PRO_REQUIRED$/, "esta máquina não tem o plano Pro");
  let busy = false; let msg: { text: string; bad: boolean } | null = null;
  /** "Pedir o Pro ao admin" já foi clicado nesta janela. */
  let proPedido = false;
  // Gmail, Agenda e Planilha saíram da página (31 out): eram ferramentas de teste sem serventia aqui; o agente continua
  // usando as três pelo backend.
  deps.api.on("google-conta:changed", (st) => { status = st; if (!panel.hidden) { render(); if (st.conectado) void carregarDados(); } });
  deps.api.on("backup-dados:progress", (p) => {
    andamento = aplicarProgresso(andamento ?? [], p);
    // A diária (sem clique) termina aqui; a de "Guardar agora" termina quando o invoke devolve, em `agir`.
    if (!busy && terminou(andamento)) { andamento = null; if (!panel.hidden) void carregarDados(); return; }
    if (!panel.hidden) render();
  });

  async function refresh(): Promise<void> {
    try { status = await deps.api.googleContaStatus(); } catch (e) { msg = { text: ipcErrorText(e), bad: true }; }
    render();
    if (status?.conectado && !status.precisaReconectar) await carregarDados();
  }
  async function carregarDados(): Promise<void> {
    backup = null; backupErro = null; render();
    await deps.api.backupDadosStatus().then((b) => { backup = b; }, (e: unknown) => { backupErro = erroTexto(e); }).then(render);
  }
  /** Cartão sem dado: o erro, com "Tentar de novo", ou "Carregando…" enquanto não chegou. */
  const pendente = (c: HTMLElement, erro: string | null, oQue: string): void => {
    if (erro === null) { c.append(carregando(`Carregando ${oQue}…`)); return; }
    c.append(el("p", "hint bad-hint", `Não deu para ler ${oQue}: ${erro}`), btn("Tentar de novo", "btn-ghost", () => { void carregarDados(); }));
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
    if (!status.configurado) {
      // O build veio sem o client OAuth e a busca na release não resolveu: diz por quê e deixa repetir.
      const c = card("Google ainda não configurado neste app");
      c.append(el("p", "", "Este build veio sem o client OAuth do Google (google-conta-oauth.json). O app procurou na última release e vai buscar sozinho assim que o admin publicar uma com o arquivo; até lá, esta página fica assim."));
      if (status.busca) c.append(el("p", "hint", `Última tentativa: ${status.busca}.`));
      const b = btn(busy ? "Buscando…" : "Buscar de novo agora", "btn-ghost", () => { void agir(async () => { status = await deps.api.googleContaStatus(true); }, status?.configurado ? "client do Google encontrado" : "ainda sem o client na release"); });
      b.disabled = busy; c.append(b);
      panel.append(c); return;
    }

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
      if (andamento !== null) {
        bc.append(carregando("Guardando no Drive…", "backup-drive", "Cada conjunto é empacotado na máquina e sobe para o Drive; costuma levar perto de um minuto. Não precisa clicar de novo."));
        const linha = textoAndamento(andamento);
        if (linha !== "") bc.append(el("p", "hint", linha));
      } else if (backup.ultimaEm !== null) {
        bc.append(el("p", "hint audio-ok", `Última cópia em ${fmtData(backup.ultimaEm)}.`));
        for (const e of backup.enviados) {
          const r = el("div", "conta-evento");
          r.append(el("strong", "", e.conjunto), el("span", "hint", `${e.caminho} · ${fmtBytes(e.bytes)}`));
          bc.append(r);
        }
      } else if (backup.erro === null) bc.append(el("p", "hint", "Ainda não foi feita nenhuma cópia desta máquina."));
      // O erro da tentativa anterior sai da tela enquanto a nova roda: a pessoa acabou de pedir outra.
      if (backup.erro !== null && andamento === null) bc.append(el("p", "hint bad-hint", `${backup.tentativaEm !== null ? `Última tentativa em ${fmtData(backup.tentativaEm)}: ` : ""}${backup.erro}`));
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
      acoes.append(btn(andamento !== null ? "Guardando…" : "Guardar agora", "btn-ghost", () => {
        andamento = [];
        void agir(async () => { try { backup = await deps.api.backupDadosAgora(); } finally { andamento = null; } }, "cópia guardada no Drive");
      }));
      acoes.append(btn("Abrir a pasta no Mac", "btn-ghost", () => { void agir(() => deps.api.backupDadosAbrirPasta(), "pasta aberta no Finder"); }));
      acoes.append(btn(backup.ligado ? "Desligar a cópia diária" : "Ligar a cópia diária", "btn-ghost", () => { void agir(async () => { backup = await deps.api.backupDadosLigar(!(backup?.ligado ?? true)); }, backup?.ligado === true ? "cópia diária desligada" : "cópia diária ligada"); }));
      bc.append(acoes);
    }
    panel.append(bc);

    if (deps.openGmail !== undefined) { const abrir = deps.openGmail; const tg = el("div", "admin-actions"); tg.append(btn("Abrir o E-mail", "btn-ghost", abrir)); panel.append(tg); }
  }
  const fmtData = (iso: string): string => { if (iso === "") return ""; const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };

  const page = deps.definePage("conta-google", "Conta Google", panel, () => { render(); void refresh(); });
  // `repintar`: a licença chegou depois de a página abrir (ela mostrava "consultando a licença").
  return { open: () => deps.openPage(page), refresh, repintar: () => { if (!panel.hidden) render(); } };
}
