/**
 * Página "Conta Google" (login + backup no Drive; os e-mails têm página própria, "E-mail", desde 31 out) no visual do meu-bot. A conta mora neste Mac (token cifrado
 * no Keychain, via main › conta-google.ts); aqui só se conecta, lê e escreve. A verificação de telefone/QR, quando o
 * Google pede, é feita pela pessoa na tela oficial. Fábrica com dependências explícitas, como modulos-page.ts.
 * Desde 25 nov a página é resumo → detalhe (lib/pagina.ts): "Sua conta" e "Backup no Drive" são linhas que abrem; o que
 * a pessoa precisa fazer (plano, entrar, reconectar) continua à vista, num cartão.
 */
import type { BackupCopiaOrigem, BackupCopiasView, BackupDadosProgresso, BackupDadosView, BackupRestauroProgresso, BackupRestauroResultado, GoogleContaStatus, MeuBotApi } from "../../shared/ipc";
import type { LicenseView, PlanName } from "../../shared/ipc";
import { browserAccess, proBlockText, pagamentoDoBloqueio } from "../lib/pro.js";
import { blocoPagamento } from "../lib/aviso-pagamento.js";
import { el } from "../lib/dom.js";
import { carregando } from "../lib/carregando.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { erroGoogleTexto } from "../lib/erro-google.js";
import { aplicarProgresso, aplicarRestauro, fmtBytes, terminou, textoAndamento, textoRestauro } from "./backup-andamento.js";
import { atencaoBackup, resumoBackup } from "./backup-resumo.js";
import { cabecalho, secao } from "../lib/pagina.js";

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
  api: Pick<MeuBotApi, "browserRequestPro" | "googleContaStatus" | "googleContaConectar" | "googleContaDesconectar" | "googleContaAdotarDoMac" | "backupDadosStatus" | "backupDadosAgora" | "backupDadosLigar" | "backupDadosAbrirPasta" | "backupDadosSenha" | "backupDadosLimparSenha" | "backupDadosCopias" | "backupDadosRestaurar" | "on">;
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
  const erroTexto = erroGoogleTexto;
  let busy = false; let msg: { text: string; bad: boolean } | null = null;
  /** "Pedir o Pro ao admin" já foi clicado nesta janela. */
  let proPedido = false;
  // Gmail, Agenda e Planilha saíram da página (31 out): eram ferramentas de teste sem serventia aqui; o agente continua
  // usando as três pelo backend.
  deps.api.on("google-conta:changed", (st) => { status = st; if (!panel.hidden) { render(); if (st.conectado) void carregarDados(); } });
  // Restaurar uma cópia (5 nov): de qualquer máquina, do Drive desta conta ou da pasta do Mac, por cima do que há.
  let copias: BackupCopiasView | null = null; let copiasErro: string | null = null; let copiasAberto = false;
  let maquinaEscolhida: string | null = null; let marcados = new Set<string>(); let substituir = false; let senhaRestauro = "";
  let restauro: BackupRestauroProgresso[] | null = null; let restauroResultado: BackupRestauroResultado | null = null;
  deps.api.on("backup-dados:restauro", (p) => { restauro = aplicarRestauro(restauro ?? [], p); if (!panel.hidden) render(); });
  async function carregarCopias(): Promise<void> {
    copias = null; copiasErro = null; render();
    await deps.api.backupDadosCopias().then((c) => { copias = c; if (maquinaEscolhida === null || !c.maquinas.some((m) => m.maquina === maquinaEscolhida)) escolherMaquina(c.maquinas[0]?.maquina ?? null); }, (e: unknown) => { copiasErro = erroGoogleTexto(e); }).then(render);
  }
  /** Ao trocar de máquina, tudo marcado menos Credenciais (que troca o WhatsApp e a configuração do gateway). */
  function escolherMaquina(m: string | null): void {
    maquinaEscolhida = m; substituir = false;
    marcados = new Set((copias?.maquinas.find((x) => x.maquina === m)?.conjuntos ?? []).filter((c) => c.conjunto !== "credenciais").map((c) => c.conjunto));
  }
  const origemTexto = (o: BackupCopiaOrigem): string => (o === "drive" ? "no Drive" : o === "local" ? "neste Mac" : "Drive e Mac");
  /** "2026-11-05" → "05/11/26": o dia da cópia tem que saltar aos olhos (pedido do dono, 5 nov). */
  const fmtDia = (iso: string): string => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m === null ? iso : `${m[3]}/${m[2]}/${(m[1] ?? "").slice(2)}`; };
  const diaMaisNovo = (conjuntos: readonly { data: string }[]): string => conjuntos.map((c) => c.data).sort().at(-1) ?? "";
  const nomeConjunto = (id: string): string => copias?.maquinas.flatMap((m) => m.conjuntos).find((c) => c.conjunto === id)?.nome ?? id;
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
    try { await run(); msg = { text: ok, bad: false }; } catch (e) { msg = { text: erroGoogleTexto(e), bad: true }; }
    busy = false; await refresh();
  }
  const btn = (label: string, cls: string, run: () => void): HTMLButtonElement => { const b = el("button", `btn ${cls} btn-small`, label); b.type = "button"; b.disabled = busy; b.addEventListener("click", run); return b; };
  const input = (ph: string, val = "", max = 120): HTMLInputElement => { const i = el("input"); i.type = "text"; i.placeholder = ph; i.value = val; i.maxLength = max; i.disabled = busy; return i; };
  const field = (label: string, ctl: HTMLElement): HTMLElement => { const w = el("label", "admin-field"); w.append(el("span", "hint", label), ctl); return w; };
  const card = (titulo: string): HTMLElement => { const c = el("div", "admin-card"); c.append(el("strong", "", titulo)); return c; };

  /** Botões lado a lado no tamanho do texto: `.admin-card` é flex em coluna e esticaria o botão solto à largura toda. */
  const acoes = (...bs: HTMLElement[]): HTMLElement => { const a = el("div", "admin-actions"); a.append(...bs); return a; };
  /** Ação destrutiva: cor de perigo desde o primeiro olhar e segundo clique pelo `armConfirm` (que preserva a cor). */
  const perigo = (label: string, confirmar: string, run: () => void): HTMLButtonElement => {
    const b = btn(label, "btn-bad", () => { deps.armConfirm(b, confirmar, run); });
    return b;
  };
  // O motivo de atenção do backup enquanto o estado é relido (cada ação relê): sem isto a seção piscaria fechada.
  let atencaoDoBackup = "";

  function render(): void {
    panel.replaceChildren();
    // Uma frase só; o resto da explicação (cada máquina com a sua conta, acesso só neste Mac) mora na seção "Sua conta".
    panel.append(cabecalho("Conta Google", "É por ela que o meu-bot lê o Gmail, a Agenda e as planilhas."));
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
        b.disabled = busy || proPedido; c.append(acoes(b));
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
      b.disabled = busy; c.append(acoes(b));
      panel.append(c); return;
    }

    // O que a pessoa precisa fazer (entrar, reconectar) fica à vista, num cartão; o que é só consulta vira seção que abre.
    if (!status.conectado) {
      const pc = card("Sua conta");
      pc.append(el("p", "hint", "Ao entrar, o login abre no Navegador. Qualquer verificação de telefone é feita por você, no seu celular, na tela do Google."));
      // Procedência do client: um arquivo velho vencendo em silêncio já custou uma caçada longa, e
      // o Google só diz "access_denied" no navegador, longe daqui. Aqui a origem fica à vista.
      if (status.cliente !== null) pc.append(el("p", "hint", `Entrando pelo projeto ${status.cliente.projeto} do Google Cloud (client vindo do ${status.cliente.origem}). Se o Google recusar dizendo que o app não foi verificado, é este projeto que precisa liberar o seu e-mail.`));
      pc.append(acoes(btn("Entrar com Google", "btn-primary", () => { void agir(() => deps.api.googleContaConectar(), "login aberto no Navegador desta máquina; conclua lá e volte"); })));
      // A conta que estava conectada no Mac antes de a conta ser por máquina: só vale aqui por escolha explícita.
      if (status.contaDoMac !== null) {
        pc.append(el("p", "hint", `Antes, este Mac tinha uma conta só para todas as máquinas: ${status.contaDoMac}. Se ela é a certa para ${status.maquina}, use-a aqui sem entrar de novo.`));
        pc.append(acoes(btn(`Usar ${status.contaDoMac} nesta máquina`, "btn-ghost", () => { void agir(() => deps.api.googleContaAdotarDoMac(), `conta ${status?.contaDoMac ?? ""} em uso nesta máquina`); })));
      }
      panel.append(pc);
    } else if (status.precisaReconectar) {
      const rc = el("div", "admin-card");
      rc.append(el("p", "hint bad-hint", "Faltam permissões (Gmail, Agenda, Sheets ou Drive). Quem conectou antes do backup no Drive precisa reconectar uma vez para a cópia diária funcionar."));
      rc.append(acoes(btn("Reconectar", "btn-primary", () => { void agir(() => deps.api.googleContaConectar(), "reautorização aberta no Navegador"); })));
      panel.append(rc);
    }
    // O resultado da ação e a espera do login ficam fora das seções: valem para a página, não para um detalhe.
    if (msg) panel.append(el("p", `hint ${msg.bad ? "bad-hint" : "audio-ok"}`, msg.text));
    if (status.conectando) panel.append(el("p", "hint", "Esperando você concluir o login no Navegador…"));
    if (!status.conectado) return;

    // Sua conta: fechada é "e-mail · conectada"; aberta, o perfil, a explicação que saiu do cabeçalho e "Desconectar".
    const email = status.perfil?.email ?? "";
    const sp = secao({ chave: "conta-google:conta", titulo: "Sua conta", resumo: `${email !== "" ? email : status.perfil?.nome ?? "conta"} · ${status.precisaReconectar ? "precisa reconectar" : "conectada"}` });
    const linha = el("div", "conta-perfil");
    // Sempre a `fotoLocal` (data URL): a URL do Google cai no CSP `img-src 'self' data:` e nao carregaria.
    if (status.perfil?.fotoLocal) { const img = el("img", "conta-foto"); img.src = status.perfil.fotoLocal; img.alt = ""; linha.append(img); }
    const info = el("div"); info.append(el("strong", "", status.perfil?.nome ?? "conta conectada"), el("div", "hint", email));
    linha.append(info);
    sp.corpo.append(linha, el("p", "hint", `Conta Google da máquina ${status.maquina}: cada máquina entra com a sua, e desconectar aqui não mexe nas outras. O acesso fica guardado só neste Mac.`));
    sp.corpo.append(acoes(perigo("Desconectar", "Confirmar? tira a conta só desta máquina", () => { void agir(() => deps.api.googleContaDesconectar(), "conta desconectada"); })));
    panel.append(sp.raiz);
    if (status.precisaReconectar) return;

    // Backup: a cópia do CRM e do financeiro desta máquina no Drive desta conta. Fechada, o estado em uma linha e
    // "Guardar agora"; abre sozinha quando há o que resolver ou acompanhar (erro, senha faltando, cópia ou restauro em curso).
    const guardando = andamento !== null;
    const restaurando = copiasAberto || restauro !== null || restauroResultado !== null;
    if (backup !== null || backupErro !== null) atencaoDoBackup = atencaoBackup({ erroLeitura: backup === null, falhou: backup !== null && backup.erro !== null, semSenha: backup !== null && !backup.temSenha, guardando, restauro: restaurando });
    else atencaoDoBackup = atencaoBackup({ erroLeitura: atencaoDoBackup.includes("leitura"), falhou: atencaoDoBackup.includes("erro"), semSenha: atencaoDoBackup.includes("sem-senha"), guardando, restauro: restaurando });
    const agora = btn(guardando ? "Guardando…" : "Guardar agora", "btn-primary", () => {
      andamento = [];
      void agir(async () => { try { backup = await deps.api.backupDadosAgora(); } finally { andamento = null; } }, "cópia guardada no Drive");
    });
    agora.disabled = busy || backup === null;
    const sb = secao({
      chave: "conta-google:backup", titulo: "Backup no Drive", atencao: atencaoDoBackup, acao: agora,
      resumo: resumoBackup({ lido: backup !== null, erroLeitura: backupErro !== null, ligado: backup?.ligado ?? false, ultimaEm: backup !== null && backup.ultimaEm !== null ? fmtData(backup.ultimaEm) : null, guardando, falhou: backup !== null && backup.erro !== null }),
    });
    const bc = sb.corpo;
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

      const pasta = acoes(btn("Abrir a pasta no Mac", "btn-ghost", () => { void agir(() => deps.api.backupDadosAbrirPasta(), "pasta aberta no Finder"); }));
      if (!copiasAberto) pasta.append(btn("Restaurar uma cópia…", "btn-ghost", () => { copiasAberto = true; restauroResultado = null; void carregarCopias(); }));
      bc.append(pasta);
      if (copiasAberto) secaoRestauro(bc);

      // Senha do pacote de credenciais. Sem ela esse conjunto é pulado; os outros sobem normalmente.
      const sc = el("div", "admin-actions");
      // Senha curta: o clique dizia nada. O aviso entra no lugar, sem repintar (repintar apagaria o que foi digitado).
      const curta = el("p", "hint bad-hint", "A senha precisa de pelo menos 8 caracteres."); curta.hidden = true;
      const senhaOk = (i: HTMLInputElement): boolean => { curta.hidden = i.value.trim().length >= 8; return curta.hidden; };
      if (backup.temSenha) {
        // Senha definida é assunto resolvido: trocar e apagar ficam numa seção própria, fechada, dentro do backup.
        sc.append(el("p", "hint audio-ok", "As credenciais da máquina sobem cifradas com a sua senha. Guarde-a fora do computador: sem ela esse pacote não abre."));
        // Sem prompt(): o Electron não implementa window.prompt (devolvia undefined e o botão virava no-op). Campo inline.
        const nova = input("nova senha (mínimo 8 caracteres)", "", 200); nova.type = "password";
        sc.append(field("Trocar a senha", nova), btn("Trocar", "btn-ghost", () => { if (!senhaOk(nova)) return; void agir(async () => { backup = await deps.api.backupDadosSenha(nova.value); }, "senha trocada; vale a partir da próxima cópia"); }));
        sc.append(perigo("Apagar a senha", "Confirmar? as credenciais param de ser copiadas", () => { void agir(async () => { backup = await deps.api.backupDadosLimparSenha(); }, "senha apagada; as credenciais não sobem mais"); }));
        sc.append(curta);
        const ss = secao({ chave: "conta-google:senha", titulo: "Senha das credenciais", resumo: "definida" });
        ss.corpo.append(sc); bc.append(ss.raiz);
      } else {
        // Senha faltando é pendência: fica à vista no corpo (e a seção do backup abre sozinha por causa dela).
        sc.append(el("p", "hint bad-hint", "As credenciais da máquina (tokens e sessão do WhatsApp) não estão sendo copiadas: defina uma senha. Elas nunca sobem sem cifra."));
        const inp = input("senha do backup cifrado", "", 200); inp.type = "password";
        sc.append(field("Senha", inp), btn("Definir a senha", "btn-ghost", () => { if (!senhaOk(inp)) return; void agir(async () => { backup = await deps.api.backupDadosSenha(inp.value); }, "senha definida; as credenciais entram na próxima cópia"); }));
        sc.append(curta);
        bc.append(sc);
      }

      // Desligar para a proteção: cor de perigo e segundo clique, como "Apagar a senha". Ligar não.
      const ligado = backup.ligado;
      const alternar = (): void => { void agir(async () => { backup = await deps.api.backupDadosLigar(!ligado); }, ligado ? "cópia diária desligada" : "cópia diária ligada"); };
      bc.append(acoes(ligado ? perigo("Desligar a cópia diária", "Confirmar? a máquina para de ser copiada", alternar) : btn("Ligar a cópia diária", "btn-ghost", alternar)));
    }
    panel.append(sb.raiz);

    if (deps.openGmail !== undefined) panel.append(acoes(btn("Abrir o E-mail", "btn-ghost", deps.openGmail)));
  }
  /** O cartão de restaurar: escolha da máquina de origem e dos conjuntos, andamento e resumo. */
  function secaoRestauro(bc: HTMLElement): void {
    const sc = el("div", "conta-restauro");
    sc.append(el("strong", "", "Restaurar uma cópia nesta máquina"));
    const fechar = (): void => { copiasAberto = false; restauroResultado = null; render(); };
    if (restauro !== null) {
      sc.append(carregando("Restaurando…", "backup-restauro", "Cada conjunto é lido, aberto e extraído na máquina; costuma levar perto de um minuto. Não feche a janela."));
      const linha = textoRestauro(restauro);
      if (linha !== "") sc.append(el("p", "hint", linha));
      bc.append(sc); return;
    }
    if (restauroResultado !== null) {
      const r = restauroResultado;
      if (r.restaurados.length > 0) sc.append(el("p", "hint audio-ok", `Restaurado nesta máquina: ${r.restaurados.map(nomeConjunto).join(", ")}.`));
      if (r.antes !== null) sc.append(el("p", "hint", `O que foi substituído ficou guardado na máquina, em ${r.antes}.`));
      for (const e of r.erros) sc.append(el("p", "hint bad-hint", e));
      for (const a of r.avisos) sc.append(el("p", "hint", a));
      if (r.restaurados.includes("agente")) sc.append(el("p", "hint", "As conversas antigas do agente aparecem ao lado das de hoje ao retomar uma conversa."));
      const ac = el("div", "admin-actions");
      ac.append(btn("Restaurar outra", "btn-ghost", () => { restauroResultado = null; void carregarCopias(); }), btn("Fechar", "btn-ghost", fechar));
      sc.append(ac); bc.append(sc); return;
    }
    sc.append(el("p", "hint", "Escolha de que máquina e o que volta. A cópia entra por cima do que há aqui: cada arquivo substituído fica guardado numa pasta de segurança na máquina, e o que só existe aqui continua. O WhatsApp só é trocado se você pedir."));
    if (copias === null) {
      if (copiasErro === null) sc.append(carregando("Procurando as cópias no Drive e neste Mac…"));
      else sc.append(el("p", "hint bad-hint", `Não consegui listar as cópias: ${copiasErro}`), btn("Tentar de novo", "btn-ghost", () => { void carregarCopias(); }));
      bc.append(sc); return;
    }
    if (copias.driveErro !== null) sc.append(el("p", "hint bad-hint", `Não li o Drive (${copias.driveErro}); mostrando só as cópias deste Mac.`));
    if (copias.maquinas.length === 0) { sc.append(el("p", "hint", "Nenhuma cópia encontrada no Drive desta conta nem neste Mac."), btn("Fechar", "btn-ghost", fechar)); bc.append(sc); return; }
    const sel = el("select");
    for (const m of copias.maquinas) { const o = el("option", "", `${m.maquina} · dia ${fmtDia(diaMaisNovo(m.conjuntos))}${m.maquina === copias.atual ? " (esta máquina)" : ""}`); o.value = m.maquina; o.selected = m.maquina === maquinaEscolhida; sel.append(o); }
    sel.disabled = busy; sel.addEventListener("change", () => { escolherMaquina(sel.value); render(); });
    sc.append(field("Máquina de origem", sel));
    const maq = copias.maquinas.find((m) => m.maquina === maquinaEscolhida);
    if (maq === undefined) { bc.append(sc); return; }
    if (maq.maquina === copias.atual) sc.append(el("p", "hint", "É a cópia desta própria máquina: o que há hoje vai para a pasta de segurança e volta o da cópia."));
    for (const c of maq.conjuntos) {
      const lab = el("label", "conta-restauro-item"); const cb = el("input"); cb.type = "checkbox"; cb.checked = marcados.has(c.conjunto); cb.disabled = busy;
      cb.addEventListener("change", () => { if (cb.checked) marcados.add(c.conjunto); else marcados.delete(c.conjunto); render(); });
      lab.append(cb, el("strong", "", c.nome), el("span", "hint", `dia ${fmtDia(c.data)} · ${fmtBytes(c.bytes)} · ${origemTexto(c.origem)}${c.cifrado ? " · cifrado" : ""}`));
      sc.append(lab);
    }
    if (marcados.has("credenciais")) {
      sc.append(el("p", "hint bad-hint", "Credenciais traz o pareamento do WhatsApp, os tokens e a configuração do gateway da máquina de origem. Só faz sentido com a máquina antiga desligada; o gateway daqui reinicia."));
      const lab = el("label", "conta-restauro-item"); const cb = el("input"); cb.type = "checkbox"; cb.checked = substituir; cb.disabled = busy;
      cb.addEventListener("change", () => { substituir = cb.checked; render(); });
      lab.append(cb, el("span", "", "substituir o WhatsApp desta máquina pelo da cópia")); sc.append(lab);
    }
    // A cópia pode ter sido cifrada com outra senha (outro app deste Mac, outra máquina, senha trocada depois): a gravada é
    // tentada primeiro e esta entra em seguida; sem senha gravada, só esta.
    if (maq.conjuntos.some((c) => c.cifrado && marcados.has(c.conjunto))) {
      const inp = input(copias.temSenha ? "só se a cópia foi cifrada com outra senha" : "senha do backup cifrado", senhaRestauro, 200); inp.type = "password"; inp.addEventListener("input", () => { senhaRestauro = inp.value; });
      sc.append(el("p", "hint", copias.temSenha
        ? "Os conjuntos cifrados abrem com a senha de backup gravada neste Mac. Se a cópia foi cifrada com outra senha (noutro app ou máquina, ou antes de você trocá-la), informe-a aqui; vale só para esta restauração."
        : "Há conjunto cifrado marcado e esta máquina não tem senha de backup gravada: informe a senha que cifrou a cópia. Ela vale só para esta restauração."), field("Senha", inp));
    }
    const ac = el("div", "admin-actions");
    const go = btn("Restaurar nesta máquina", "btn-primary", () => {
      if (marcados.size === 0) return;
      deps.armConfirm(go, "Confirmar? entra por cima do que há; o substituído fica guardado", () => {
        restauro = []; restauroResultado = null;
        const pedido = { maquina: maq.maquina, conjuntos: [...marcados], substituirWhatsapp: substituir, ...(senhaRestauro.trim() !== "" ? { senha: senhaRestauro } : {}) };
        void agir(async () => { try { restauroResultado = await deps.api.backupDadosRestaurar(pedido); senhaRestauro = ""; } finally { restauro = null; } }, "restauração concluída; veja o resumo no cartão");
      });
    });
    go.disabled = busy || marcados.size === 0;
    ac.append(go, btn("Fechar", "btn-ghost", fechar));
    sc.append(ac); bc.append(sc);
  }
  const fmtData = (iso: string): string => { if (iso === "") return ""; const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };

  const page = deps.definePage("conta-google", "Conta Google", panel, () => { render(); void refresh(); });
  // `repintar`: a licença chegou depois de a página abrir (ela mostrava "consultando a licença").
  return { open: () => deps.openPage(page), refresh, repintar: () => { if (!panel.hidden) render(); } };
}
