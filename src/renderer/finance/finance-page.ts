/**
 * Página "Finanças" (produto meu-bot-finance), no visual do meu-bot: o que o agente lançou pelo WhatsApp e pelo chat,
 * o que depende da pessoa (checklist do mês: pendências, renda, dinheiro vivo, fechar o mês anterior), contas e o
 * mês por categoria. Os números moram na máquina (/v1/finance pelo túnel, via main › finance-local.ts); aqui só se
 * mostra e se pede. Fábrica com dependências explícitas, como admin/produtos-page.ts.
 */
import type { BackendModel, FinanceImportacao, FinanceAbc, FinanceAbcLado, FinanceAbcPor, FinanceConfig, FinanceLinhaDre, FinanceMoeda, FinanceTipoLinha, FinanceCategoria, FinanceInfo, FinanceLancamento, LicenseView, MeuBotApi } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { carregando } from "../lib/carregando.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { financeOk, proBlockText, pagamentoDoBloqueio } from "../lib/pro.js";
import { blocoPagamento } from "../lib/aviso-pagamento.js";

export interface FinancePageDeps {
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  armConfirm(btn: HTMLButtonElement, label: string, run: () => void): void;
  api: Pick<MeuBotApi, "financeInfo" | "financeLancamentos" | "financeCategorias" | "financeLancar" | "financeConfirmar" | "financeDescartar" | "financeCorrigir" | "financeComprovante" | "financeLinhaSalvar" | "financeLinhaRemover" | "financeConfirmarTodas" | "financeContaCriar" | "financeMes" | "financeFecharMes" | "financeConfigLer" | "financeConfig" | "installFinance" | "financePedir" | "financeAbc" | "financeImportarPlanilha" | "on">;
  host(): string;
  license(): LicenseView | null;
  /** A licença desta janela já foi lida (antes disso, nada de bloqueio precipitado). */
  licenseKnown(): boolean;
  goToChat(message: string, hint: string, model?: BackendModel): Promise<void>;
  /** Avisa a janela (tutorial 12, contador da lateral) quando o estado muda. */
  onInfo(info: FinanceInfo | null): void;
  /** Abre a página Módulos (com o módulo Finanças ligado, o financeiro mora lá); null no app sem a página. */
  abrirModulos: (() => void) | null;
}

const ORIGEM: Record<string, string> = { whatsapp: "WhatsApp", foto: "foto", chat: "chat", app: "app", agente: "agente", planilha: "planilha" };
const TIPOS: [string, string][] = [["corrente", "Conta corrente"], ["cartao", "Cartão de crédito"], ["poupanca", "Poupança"], ["dinheiro", "Dinheiro vivo"], ["outra", "Outra"]];
const dataCurta = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function mountFinancePage(deps: FinancePageDeps): { open: () => void; refresh: () => Promise<void>; info: () => FinanceInfo | null } {
  const panel = el("section", "acervo-panel finance-panel"); panel.hidden = true;
  deps.panelsEl.append(panel);
  let info: FinanceInfo | null = null;
  // Config de moeda do sistema (taxas + moeda de exibição). A LV exibe em dólar; o padrão é real.
  let cfg: FinanceConfig | null = null;
  const MOEDA_INFO_FB: Record<FinanceMoeda, { casas: number; simbolo: string }> = { BRL: { casas: 2, simbolo: "R$" }, PYG: { casas: 0, simbolo: "₲" }, USD: { casas: 2, simbolo: "US$" } };
  const infoMoeda = (m: FinanceMoeda): { casas: number; simbolo: string } => cfg?.moedaInfo?.[m] ?? MOEDA_INFO_FB[m] ?? MOEDA_INFO_FB.BRL;
  const moedaExib = (): FinanceMoeda => cfg?.moedaExibicao ?? "BRL";
  const fmtMoeda = (cent: number, m: FinanceMoeda): string => { const { casas, simbolo } = infoMoeda(m); const mult = 10 ** casas; const n = Math.abs(Math.trunc(cent)); const inteiro = Math.floor(n / mult).toLocaleString("pt-BR"); const dec = casas > 0 ? `,${String(n % mult).padStart(casas, "0")}` : ""; return `${cent < 0 ? "-" : ""}${simbolo} ${inteiro}${dec}`; };
  const fmt = (cent: number): string => fmtMoeda(cent, moedaExib());
  // Minor units → texto editável na moeda (BRL/USD 2 casas, PYG 0): para os campos de valor.
  const centParaInput = (cent: number, m: FinanceMoeda): string => { const casas = infoMoeda(m).casas; const mult = 10 ** casas; return casas > 0 ? (Math.abs(cent) / mult).toFixed(casas).replace(".", ",") : String(Math.round(Math.abs(cent) / mult)); };
  let ultimos: FinanceLancamento[] = [];
  let pendentes: FinanceLancamento[] = [];
  let categorias: FinanceCategoria[] = [];
  let busy = false; let msg: { text: string; bad: boolean } | null = null;
  let instLog: string[] = []; let instalando = false;
  // Submódulo Curva ABC: aba própria dentro de Finanças. Filtro lembrado enquanto a janela vive.
  let aba: "geral" | "abc" = "geral";
  const abcF: { lado: FinanceAbcLado; por: FinanceAbcPor; meses: number } = { lado: "venda", por: "produto", meses: 3 };
  let abc: FinanceAbc | null = null; let abcErro: string | null = null; let abcCarregando = false;
  // Importação do Google Sheets (dentro da Curva ABC): prévia primeiro, depois importa.
  const imp: { link: string; aba: string; tipo: FinanceAbcLado } = { link: "", aba: "", tipo: "venda" };
  let impRes: FinanceImportacao | null = null; let impErro: string | null = null; let impBusy = false;
  async function importarPlanilha(simular: boolean): Promise<void> {
    impBusy = true; impErro = null; if (simular) impRes = null; render();
    try { impRes = await deps.api.financeImportarPlanilha({ link: imp.link, ...(imp.aba.trim() ? { aba: imp.aba.trim() } : {}), tipo: imp.tipo, simular }); if (!simular && impRes.importadas > 0) { abc = null; void carregarAbc(); } }
    catch (err) { impErro = ipcErrorText(err); }
    impBusy = false; render();
  }
  function cardImportar(): HTMLElement {
    const c = card("Importar do Google Sheets");
    c.append(el("p", "hint", "Vendas (ou compras) numa planilha do Google, uma linha por item: colunas Data, Cliente (ou Fornecedor), Produto, Quantidade e Valor; Categoria, Tipo e Obs são opcionais. Sem Produto a linha entra no financeiro, mas fica fora da curva por produto. Compartilhe a planilha com a conta Google conectada no app. Importar de novo a mesma planilha só traz as linhas novas."));
    const link = input("link da planilha (docs.google.com/spreadsheets/d/…)", imp.link, 500); link.addEventListener("input", () => { imp.link = link.value; });
    const aba = input("aba (vazio = a primeira)", imp.aba, 100); aba.addEventListener("input", () => { imp.aba = aba.value; });
    const tipo = el("select"); for (const [v, r] of [["compra", "Compras (saídas)"], ["venda", "Vendas (entradas)"]] as const) { const o = el("option", "", r); o.value = v; o.selected = imp.tipo === v; tipo.append(o); }
    tipo.disabled = impBusy; tipo.addEventListener("change", () => { imp.tipo = tipo.value as FinanceAbcLado; impRes = null; });
    const f = el("div", "admin-actions");
    f.append(field("Planilha", link), field("Aba", aba), field("O quê", tipo), btn(impBusy ? "Lendo…" : "Pré-visualizar", "btn-ghost", () => { if (imp.link.trim() === "") return; void importarPlanilha(true); }));
    c.append(f);
    if (impErro !== null) c.append(el("p", "hint bad-hint", impErro));
    if (impRes !== null) {
      const r = impRes;
      const partes = [`${r.lidas} linha(s) lida(s)`, r.jaImportadas > 0 ? `${r.jaImportadas} já importada(s)` : "", r.totalErros > 0 ? `${r.totalErros} com problema` : ""].filter(Boolean).join(" · ");
      c.append(el("p", r.simulado ? "hint" : "hint audio-ok", r.simulado ? `Prévia: ${r.aImportar} lançamento(s) a importar (${partes}). Colunas: ${Object.values(r.colunas).join(", ")}.` : `Importado: ${r.importadas} lançamento(s) (${partes}).`));
      for (const e of r.erros.slice(0, 5)) c.append(el("p", "hint bad-hint", `linha ${e.linha}: ${e.motivo}`));
      if (r.amostra.length > 0) { const ul = el("ul", "admin-health"); for (const l of r.amostra) ul.append(el("li", "", `${dataCurta(l.data)} · ${l.favorecido} · ${l.valorExib} · ${l.categoriaNome}`)); c.append(ul); }
      if (r.simulado && r.aImportar > 0) c.append(btn(impBusy ? "Importando…" : `Importar ${r.aImportar} lançamento(s)`, "btn-primary", () => { void importarPlanilha(false); }));
    }
    return c;
  }
  async function carregarAbc(): Promise<void> {
    abcCarregando = true; abcErro = null; render();
    try { abc = await deps.api.financeAbc({ ...abcF }); } catch (err) { abc = null; abcErro = ipcErrorText(err); }
    abcCarregando = false; render();
  }
  deps.api.on("finance:progress", ({ line }) => { instLog = [...instLog, line].slice(-6); if (!panel.hidden) render(); });

  async function refresh(): Promise<void> {
    if (!financeOk(deps.license(), deps.host())) { info = null; deps.onInfo(null); render(); return; }
    try {
      info = await deps.api.financeInfo();
      cfg = await deps.api.financeConfigLer().catch(() => cfg);
      if (info.estado !== null) {
        const [l, p, c] = await Promise.all([deps.api.financeLancamentos({ limite: 15 }), deps.api.financeLancamentos({ status: "pendente", limite: 100 }), categorias.length > 0 ? Promise.resolve(categorias) : deps.api.financeCategorias()]);
        ultimos = l.lancamentos; pendentes = p.lancamentos; categorias = c;
      }
    } catch (e) { info = { modulo: null, estado: null, erro: ipcErrorText(e), virouModulo: false }; }
    deps.onInfo(info);
    render();
  }
  /** Roda uma ação, mostra o resultado e relê tudo. */
  async function agir(run: () => Promise<unknown>, ok: string): Promise<void> {
    if (busy) return; busy = true; msg = null; render();
    try { await run(); msg = { text: ok, bad: false }; } catch (e) { msg = { text: ipcErrorText(e).replace(/^FINANCE_REQUIRED$/, "o financeiro não está liberado nesta máquina"), bad: true }; }
    busy = false; await refresh();
  }
  const btn = (label: string, cls: string, run: () => void): HTMLButtonElement => { const b = el("button", `btn ${cls} btn-small`, label); b.type = "button"; b.disabled = busy; b.addEventListener("click", run); return b; };
  const input = (placeholder: string, value = "", max = 80): HTMLInputElement => { const i = el("input"); i.type = "text"; i.placeholder = placeholder; i.value = value; i.maxLength = max; i.disabled = busy; return i; };
  const field = (label: string, ctl: HTMLElement): HTMLElement => { const w = el("label", "admin-field"); w.append(el("span", "hint", label), ctl); return w; };
  const selectCategoria = (atual: string, renda: boolean): HTMLSelectElement => {
    const s = el("select"); s.disabled = busy;
    for (const c of categorias.filter((x) => x.renda === renda)) { const o = el("option", "", c.nome); o.value = c.key; if (c.key === atual) o.selected = true; s.append(o); }
    return s;
  };
  /** Cartões recolhíveis (Contas, Lançar à mão): fechados por padrão; o que a pessoa abriu continua aberto ao repintar. */
  const abertos = new Set<string>();
  const fechados = new Set<string>();
  const dobra = (id: string, titulo: string, resumo?: string, abertoPorPadrao = false): HTMLElement => {
    const d = el("details", "admin-card admin-logs-card finance-dobra"); d.open = abertoPorPadrao ? !fechados.has(id) : abertos.has(id);
    const sm = el("summary", "admin-card-head"); sm.append(el("strong", "", titulo)); if (resumo) sm.append(el("span", "hint", resumo));
    d.append(sm);
    d.addEventListener("toggle", () => { if (d.open) { abertos.add(id); fechados.delete(id); } else { abertos.delete(id); fechados.add(id); } });
    return d;
  };
  const card = (titulo: string, extra?: HTMLElement): HTMLElement => { const c = el("div", "admin-card"); const h = el("div", "admin-card-head"); h.append(el("strong", "", titulo)); if (extra) h.append(extra); c.append(h); return c; };

  /** Lançamento aberto (detalhe e edição) e as fotos de comprovante já lidas da máquina (sha256 → data URL). */
  let aberto: string | null = null;
  let linhaAberta: string | null = null;
  const fotos = new Map<string, string | null>();
  const contasDe = (): { key: string; nome: string }[] => info?.estado?.contas ?? [];
  const dataBr = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  const ORIGEM_LONGA: Record<string, string> = { whatsapp: "WhatsApp (o agente lançou)", foto: "foto de comprovante", chat: "chat do app", app: "lançado à mão no app", agente: "o agente lançou" };
  const DUVIDA: Record<string, string> = { categoria: "categoria incerta", valor: "valor lido de foto", duplicado: "parece repetido", conta: "sem conta" };

  /** Detalhe de um lançamento: tudo o que se sabe dele, a foto do comprovante (se houver) e a edição de cada campo. */
  function detalhe(l: FinanceLancamento): HTMLElement {
    const box = el("div", "finance-detalhe");
    const meta = el("p", "hint");
    meta.textContent = [`Origem: ${ORIGEM_LONGA[l.origem] ?? l.origem}`, l.status === "pendente" ? "pendente" : "confirmado", ...l.duvidas.map((d) => DUVIDA[d] ?? d)].join(" · ");
    box.append(meta);
    if (l.midia) {
      const foto = fotos.get(l.midia.sha256);
      if (foto === undefined) { box.append(carregando("Carregando o comprovante…")); void deps.api.financeComprovante(l.midia.sha256).then((u) => { fotos.set(l.midia!.sha256, u); render(); }).catch(() => { fotos.set(l.midia!.sha256, null); render(); }); }
      else if (foto === null) box.append(el("p", "hint bad-hint", "A foto do comprovante não está mais na máquina."));
      else { const img = el("img", "finance-foto"); img.src = foto; img.alt = `Comprovante: ${l.midia.nome}`; img.addEventListener("click", () => img.classList.toggle("grande")); box.append(img); }
    }
    const f = el("div", "admin-actions");
    const valor = input("48,90", centParaInput(l.valorCent, l.moeda), 20);
    const data = input("dd/mm/aaaa", dataBr(l.data), 12);
    const fav = input("onde / de quem", l.favorecido);
    const cat = selectCategoria(l.categoria, l.valorCent > 0);
    const conta = el("select"); conta.disabled = busy;
    for (const c of [{ key: "", nome: "sem conta" }, ...contasDe()]) { const o = el("option", "", c.nome); o.value = c.key; if ((l.conta ?? "") === c.key) o.selected = true; conta.append(o); }
    const notas = input("notas (opcional)", l.notas ?? "", 500);
    const linhaSel = el("select"); linhaSel.disabled = busy;
    for (const x of [{ key: "", nome: "nenhuma" }, ...(info?.estado?.resumo.dre?.linhas ?? [])]) { const o = el("option", "", x.nome); o.value = x.key; if ((l.linha ?? "") === x.key) o.selected = true; linhaSel.append(o); }
    f.append(field("Valor", valor), field("Data", data), field("Onde", fav), field("Categoria", cat), field("Conta", conta), field("Linha da DRE", linhaSel), field("Notas", notas));
    box.append(f);
    const acoes = el("div", "admin-actions");
    acoes.append(btn("Salvar", "btn-primary", () => {
      const patch: { valor?: string; favorecido?: string; categoria?: string; conta?: string | null; data?: string; notas?: string; linha?: string | null } = {};
      if (valor.value.trim() !== "" && valor.value.trim() !== centParaInput(l.valorCent, l.moeda)) patch.valor = valor.value.trim();
      if (data.value.trim() !== dataBr(l.data)) patch.data = data.value.trim();
      if (fav.value.trim() !== l.favorecido) patch.favorecido = fav.value.trim();
      if (cat.value !== l.categoria) patch.categoria = cat.value;
      if (conta.value !== (l.conta ?? "")) patch.conta = conta.value === "" ? null : conta.value;
      if (notas.value.trim() !== (l.notas ?? "")) patch.notas = notas.value.trim();
      if (linhaSel.value !== (l.linha ?? "")) patch.linha = linhaSel.value === "" ? null : linhaSel.value;
      if (Object.keys(patch).length === 0) { aberto = null; render(); return; }
      void agir(() => deps.api.financeCorrigir(l.id, patch), "lançamento corrigido");
    }));
    if (l.status === "pendente") acoes.append(btn("Confirmar", "btn-ghost", () => { void agir(() => deps.api.financeConfirmar(l.id, cat.value), "confirmado"); }));
    const d = btn("Descartar", "btn-ghost", () => { deps.armConfirm(d, "Confirmar? apaga o lançamento", () => { aberto = null; void agir(() => deps.api.financeDescartar(l.id), "lançamento descartado"); }); });
    acoes.append(d, btn("Fechar", "btn-ghost", () => { aberto = null; render(); }));
    box.append(acoes);
    return box;
  }

  function linhaLanc(l: FinanceLancamento, comAcoes: boolean): HTMLElement {
    const wrap = el("div", "finance-item");
    const row = el("div", `finance-row${l.status === "pendente" ? " pendente" : ""}${aberto === l.id ? " aberto" : ""}`);
    wrap.append(row);
    const main = el("div", "finance-row-main finance-clicavel");
    main.tabIndex = 0; main.setAttribute("role", "button"); main.title = "Ver detalhes e editar";
    const alternar = (): void => { aberto = aberto === l.id ? null : l.id; render(); };
    main.addEventListener("click", alternar);
    main.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); alternar(); } });
    main.append(el("span", "finance-data", dataCurta(l.data)), el("strong", "finance-fav", l.favorecido || "(sem nome)"), el("span", "hint finance-meta", [l.categoriaNome, l.contaNome, ORIGEM[l.origem] ?? l.origem].filter(Boolean).join(" · ")));
    if (l.midia) main.append(el("span", "finance-clip", "📎"));
    const vcell = el("span", `finance-valor ${l.valorCent < 0 ? "gasto" : "renda"}`, l.valorExib);
    if (l.moeda !== moedaExib() || l.moedaOriginal) vcell.title = `registrado: ${l.moedaOriginal ? l.valorOriginal : l.valor}`;
    row.append(main, vcell);
    if (comAcoes) {
      const acoes = el("div", "finance-acoes");
      if (l.duplicadoDe) acoes.append(el("span", "hint bad-hint", "parece repetido"));
      const sel = selectCategoria(l.categoria, l.valorCent > 0);
      acoes.append(sel, btn("Confirmar", "btn-primary", () => { void agir(() => deps.api.financeConfirmar(l.id, sel.value), `confirmado em ${sel.selectedOptions[0]?.textContent ?? ""}`); }));
      const d = btn("Descartar", "btn-ghost", () => { deps.armConfirm(d, "Confirmar? apaga o lançamento", () => { void agir(() => deps.api.financeDescartar(l.id), "lançamento descartado"); }); });
      acoes.append(d);
      row.append(acoes);
    }
    if (aberto === l.id) wrap.append(detalhe(l));
    return wrap;
  }

  function render(): void {
    panel.replaceChildren();
    const e = info?.estado ?? null;
    const head = el("div", "guide-head"); const hb = el("div", "tut-body");
    hb.append(el("span", "tut-badge", "financeiro"), el("h2", "", e !== null ? `Finanças · ${e.resumo.nome}` : "Finanças"), el("p", "", "O agente lança o que você conta no WhatsApp ou no chat (e o que você fotografa). Aqui você confere, corrige e faz só o que depende de você."));
    head.append(hb); panel.append(head);
    const host = deps.host();
    if (!deps.licenseKnown()) { panel.append(carregando("Consultando a licença desta máquina…")); return; }
    if (!financeOk(deps.license(), host)) {
      const t = proBlockText(host === "local" ? "unknown" : "assinatura", deps.license(), "finance", "meu-bot-finance");
      const c = card(host === "local" ? "O financeiro mora numa máquina" : t.title);
      c.append(el("p", "", host === "local" ? "Abra uma janela numa máquina por SSH (é lá que ficam o agente do WhatsApp e os seus dados)." : t.text));
      const pg = host === "local" ? null : pagamentoDoBloqueio("assinatura", deps.license());
      if (pg !== null) c.append(blocoPagamento(pg));
      if (host !== "local" && t.askAdmin) c.append(btn("Pedir ao admin", "btn-primary", () => { void agir(() => deps.api.financePedir(), "pedido enviado ao admin; assim que ele liberar, esta página abre") }));
      panel.append(c); if (msg) panel.append(el("p", `hint ${msg.bad ? "bad-hint" : ""}`, msg.text)); return;
    }
    const topo = el("div", "admin-actions");
    topo.append(btn(busy ? "Atualizando…" : "Atualizar", "btn-ghost", () => { void refresh(); }), btn("Lançar pelo chat", "btn-ghost", () => { void deps.goToChat("gastei 48 no mercado", "O agente usa o financeiro desta máquina: lança, categoriza e responde. Troque pelo seu gasto de verdade.", "agente"); }));
    panel.append(topo);
    if (msg) panel.append(el("p", `hint ${msg.bad ? "bad-hint" : "audio-ok"}`, msg.text));
    if (info === null) { panel.append(carregando("Consultando o financeiro desta máquina…")); return; }
    if (info.virouModulo) {
      const c = card("O Financeiro agora é o módulo Finanças");
      c.append(el("p", "", "Nesta máquina, os lançamentos, a Curva ABC e as planilhas ficam na página do módulo Finanças. Para voltar a esta página com os mesmos dados, desligue o módulo."));
      if (deps.abrirModulos !== null) { const abrir = deps.abrirModulos; c.append(btn("Abrir Módulos", "btn-primary", () => abrir())); }
      panel.append(c); return;
    }
    if (info.modulo === false || (info.modulo === null && e === null)) {
      const c = card("Ativar o financeiro nesta máquina");
      c.append(el("p", "", "Instala na máquina a ferramenta do agente e o financeiro do WhatsApp. Seus dados ficam só nela."));
      c.append(btn(instalando ? "Instalando…" : "Ativar agora", "btn-primary", () => { instalando = true; instLog = []; void agir(async () => { try { const r = await deps.api.installFinance(); if (!r.ok) throw new Error(r.log.at(-1) ?? "a instalação falhou"); } finally { instalando = false; } }, "financeiro ativado") }));
      if (instLog.length > 0) c.append(el("pre", "admin-logs", instLog.join("\n")));
      panel.append(c);
    }
    if (e === null) { if (info.erro) panel.append(el("p", "hint bad-hint", info.erro)); return; }

    // Abas do módulo: visão geral do mês e o submódulo Curva ABC.
    const abas = el("div", "fin-abas");
    for (const [id, rot] of [["geral", "Visão geral"], ["abc", "Curva ABC"]] as const) {
      const t = el("button", `btn btn-small ${aba === id ? "btn-primary" : "btn-ghost"}`, rot); t.type = "button";
      t.addEventListener("click", () => { if (aba === id) return; aba = id; if (id === "abc" && abc === null && !abcCarregando) void carregarAbc(); else render(); });
      abas.append(t);
    }
    panel.append(abas);
    if (aba === "abc") { renderAbc(); return; }

    // Checklist do mês: só o que depende da pessoa.
    const ck = card(`O que depende de você em ${e.resumo.nome}`);
    const lista = el("ul", "admin-health finance-checklist");
    for (const it of e.checklist) {
      const li = el("li", it.feito ? "ok" : ""); li.append(el("span", "", it.titulo));
      if (it.id === "orcamento") {
        // Quanto gastar no mês: vale para os meses seguintes até mudar (o mês novo já começa com ele).
        const o = e.resumo.orcamento;
        const v = input("ex.: 3.000", "", 20);
        li.append(v, btn(o === null ? "Definir orçamento" : "Mudar", "btn-ghost", () => { if (v.value.trim() === "") return; void agir(() => deps.api.financeMes(e.mes, { orcamento: v.value }), "orçamento do mês salvo"); }));
      }
      if (!it.feito && it.id === "dinheiro") li.append(btn("Nada em dinheiro este mês", "btn-ghost", () => { void agir(() => deps.api.financeMes(e.mes, { dinheiroInformado: true }), "anotado") }), btn("Contar ao agente", "btn-ghost", () => { void deps.goToChat("Este mês gastei em dinheiro: ", "Complete com os gastos em dinheiro vivo (ex.: 20 na feira, 15 no estacionamento); o agente lança cada um.", "agente"); }));
      if (!it.feito && it.id === "fechar") li.append(btn(`Fechar ${e.mesAnterior.slice(5, 7)}/${e.mesAnterior.slice(0, 4)}`, "btn-ghost", () => { void agir(() => deps.api.financeFecharMes(e.mesAnterior), "mês fechado") }));
      lista.append(li);
    }
    ck.append(lista);

    // Pendências.
    let pendCard: HTMLElement | null = null;
    if (pendentes.length > 0) {
      const extra = btn("Confirmar todas", "btn-ghost", () => { void agir(() => deps.api.financeConfirmarTodas(), "pendências confirmadas"); });
      const pc = card(`Para confirmar (${pendentes.length})`, extra);
      pc.append(el("p", "hint", "O agente lançou e ficou na dúvida (categoria, valor de foto ou possível repetição). Confira a categoria e confirme: ele aprende e da próxima vez já acerta."));
      for (const l of pendentes) pc.append(linhaLanc(l, true));
      pendCard = pc;
    }

    // Mês atual.
    const r = e.resumo;
    const mc = card(`Mês atual · ${r.nome}`);
    const nums = el("div", "finance-nums");
    // Investimento com retorno: o que se gastou, o teto do mês, o que voltou (direto + indireto) e o ROI.
    const roiTxt = (v: number | null): string => (v === null ? "—" : `${v > 0 ? "+" : ""}${v}%`);
    const orcTile = r.orcamento ?? null;
    const tiles: [string, string, string, string][] = [
      ["Gastos (investido)", r.gastos, "gasto", orcTile ? `${orcTile.usadoPct}% do orçamento` : ""],
      ["Orçamento do mês", orcTile ? orcTile.valor : "—", "", orcTile ? (orcTile.restanteCent >= 0 ? `restam ${orcTile.restante}` : `passou ${fmt(-orcTile.restanteCent)}`) : "defina no checklist"],
      ["Ganhos", r.ganhos ?? "R$ 0,00", "renda", `diretos ${r.ganhoDireto ?? "R$ 0,00"} · indiretos ${r.ganhoIndireto ?? "R$ 0,00"}`],
      // Projetado até o fim do mês (investimento = orçamento; ganhos no ritmo de hoje); embaixo, o de hoje para comparar.
      ...(r.projecao ? [["ROI do mês projetado", roiTxt(r.projecao.roiTotal), (r.projecao.roiTotal ?? 0) < 0 ? "gasto" : "renda", `hoje ${roiTxt(r.roiTotal ?? null)} · projetado só diretos ${roiTxt(r.projecao.roiDireto)} · ${r.projecao.base === "real" ? "mês encerrado: é o real" : `até o dia ${r.projecao.diasMes}: investimento ${r.projecao.gastos}${r.projecao.base === "orcamento" ? " (o orçamento)" : " (no ritmo de hoje)"}, ganhos ${r.projecao.ganhos} no ritmo de hoje`}`] as [string, string, string, string]] : [["ROI do mês", roiTxt(r.roiTotal ?? null), (r.roiTotal ?? 0) < 0 ? "gasto" : "renda", `só diretos ${roiTxt(r.roiDireto ?? null)}`] as [string, string, string, string]]),
    ];
    // O ROI projetado é o número da página: vem primeiro e em destaque.
    const ordem = [...tiles.filter((t) => t[0].includes("projetado")), ...tiles.filter((t) => !t[0].includes("projetado"))];
    for (const [rot, v, cls, sub] of ordem) { const b = el("div", `finance-num${rot.includes("projetado") ? " destaque" : ""}`); b.append(el("span", "hint", rot), el("strong", `finance-valor ${cls}`, v)); if (sub) b.append(el("span", "hint finance-sub", sub)); nums.append(b); }
    mc.append(nums);
    const o = r.orcamento ?? null; // backend antigo não manda o orçamento
    if (o !== null) {
      const linha = el("div", "finance-orcamento");
      const bar = el("div", `finance-bar${o.usadoPct >= 100 ? " estourou" : o.usadoPct >= 80 ? " alerta" : ""}`); const fill = el("span", "finance-bar-fill"); fill.style.width = `${Math.min(100, o.usadoPct)}%`; bar.append(fill);
      linha.append(el("span", "", `Orçamento ${o.valor} · ${o.usadoPct}% usado · ${o.restanteCent >= 0 ? `restam ${o.restante}` : `passou ${fmt(-o.restanteCent)}`}`), bar);
      mc.append(linha);
    } else mc.append(el("p", "hint", "Sem orçamento ainda: diga quanto quer gastar no mês (no checklist) e o agente acompanha e avisa antes de estourar."));
    const ac = e.acumulado;
    if (ac !== undefined && (ac.gastosCent > 0 || ac.ganhosCent > 0)) mc.append(el("p", "hint finance-acumulado", `Desde o início: investido ${ac.gastos} · ganhos ${ac.ganhos} · ROI ${roiTxt(ac.roiTotal)} (só diretos ${roiTxt(ac.roiDireto)})`));
    mc.append(el("span", "hint", "Onde o dinheiro está indo"));
    const gastosCat = r.porCategoria.filter((c) => c.cent < 0);
    const maior = Math.max(1, ...gastosCat.map((c) => -c.cent));
    if (gastosCat.length === 0) mc.append(el("p", "hint", "Nenhum gasto lançado ainda este mês. Conte um ao agente: \"gastei 48 no mercado\"."));
    for (const c of gastosCat) {
      const linha = el("div", "finance-bar-row");
      const bar = el("div", "finance-bar"); const fill = el("span", "finance-bar-fill"); fill.style.width = `${Math.round((-c.cent / maior) * 100)}%`; bar.append(fill);
      linha.append(el("span", "finance-bar-nome", c.nome), bar, el("span", "finance-bar-valor", fmt(-c.cent)));
      mc.append(linha);
    }

    // Contas.
    const total = e.contas.reduce((n, c) => n + c.saldoExibCent, 0);
    const cc = dobra("contas", "Contas do Agente", e.contas.length === 0 ? "nenhuma ainda" : `${e.contas.length} · saldo ${fmt(total)}`);
    if (e.contas.length === 0) cc.append(el("p", "hint", "Nenhuma conta ainda. Crie as que você usa (banco, cartão, dinheiro vivo): o agente lança em cada uma pelo jeito de pagar."));
    for (const c of e.contas) { const row = el("div", "finance-row"); const m = el("div", "finance-row-main"); m.append(el("strong", "finance-fav", c.nome), el("span", "hint finance-meta", `${TIPOS.find(([k]) => k === c.tipo)?.[1] ?? c.tipo} · ${c.moeda}${c.padrao ? " · padrão" : ""}`)); const vc = el("span", `finance-valor ${c.saldoExibCent < 0 ? "gasto" : "renda"}`, c.saldoExib); if (c.moeda !== moedaExib()) vc.title = `na moeda da conta: ${c.saldo}`; row.append(m, vc); cc.append(row); }
    const nova = el("div", "admin-actions");
    const nome = input("Nubank, Itaú, Carteira…"); const tipo = el("select"); tipo.disabled = busy; for (const [k, t] of TIPOS) { const o = el("option", "", t); o.value = k; tipo.append(o); }
    const moedaSel = el("select"); moedaSel.disabled = busy; for (const mo of (cfg?.moedas ?? ["BRL", "PYG", "USD"])) { const o = el("option", "", `${mo} · ${infoMoeda(mo).simbolo}`); o.value = mo; if (mo === "BRL") o.selected = true; moedaSel.append(o); }
    const saldo = input("saldo hoje (opcional)", "", 20);
    nova.append(field("Nova conta", nome), field("Tipo", tipo), field("Moeda", moedaSel), field("Saldo", saldo), btn("Criar conta", "btn-ghost", () => { if (nome.value.trim() === "") return; void agir(() => deps.api.financeContaCriar({ nome: nome.value, tipo: tipo.value as never, moeda: moedaSel.value as FinanceMoeda, ...(saldo.value.trim() !== "" ? { saldoInicial: saldo.value } : {}) }), "conta criada"); }));
    cc.append(nova);

    // Moeda do sistema: em qual moeda você vê tudo (US$ na LV) e as taxas que convertem (unidades por 1 US$).
    const naoUsd = (cfg?.moedas ?? ["BRL", "PYG", "USD"]).filter((x) => x !== "USD");
    const moedaCard = dobra("moeda", "Moeda & taxas", `vê em ${moedaExib()}${naoUsd.length > 0 ? ` · ${naoUsd.map((x) => `1 US$ = ${(cfg?.taxas?.[x] ?? 0).toLocaleString("pt-BR")} ${x}`).join(" · ")}` : ""}`);
    moedaCard.append(el("p", "hint", "O financeiro aceita gasto em real, guaraní ou dólar; aqui você escolhe em qual moeda ver tudo. A conversão usa as taxas abaixo, que você define — nada é buscado na internet."));
    const moedaForm = el("div", "admin-actions");
    const exibSel = el("select"); exibSel.disabled = busy; for (const mo of (cfg?.moedas ?? ["BRL", "PYG", "USD"])) { const o = el("option", "", `${mo} · ${infoMoeda(mo).simbolo}`); o.value = mo; if (mo === moedaExib()) o.selected = true; exibSel.append(o); }
    const taxaInputs: Partial<Record<FinanceMoeda, HTMLInputElement>> = {};
    const campos: HTMLElement[] = [field("Ver em", exibSel)];
    for (const mo of naoUsd) { const ti = input(`${mo} por 1 US$`, cfg?.taxas?.[mo] ? String(cfg.taxas[mo]) : "", 15); taxaInputs[mo] = ti; campos.push(field(`1 US$ = ? ${mo}`, ti)); }
    moedaForm.append(...campos, btn("Salvar moeda", "btn-ghost", () => { const taxas: Record<string, number> = {}; for (const [mo, ti] of Object.entries(taxaInputs)) { const v = Number(String(ti?.value ?? "").replace(/\./g, "").replace(",", ".")); if (Number.isFinite(v) && v > 0) taxas[mo] = v; } void agir(() => deps.api.financeConfig({ moedaExibicao: exibSel.value as FinanceMoeda, taxas }), "moeda atualizada"); }));
    moedaCard.append(moedaForm);

    // Lançar à mão.
    const lc = dobra("lancar", "Lançar à mão", "o agente lança pelo WhatsApp e pelo chat");
    const f = el("div", "admin-actions");
    const valor = input("48,90", "", 20); const fav = input("onde / de quem"); const tipoL = el("select"); tipoL.disabled = busy;
    for (const [k, t] of [["gasto", "Gasto (investimento)"], ["direto", "Ganho direto"], ["indireto", "Ganho indireto"]] as const) { const o = el("option", "", t); o.value = k; tipoL.append(o); }
    let cat = selectCategoria("mercado", false);
    tipoL.addEventListener("change", () => { const ganho = tipoL.value !== "gasto"; const novo = selectCategoria(tipoL.value === "indireto" ? "ganho-indireto" : ganho ? "ganho-direto" : "mercado", ganho); cat.replaceWith(novo); cat = novo; });
    f.append(field("Valor", valor), field("Tipo", tipoL), field("Onde", fav), field("Categoria", cat), btn("Lançar", "btn-primary", () => { if (valor.value.trim() === "") return; void agir(() => deps.api.financeLancar({ valor: valor.value, favorecido: fav.value, tipo: tipoL.value === "gasto" ? "gasto" : "renda", ...(tipoL.value === "indireto" ? { retorno: "indireto" as const } : tipoL.value === "direto" ? { retorno: "direto" as const } : {}), categoria: cat.value }), "lançado"); }));
    lc.append(f);

    // DRE do mês: as fontes de ganho e os custos que certamente existem, com previsto (recorrente) e realizado.
    const dre = r.dre ?? { linhas: [] as FinanceLinhaDre[], aDefinir: [] as string[], custoPrevistoCent: 0, ganhoDiretoPrevistoCent: 0, ganhoIndiretoPrevistoCent: 0, resultadoPrevistoCent: 0, resultadoPrevisto: "R$ 0,00" };
    const dreCard = dobra("dre", `DRE do mês · ${r.nome}`, `resultado previsto ${dre.resultadoPrevisto}${dre.aDefinir.length > 0 ? ` · ${dre.aDefinir.length} a definir` : ""}`, true);
    dreCard.append(el("p", "hint", "Previsto vale todo mês até você mudar. Custo evitado (uma ferramenta que você deixaria de contratar) conta como ganho indireto. Ligue um lançamento a uma linha no detalhe dele para ter o realizado."));
    const GRUPOS: [FinanceTipoLinha, string][] = [["ganho-direto", "Ganhos diretos (receita que entra)"], ["ganho-indireto", "Ganhos indiretos (custo evitado, tempo poupado)"], ["custo", "Custos (o que o agente custa)"]];
    const tabela = el("div", "finance-dre");
    const cab = el("div", "finance-dre-row cab"); cab.append(el("span", "", ""), el("span", "hint", "Previsto/mês"), el("span", "hint", "Realizado")); tabela.append(cab);
    for (const [tipo, titulo] of GRUPOS) {
      const ls = dre.linhas.filter((x) => x.tipo === tipo);
      tabela.append(el("div", "finance-dre-grupo", titulo));
      if (ls.length === 0) tabela.append(el("div", "finance-dre-vazio hint", tipo === "ganho-direto" ? "nenhuma fonte de receita ainda (ex.: vendas pelo WhatsApp, clientes atendidos pelo agente)" : tipo === "ganho-indireto" ? "nada ainda (ex.: ferramenta que você não precisa contratar, horas de atendimento poupadas)" : "nenhum custo previsto"));
      for (const ln of ls) {
        const row = el("div", `finance-dre-row${linhaAberta === ln.key ? " aberto" : ""}`);
        const nm = el("span", "finance-clicavel finance-dre-nome", ln.nome); nm.tabIndex = 0; nm.setAttribute("role", "button"); nm.title = "Editar a linha";
        const abrir = (): void => { linhaAberta = linhaAberta === ln.key ? null : ln.key; render(); };
        nm.addEventListener("click", abrir); nm.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrir(); } });
        row.append(nm, el("span", `finance-dre-num${ln.previstoCent === null ? " a-definir" : ""}`, ln.previsto), el("span", "finance-dre-num", ln.realizado));
        tabela.append(row);
        if (ln.notas && linhaAberta !== ln.key) tabela.append(el("div", "finance-dre-nota hint", ln.notas));
        if (linhaAberta === ln.key) {
          const ed = el("div", "admin-actions finance-dre-edicao");
          const vn = input("nome", ln.nome); const vv = input("a definir", ln.previstoCent === null ? "" : centParaInput(ln.previstoCent, moedaExib()), 20); const vt = el("textarea"); vt.rows = 3; vt.value = ln.notas ?? ""; vt.placeholder = "anotações: por que essa linha existe, de onde vem o valor"; vt.className = "finance-dre-notas";
          ed.append(field("Nome", vn), field("Previsto por mês", vv), field("Anotações", vt), btn("Salvar", "btn-primary", () => { linhaAberta = null; void agir(() => deps.api.financeLinhaSalvar({ key: ln.key, nome: vn.value, tipo: ln.tipo, valor: vv.value.trim() === "" ? null : vv.value, notas: vt.value }), "linha salva"); }));
          const rm = btn("Remover", "btn-ghost", () => { deps.armConfirm(rm, "Confirmar? tira a linha da DRE", () => { linhaAberta = null; void agir(() => deps.api.financeLinhaRemover(ln.key), "linha removida"); }); });
          ed.append(rm, btn("Fechar", "btn-ghost", () => { linhaAberta = null; render(); }));
          tabela.append(ed);
        }
      }
    }
    const tot = el("div", "finance-dre-row total"); tot.append(el("strong", "", "= Resultado previsto do mês"), el("strong", `finance-dre-num finance-valor ${dre.resultadoPrevistoCent < 0 ? "gasto" : "renda"}`, dre.resultadoPrevisto), el("span", "", "")); tabela.append(tot);
    dreCard.append(tabela);
    if (dre.aDefinir.length > 0) dreCard.append(el("p", "hint", `A definir: ${dre.aDefinir.join(", ")}. A linha já entra na DRE; o valor conta quando você preencher.`));
    const novaLinha = el("div", "admin-actions");
    const nNome = input("ex.: Leona que não precisa contratar"); const nTipo = el("select"); nTipo.disabled = busy;
    for (const [k, t] of [["ganho-indireto", "Ganho indireto"], ["ganho-direto", "Ganho direto"], ["custo", "Custo"]] as const) { const o = el("option", "", t); o.value = k; nTipo.append(o); }
    const nValor = input("a definir", "", 20);
    novaLinha.append(field("Nova linha", nNome), field("Tipo", nTipo), field("Previsto por mês", nValor), btn("Adicionar", "btn-ghost", () => { if (nNome.value.trim() === "") return; void agir(() => deps.api.financeLinhaSalvar({ nome: nNome.value, tipo: nTipo.value as FinanceTipoLinha, valor: nValor.value.trim() === "" ? null : nValor.value }), "linha adicionada"); }));
    dreCard.append(novaLinha);

    // Últimos lançamentos.
    const uc = card("Últimos lançamentos");
    if (ultimos.length === 0) uc.append(el("p", "hint", "Nada lançado ainda."));
    for (const l of ultimos) uc.append(linhaLanc(l, false));
    // Ordem: o mês e o que o agente lançou primeiro; depois o que depende da pessoa; contas e lançar à mão no fim.
    panel.append(mc, dreCard, uc, ck, ...(pendCard ? [pendCard] : []), cc, moedaCard, lc);
  }

  /** Submódulo Curva ABC: filtros (compras/vendas, por quem ou por categoria, período), resumo das classes e a tabela. */
  function renderAbc(): void {
    const impCard = cardImportar();
    const filtros = el("div", "admin-actions");
    const sel = <T extends string>(opts: [T, string][], atual: T, set: (v: T) => void): HTMLSelectElement => {
      const s = el("select"); for (const [v, r] of opts) { const o = el("option", "", r); o.value = v; o.selected = v === atual; s.append(o); }
      s.disabled = abcCarregando; s.addEventListener("change", () => { set(s.value as T); void carregarAbc(); }); return s;
    };
    filtros.append(
      field("O quê", sel<FinanceAbcLado>([["compra", "Compras (saídas)"], ["venda", "Vendas (entradas)"]], abcF.lado, (v) => { abcF.lado = v; })),
      field("Agrupar por", sel<FinanceAbcPor>([["produto", "Produto"], ["favorecido", abcF.lado === "venda" ? "Cliente" : "Fornecedor"], ["categoria", "Categoria"]], abcF.por, (v) => { abcF.por = v; })),
      field("Período", sel<string>([["1", "Este mês"], ["3", "Últimos 3 meses"], ["6", "Últimos 6 meses"], ["12", "Últimos 12 meses"]], String(abcF.meses), (v) => { abcF.meses = Number(v); })),
      btn(abcCarregando ? "Calculando…" : "Recalcular", "btn-ghost", () => { void carregarAbc(); }),
    );
    const c = card("Curva ABC"); c.append(filtros);
    c.append(el("p", "hint", "Classe A: os poucos itens que somam até 80% do valor. B: até 95%. C: o resto (muitos itens, pouco valor)."));
    if (abcErro !== null) { c.append(el("p", "hint bad-hint", abcErro)); panel.append(c, impCard); return; }
    if (abc === null) { c.append(abcCarregando ? carregando("Calculando a Curva ABC…") : el("p", "hint", "Escolha os filtros.")); panel.append(c, impCard); return; }
    const quem = abc.por === "produto" ? "produtos" : abc.por === "categoria" ? "categorias" : abc.lado === "venda" ? "clientes" : "fornecedores";
    const periodo = abc.de === abc.ate ? `${abc.ate.slice(5)}/${abc.ate.slice(0, 4)}` : `${abc.de.slice(5)}/${abc.de.slice(0, 4)} a ${abc.ate.slice(5)}/${abc.ate.slice(0, 4)}`;
    const sem = abc.semProduto && abc.semProduto.lancamentos > 0 ? el("p", "hint bad-hint", `${abc.semProduto.lancamentos} ${abc.lado === "venda" ? "venda(s)" : "compra(s)"} sem produto informado (${abc.semProduto.valor}) ficaram fora desta curva: na planilha, preencha a coluna Produto.`) : null;
    if (abc.itens.length === 0) { c.append(el("p", "hint", abc.por === "produto" ? `Nenhuma ${abc.lado === "venda" ? "venda" : "compra"} com produto em ${periodo}. Importe a planilha do Junior com as colunas Produto e Quantidade.` : `Nenhuma ${abc.lado === "venda" ? "venda" : "compra"} lançada em ${periodo}.`)); if (sem) c.append(sem); panel.append(c, impCard); return; }
    const A = abc.classes.A;
    c.append(el("p", "", `${abc.lado === "venda" ? "Vendas" : "Compras"} de ${periodo}: ${abc.total} em ${abc.itens.length} ${quem}. ${A.itens} ${A.itens === 1 ? "concentra" : "concentram"} ${A.pct.toLocaleString("pt-BR")}% do valor (classe A).`));
    const resumo = el("div", "fin-abc-classes");
    for (const k of ["A", "B", "C"] as const) { const x = abc.classes[k]; const b = el("div", `fin-abc-classe fin-abc-${k}`); b.append(el("strong", "", `Classe ${k}`), el("span", "", `${x.itens} ${x.itens === 1 ? "item" : "itens"} · ${x.valor} · ${x.pct.toLocaleString("pt-BR")}%`)); resumo.append(b); }
    c.append(resumo); if (sem) c.append(sem);
    const wrap = el("div", "fin-abc-wrap"); const t = el("table", "fin-abc");
    const th = el("tr"); const comUn = abc.por === "produto"; for (const h of ["#", abc.por === "produto" ? "Produto" : abc.por === "categoria" ? "Categoria" : abc.lado === "venda" ? "Cliente" : "Fornecedor", "Valor", "%", "Acumulado", ...(comUn ? ["Peças"] : []), "Lançam.", "Classe"]) th.append(el("th", "", h));
    t.append(th);
    for (const i of abc.itens) {
      const tr = el("tr", `fin-abc-${i.classe}`);
      tr.append(el("td", "", String(i.pos)), el("td", "", i.nome), el("td", "num", i.valor), el("td", "num", `${i.pct.toLocaleString("pt-BR")}%`), el("td", "num", `${i.acumPct.toLocaleString("pt-BR")}%`), ...(comUn ? [el("td", "num", i.unidades > 0 ? i.unidades.toLocaleString("pt-BR") : "—")] : []), el("td", "num", String(i.qtd)), el("td", "fin-abc-tag", i.classe));
      t.append(tr);
    }
    wrap.append(t); c.append(wrap); panel.append(c, impCard);
  }

  const page = deps.definePage("financas", "Finanças", panel, () => { render(); void refresh(); });
  return { open: () => deps.openPage(page), refresh, info: () => info };
}
