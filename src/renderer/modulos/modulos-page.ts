/**
 * Página "Módulos": o produto fixo do app (caps.modulos, como no meu-bot-diego-staging) e os add-ons com módulos na
 * licença da máquina. Duas vistas:
 * - a lista: o bloco "Já incluído" (o que é do próprio meu-bot, hoje o CRM: um cartão com instalar, abrir e configurar,
 *   que não é um módulo) e um bloco por produto, com de onde os módulos vieram (o repositório dele, baixado com git) e um cartão por módulo;
 * - a ficha de um módulo: cabeçalho com o estado e "Testar conexão", "O que dá para pedir" (vai ao chat), as abas
 *   Visão geral (configurar, ligar, conexão e o guia em resumo), Ferramentas (do último teste), Guia e Primeiros
 *   passos, e a coluna Detalhes.
 * Tudo o que a ficha mostra vem do modulos.json do repositório (modulos-core.ts): é texto puro, desenhado com `el`,
 * nunca HTML. O estado mora na máquina (main › modulos/modulos.ts); aqui só se mostra e se pede.
 */
import type { MeuBotApi, ModuloPasso, ModuloVista, ModulosLista } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { carregando } from "../lib/carregando.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { CAMINHO_MARKETPLACE } from "../lib/pro.js";
import { passoFeito, situacao, tempoDesde } from "./modulos-ficha.js";
import { cartaoCrm, type CrmCartaoEstado } from "./modulos-crm.js";

export interface ModulosPageDeps {
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  armConfirm(btn: HTMLButtonElement, label: string, run: () => void): void;
  api: Pick<MeuBotApi, "modulosAbrirPagina" | "modulosPlanilha" | "modulosAtualizarFonte" | "modulosListar" | "modulosLigar" | "modulosDesligar" | "modulosTestar" | "modulosCredenciais" | "modulosOpcoes" | "openExternal" | "contaAbrirConsole" | "on">;
  /** Leva uma pergunta pronta ao chat do agente (o mesmo caminho dos tutoriais). */
  goToChat(message: string, hint: string): Promise<void>;
  /** Máquina desta janela (as marcações dos primeiros passos são por máquina); lida na hora, não na montagem. */
  host(): string;
  /**
   * O CRM do meu-bot, para o cartão do bloco "Já incluído": o estado é o do guia do CRM (crm-guia.ts), montado no
   * renderer; instalar, abrir e configurar são os mesmos caminhos do guia. null = app sem máquina para instalar.
   */
  /**
   * Há produto de módulos nesta máquina (o fixo do app ou um add-on em vigor)? Sem nenhum, a página é só o "Já incluído":
   * não consulta os módulos (o main responde com erro quando a máquina não tem produto) nem oferece atualizá-los.
   */
  temProdutos(): boolean;
  crm: { estado(): CrmCartaoEstado; atualizar(): Promise<void>; instalar(): Promise<void>; abrirNoGmail(): void; configurar(): void } | null;
}

type Aba = "geral" | "ferramentas" | "guia" | "passos";
const MSG_LICENCA = (rotulo: string): string => `Os módulos ainda não estão liberados nesta máquina. Se você ainda não contratou o "${rotulo}", ele está no Marketplace do site; se já contratou, peça ao admin para incluir o add-on na licença dela (no meu-bot-admin, Suporte › Conta e licença).`;

export function mountModulosPage(deps: ModulosPageDeps): { open: () => void; repintarLista: () => void; pedirPlanilha: (a: { id: string; rotulo: string; link: string; aba: string; tipo: string }) => void } {
  const panel = el("section", "acervo-panel modulos-panel"); panel.hidden = true;
  deps.panelsEl.append(panel);
  let page: PageTab | null = null;
  /** Uma lista por produto de módulos da máquina; null = ainda não lida. */
  let listas: ModulosLista[] | null = null;
  let erro: string | null = null;
  let lendo = false;
  let baixando = false;
  /** Ficha aberta (id do módulo) e a aba dela; null = a lista. */
  let aberto: string | null = null;
  let aba: Aba = "geral";
  /** Módulo com ação em andamento (só um por vez) e o que cada um disse por último. */
  let ocupado: string | null = null;
  const logs = new Map<string, { linhas: string[]; ruim: boolean }>();
  const rascunhoCred = new Map<string, Record<string, string>>();
  const rascunhoOpc = new Map<string, Record<string, string | number | boolean>>();

  deps.api.on("modulos:progress", ({ id, line }) => {
    const l = logs.get(id) ?? { linhas: [], ruim: false };
    logs.set(id, { linhas: [...l.linhas, line].slice(-8), ruim: false });
    if (!panel.hidden) render();
  });

  /* ---------- marcações à mão dos primeiros passos (por máquina, neste Mac) ---------- */
  /** A lista (o produto) de um módulo: os ids não se repetem entre produtos (o main ignora o repetido). */
  const listaDo = (id: string): ModulosLista | undefined => listas?.find((l) => l.modulos.some((x) => x.id === id));
  const chaveMarcas = (m: ModuloVista): string => `modulos:passos:${listaDo(m.id)?.produto ?? ""}:${deps.host()}:${m.id}`;
  const marcas = (m: ModuloVista): string[] => { try { const v = JSON.parse(localStorage.getItem(chaveMarcas(m)) ?? "[]") as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };
  const marcar = (m: ModuloVista, passo: string, feito: boolean): void => {
    const s = new Set(marcas(m)); if (feito) s.add(passo); else s.delete(passo);
    try { localStorage.setItem(chaveMarcas(m), JSON.stringify([...s])); } catch { /* opcional */ }
  };

  /* ---------- dados ---------- */
  async function ler(): Promise<void> {
    lendo = true; erro = null; render();
    try { listas = await deps.api.modulosListar(); } catch (e) { erro = ipcErrorText(e); }
    lendo = false; render();
  }
  /** Confere o repositório de cada produto (clone na primeira vez, pull depois) e relê a máquina. */
  async function atualizar(): Promise<void> {
    if (baixando) return;
    void deps.crm?.atualizar().then(repintarLista, repintarLista);
    if (!deps.temProdutos()) { listas = null; erro = null; render(); return; }
    baixando = true; erro = null; render();
    try { listas = await deps.api.modulosAtualizarFonte(); } catch (e) { erro = ipcErrorText(e); }
    baixando = false; render();
  }
  async function acao(id: string, rodar: () => Promise<{ ok: boolean; log: string[] }>): Promise<void> {
    ocupado = id; logs.set(id, { linhas: [], ruim: false }); render();
    try {
      const r = await rodar();
      const antes = logs.get(id)?.linhas ?? [];
      logs.set(id, { linhas: [...antes, ...r.log.filter((l) => !antes.includes(l))].slice(-8), ruim: !r.ok });
    } catch (e) { logs.set(id, { linhas: [ipcErrorText(e)], ruim: true }); }
    ocupado = null;
    await ler();
  }
  async function testar(m: ModuloVista): Promise<void> {
    await acao(m.id, async () => { const t = await deps.api.modulosTestar(m.id); return { ok: t.ok, log: [t.ok ? `✓ conexão ok · ${t.ferramentas.length} ferramenta(s)` : `✗ ${t.erro ?? "o teste falhou"}`] }; });
  }

  /* ---------- página própria do módulo (uma aba por módulo, com o <webview> do serviço dele) ---------- */
  const paginas = new Map<string, { page: PageTab; caixa: HTMLElement; aviso: HTMLElement }>();
  async function abrirPagina(m: ModuloVista): Promise<void> {
    if (m.pagina === null) return;
    let p = paginas.get(m.id);
    if (p === undefined) {
      const painel = el("section", "acervo-panel modulo-pagina-panel"); painel.hidden = true;
      const aviso = el("div", "modulo-pagina-aviso"); const caixa = el("div", "modulo-pagina-tela");
      painel.append(aviso, caixa); deps.panelsEl.append(painel);
      p = { page: deps.definePage(`modulo-${m.id}`, m.pagina.rotulo, painel, () => { /* o <webview> se desenha sozinho */ }), caixa, aviso };
      paginas.set(m.id, p);
    }
    const { page: aba, caixa, aviso } = p;
    deps.openPage(aba);
    aviso.replaceChildren(carregando(`Abrindo ${m.pagina.rotulo}…`)); caixa.replaceChildren();
    try {
      const r = await deps.api.modulosAbrirPagina(m.id);
      // Sem preload, com sandbox e só a origem do forward: o main confere tudo de novo ao anexar (windows.ts).
      const v = document.createElement("webview");
      v.setAttribute("partition", r.particao);
      v.setAttribute("webpreferences", "contextIsolation=yes,sandbox=yes,nodeIntegration=no");
      v.className = "computador-webview";
      v.setAttribute("src", r.url);
      v.addEventListener("did-fail-load", (ev) => {
        const e = ev as Event & { errorCode?: number; isMainFrame?: boolean };
        if (e.isMainFrame === false || e.errorCode === -3) return;
        aviso.replaceChildren(el("p", "hint bad-hint", `A página de ${m.rotulo} não carregou. Volte em Módulos e abra de novo.`));
      });
      aviso.replaceChildren(); caixa.replaceChildren(v);
    } catch (e) { aviso.replaceChildren(el("p", "hint bad-hint", ipcErrorText(e))); }
  }

  /**
   * A página de um módulo pediu para ler uma planilha do Google: cartão acima da página, e nada é lido sem a pessoa
   * clicar. Prévia primeiro (o módulo diz o que entraria); importar é outro clique.
   */
  function pedirPlanilha(a: { id: string; rotulo: string; link: string; aba: string; tipo: string }): void {
    const p = paginas.get(a.id);
    if (p === undefined) return;
    deps.openPage(p.page);
    const caixa = el("div", "admin-card modulo-pedido");
    const linha = (texto: string, cls = "hint"): HTMLElement => el("p", cls, texto);
    const botao = (rotulo: string, cls: string, run: () => void): HTMLButtonElement => { const b = el("button", `btn ${cls} btn-small`, rotulo); b.type = "button"; b.addEventListener("click", run); return b; };
    const fechar = (): void => { caixa.remove(); };
    const pedir = async (simular: boolean): Promise<void> => {
      caixa.replaceChildren(el("strong", "", `Planilha para ${a.rotulo}`), carregando(simular ? "Lendo a planilha com a sua Conta Google…" : "Importando…"));
      try {
        const r = await deps.api.modulosPlanilha(a.id, { link: a.link, aba: a.aba, tipo: a.tipo, simular });
        caixa.replaceChildren(el("strong", "", simular ? `Prévia da planilha para ${a.rotulo}` : `Planilha importada em ${a.rotulo}`), linha(r.mensagem, simular ? "hint" : "hint audio-ok"));
        if (r.linhas.length > 0) { const ul = el("ul", "admin-health"); for (const x of r.linhas) ul.append(el("li", "", x)); caixa.append(ul); }
        const acoes = el("div", "admin-actions");
        if (simular && r.podeImportar) acoes.append(botao("Importar", "btn-primary", () => { void pedir(false); }));
        acoes.append(botao(simular ? "Cancelar" : "Fechar", "btn-ghost", fechar));
        caixa.append(acoes);
      } catch (e) {
        caixa.replaceChildren(el("strong", "", `Planilha para ${a.rotulo}`), linha(ipcErrorText(e), "hint bad-hint"));
        caixa.append(botao("Fechar", "btn-ghost", fechar));
      }
    };
    caixa.append(el("strong", "", `${a.rotulo} quer ler uma planilha do Google`), linha(`Com a sua Conta Google, o meu-bot lê a planilha ${a.link}${a.aba ? ` (aba ${a.aba})` : ""} e entrega o conteúdo só a este módulo. Nada é lido sem o seu clique.`));
    const acoes = el("div", "admin-actions");
    acoes.append(botao("Ler e ver a prévia", "btn-primary", () => { void pedir(true); }), botao("Cancelar", "btn-ghost", fechar));
    caixa.append(acoes);
    p.aviso.querySelectorAll(".modulo-pedido").forEach((x) => x.remove());
    p.aviso.append(caixa);
  }

  /* ---------- peças ---------- */
  const btn = (label: string, cls: string, run: () => void, desligado = false): HTMLButtonElement => { const b = el("button", `btn ${cls} btn-small`, label); b.type = "button"; b.disabled = desligado || ocupado !== null; b.addEventListener("click", run); return b; };
  const field = (label: string, ctl: HTMLElement, ajuda: string): HTMLElement => { const w = el("label", "admin-field"); w.append(el("span", "hint", label), ctl); if (ajuda) w.append(el("span", "hint modulo-ajuda", ajuda)); return w; };
  const avatar = (m: ModuloVista): HTMLElement => el("span", "modulo-avatar", (m.rotulo.trim()[0] ?? "?").toUpperCase());
  const selo = (m: ModuloVista): HTMLElement => { const s = situacao(m); return el("span", `pill modulo-selo ${s.classe}`, s.texto); };
  const secao = (titulo: string, ...filhos: HTMLElement[]): HTMLElement => { const s = el("section", "modulo-secao"); s.append(el("h3", "", titulo), ...filhos); return s; };
  const perguntar = (m: ModuloVista, texto: string): void => { void deps.goToChat(texto, `Pergunta do módulo ${m.rotulo}`); };

  function cartaoDaLista(m: ModuloVista): HTMLElement {
    const c = el("button", "modulo-cartao"); c.type = "button";
    const topo = el("div", "modulo-cartao-topo"); topo.append(avatar(m), selo(m));
    c.append(topo, el("strong", "", m.rotulo));
    if (m.categoria) c.append(el("span", "hint", m.categoria));
    if (m.descricao) c.append(el("p", "hint modulo-cartao-desc", m.descricao));
    c.addEventListener("click", () => { aberto = m.id; aba = "geral"; render(); });
    return c;
  }

  /**
   * "Já incluído": o que é do próprio meu-bot e não de um produto de módulos. Hoje só o CRM. O cartão não abre ficha:
   * mostra a situação na máquina e leva a instalar, ao Gmail e ao guia do CRM.
   */
  function blocoIncluido(crm: NonNullable<ModulosPageDeps["crm"]>): HTMLElement {
    const v = cartaoCrm(crm.estado());
    const box = el("div", "auditoria-detalhe modulos-produto");
    box.append(el("h3", "", "Já incluído"), el("p", "hint modulos-origem", "Vem com o meu-bot: sem licença à parte e sem repositório para baixar."));
    const c = el("div", "modulo-cartao modulo-cartao-fixo");
    const topo = el("div", "modulo-cartao-topo"); topo.append(el("span", "modulo-avatar", "C"));
    if (v.selo !== null) topo.append(el("span", `pill modulo-selo ${v.selo.classe}`, v.selo.texto));
    c.append(topo, el("strong", "", "CRM"), el("span", "hint", "Vendas e atendimento"), el("p", "hint modulo-cartao-desc", "Pipelines e caixas dentro do Gmail; o agente anota as conversas do WhatsApp."));
    for (const l of v.linhas) c.append(el("span", "", l));
    if (v.aviso !== null) c.append(el("p", `hint ${v.aviso.ruim ? "bad-hint" : "guide-pair-note"}`, v.aviso.texto));
    if (v.log.length > 0) { const pre = el("pre", "modulo-log hint"); pre.textContent = v.log.join("\n"); c.append(pre); }
    if (v.acoes.length > 0) {
      const a = el("div", "admin-actions");
      for (const x of v.acoes) {
        if (x === "instalar") a.append(btn("Instalar", "btn-primary", () => { void crm.instalar(); }));
        else if (x === "gmail") a.append(btn("Abrir o CRM no Gmail", "btn-primary", () => crm.abrirNoGmail()));
        else a.append(btn("Configurar", "btn-ghost", () => crm.configurar()));
      }
      c.append(a);
    }
    const grade = el("div", "modulo-cartoes"); grade.append(c);
    box.append(grade);
    return box;
  }

  /* ---------- Visão geral ---------- */
  function configuracao(m: ModuloVista, l: ModulosLista): HTMLElement {
    const box = el("div", "modulo-config");
    const gwOk = m.gateways.length === 0 || (l.gateway !== null && m.gateways.includes(l.gateway));
    const avisos: string[] = [...m.requisitos];
    if (!gwOk) avisos.unshift(`Precisa do WhatsApp pelo ${m.gateways.join(" ou ")}; esta máquina usa ${l.gateway ?? "nenhum"}.`);
    if (avisos.length > 0) { const ul = el("ul", "admin-health"); for (const a of avisos) ul.append(el("li", "", a)); box.append(ul); }
    // Chaves: campo de senha; o que já tem valor aparece como "preenchida" (o valor nunca volta da máquina).
    if (m.credenciais.length > 0) {
      const rc = rascunhoCred.get(m.id) ?? {};
      const f = el("div", "admin-actions modulo-campos");
      for (const cr of m.credenciais) {
        const i = el("input"); i.type = "password"; i.autocomplete = "off"; i.maxLength = 4000;
        i.placeholder = m.estado.preenchidas.includes(cr.chave) ? "preenchida ✓ (cole para trocar)" : "cole aqui";
        i.value = rc[cr.chave] ?? ""; i.disabled = ocupado !== null;
        i.addEventListener("input", () => { rascunhoCred.set(m.id, { ...(rascunhoCred.get(m.id) ?? {}), [cr.chave]: i.value }); });
        f.append(field(cr.rotulo, i, cr.ajuda));
      }
      f.append(btn("Salvar chaves", "btn-ghost", () => {
        const patch = Object.fromEntries(Object.entries(rascunhoCred.get(m.id) ?? {}).filter(([, v]) => v.trim() !== ""));
        if (Object.keys(patch).length === 0) return;
        void acao(m.id, async () => { listas = await deps.api.modulosCredenciais(m.id, patch); rascunhoCred.delete(m.id); return { ok: true, log: ["chaves salvas na máquina"] }; });
      }, !l.liberado || l.erroMaquina !== null));
      box.append(f);
    }
    if (m.opcoes.length > 0) {
      const ro = rascunhoOpc.get(m.id) ?? {};
      const f = el("div", "admin-actions modulo-campos");
      for (const o of m.opcoes) {
        const atual = ro[o.chave] ?? m.estado.opcoes[o.chave] ?? o.padrao;
        const set = (v: string | number | boolean): void => { rascunhoOpc.set(m.id, { ...(rascunhoOpc.get(m.id) ?? {}), [o.chave]: v }); };
        const ctl = el("input");
        if (o.tipo === "booleano") { ctl.type = "checkbox"; ctl.checked = atual === true; ctl.addEventListener("change", () => set(ctl.checked)); }
        else { ctl.type = o.tipo === "numero" ? "number" : "text"; ctl.value = String(atual); ctl.maxLength = 2000; ctl.addEventListener("input", () => set(o.tipo === "numero" ? Number(ctl.value) : ctl.value)); }
        ctl.disabled = ocupado !== null;
        f.append(field(o.rotulo, ctl, o.ajuda));
      }
      f.append(btn("Salvar opções", "btn-ghost", () => {
        const patch = rascunhoOpc.get(m.id) ?? {};
        if (Object.keys(patch).length === 0) return;
        void acao(m.id, async () => { const r = await deps.api.modulosOpcoes(m.id, patch); if (r.ok) rascunhoOpc.delete(m.id); return r; });
      }, !l.liberado || l.erroMaquina !== null));
      box.append(f);
    }
    const a = el("div", "admin-actions");
    if (ocupado === m.id) a.append(carregando(m.estado.ligado ? "Trabalhando na máquina…" : "Ligando na máquina…"));
    else if (m.estado.ligado) {
      if (m.desatualizado) a.append(btn("Atualizar", "btn-primary", () => { void acao(m.id, () => deps.api.modulosLigar(m.id)); }, !l.liberado || l.erroMaquina !== null));
      const d = btn("Desligar", "btn-ghost", () => { /* armConfirm abaixo */ }, l.erroMaquina !== null);
      deps.armConfirm(d, "Confirmar desligar?", () => { void acao(m.id, () => deps.api.modulosDesligar(m.id)); });
      a.append(d);
    } else {
      const faltam = m.credenciais.filter((cr) => !m.estado.preenchidas.includes(cr.chave));
      a.append(btn("Ligar", "btn-primary", () => { void acao(m.id, () => deps.api.modulosLigar(m.id)); }, !l.liberado || l.erroMaquina !== null || !gwOk || faltam.length > 0));
      if (faltam.length > 0) a.append(el("span", "hint", `Falta: ${faltam.map((x) => x.rotulo).join(", ")}`));
    }
    box.append(a);
    const lg = logs.get(m.id);
    if (lg !== undefined && lg.linhas.length > 0) { const pre = el("pre", lg.ruim ? "modulo-log bad-hint" : "modulo-log hint"); pre.textContent = lg.linhas.join("\n"); box.append(pre); }
    return box;
  }
  function conexao(m: ModuloVista): HTMLElement {
    const box = el("div", "modulo-caixa");
    const linha = el("div", "modulo-caixa-linha");
    const t = m.teste;
    if (m.testar === null) linha.append(el("span", "hint", "Este módulo não traz teste de conexão."));
    else if (t === null) linha.append(el("span", "modulo-ponto"), el("span", "", "A conexão ainda não foi testada."), el("span", "hint modulo-direita", "Nunca testada"));
    else linha.append(el("span", `modulo-ponto ${t.ok ? "ok" : "bad"}`), el("span", "", t.ok ? `Conexão ok · ${t.ferramentas.length} ferramenta(s)` : `Falhou: ${t.erro ?? "sem motivo"}`), el("span", "hint modulo-direita", `Testada ${tempoDesde(t.em, Date.now())}`));
    box.append(linha);
    return box;
  }
  function guiaResumo(m: ModuloVista): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (m.guia.paraQue) out.push(el("h4", "", "Para que serve"), el("p", "", m.guia.paraQue));
    if (m.guia.cuidados.length > 0) { out.push(el("h4", "", "Cuidados")); const ul = el("ul", "modulo-lista"); for (const c of m.guia.cuidados) ul.append(el("li", "", c)); out.push(ul); }
    return out;
  }
  function linkGuia(m: ModuloVista): HTMLElement | null {
    if (m.guia.completo === null) return null;
    const url = m.guia.completo;
    return btn("Ler guia completo →", "btn-ghost", () => { void deps.api.openExternal(url); });
  }

  /* ---------- abas ---------- */
  function abaGeral(m: ModuloVista, l: ModulosLista): HTMLElement[] {
    const out = [secao(m.estado.ligado ? "Configuração" : "Ligar nesta máquina", configuracao(m, l)), secao("Conexão", conexao(m))];
    const resumo = guiaResumo(m); const link = linkGuia(m);
    if (resumo.length > 0 || link !== null) out.push(secao("Guia", ...resumo, ...(link === null ? [] : [link])));
    return out;
  }
  function abaFerramentas(m: ModuloVista): HTMLElement[] {
    const t = m.teste;
    if (t === null || t.ferramentas.length === 0) return [el("p", "hint", m.testar === null ? "Este módulo não lista as ferramentas." : "Teste a conexão para ver as ferramentas que o agente ganha com este módulo.")];
    const ul = el("ul", "modulo-ferramentas");
    for (const f of t.ferramentas) { const li = el("li"); li.append(el("code", "", f.nome)); if (f.descricao) li.append(el("span", "hint", f.descricao)); ul.append(li); }
    return [el("p", "hint", `${t.ferramentas.length} ferramenta(s), do teste ${tempoDesde(t.em, Date.now())}.`), ul];
  }
  function abaGuia(m: ModuloVista): HTMLElement[] {
    const out = guiaResumo(m);
    for (const p of m.guia.texto) out.push(el("p", "", p));
    const link = linkGuia(m); if (link !== null) out.push(link);
    return out.length > 0 ? out : [el("p", "hint", "Este módulo não traz guia.")];
  }
  function abaPassos(m: ModuloVista): HTMLElement[] {
    const feitas = marcas(m);
    const ol = el("ol", "modulo-passos");
    let anteriorFeito = true;
    m.passos.forEach((p: ModuloPasso, i) => {
      const feito = anteriorFeito && passoFeito(p, m, feitas);
      const li = el("li", `modulo-passo${feito ? " feito" : anteriorFeito ? " atual" : ""}`);
      li.append(el("span", "modulo-passo-n", feito ? "✓" : String(i + 1)));
      const corpo = el("div", "modulo-passo-corpo");
      corpo.append(el("strong", "", p.titulo));
      if (p.texto) corpo.append(el("p", "hint", p.texto));
      const acoes = el("div", "admin-actions");
      if (anteriorFeito && !feito) {
        if (p.pergunta) acoes.append(btn("Perguntar no chat", "btn-ghost", () => perguntar(m, p.pergunta)));
        if (p.conclui === "manual") acoes.append(btn(p.botao, "btn-primary", () => { marcar(m, p.id, true); render(); }));
        else if (p.conclui === "testado" && m.testar !== null && m.estado.ligado) acoes.append(btn("Testar conexão", "btn-primary", () => { void testar(m); }));
        else if (p.conclui !== "manual") acoes.append(el("span", "hint", "Conclui sozinho quando acontecer (veja Visão geral)."));
      }
      if (acoes.childElementCount > 0) corpo.append(acoes);
      li.append(corpo); ol.append(li);
      anteriorFeito = feito;
    });
    const refazer = btn("Refazer as marcações", "btn-ghost", () => { for (const p of m.passos) marcar(m, p.id, false); render(); });
    return [ol, refazer];
  }

  function detalhes(m: ModuloVista, l: ModulosLista): HTMLElement {
    const col = el("aside", "modulo-detalhes");
    const dl = el("dl", "modulo-dl");
    const linha = (k: string, v: string | HTMLElement): void => { dl.append(el("dt", "", k)); const dd = el("dd"); if (typeof v === "string") dd.textContent = v; else dd.append(v); dl.append(dd); };
    linha("Situação", situacao(m).texto);
    if (m.categoria) linha("Categoria", m.categoria);
    linha("Versão", m.estado.ligado && m.estado.versao !== null && m.estado.versao !== m.versao ? `${m.estado.versao} (há ${m.versao})` : m.versao);
    linha("Acesso", m.credenciais.length > 0 ? `Chave guardada na máquina (${m.credenciais.map((c) => c.rotulo).join(", ")})` : "Sem chave no app (o módulo cuida do login)");
    linha("Onde roda", `Agente da máquina ${deps.host()}`);
    const id = el("code", "", m.id); linha("Identificador", id);
    linha("Origem", l.fonte.repositorio);
    const box = el("div", "modulo-caixa"); box.append(dl);
    col.append(el("h3", "", "Detalhes"), box);
    return col;
  }

  function ficha(m: ModuloVista, l: ModulosLista): HTMLElement {
    const f = el("div", "modulo-ficha");
    const voltar = el("button", "btn btn-ghost btn-small modulo-voltar", "← Módulos"); voltar.type = "button";
    voltar.addEventListener("click", () => { aberto = null; render(); });
    const cab = el("header", "modulo-cabecalho");
    const tit = el("div", "modulo-titulo");
    const linhaNome = el("div", "modulo-nome"); linhaNome.append(el("h2", "", m.rotulo), selo(m));
    tit.append(linhaNome);
    if (m.descricao) tit.append(el("p", "hint", m.descricao));
    cab.append(avatar(m), tit);
    if (m.pagina !== null) { const pg = m.pagina; const ab = btn(`Abrir ${pg.rotulo}`, "btn-primary", () => { void abrirPagina(m); }, !m.estado.ligado || l.erroMaquina !== null || !l.liberado); if (!m.estado.ligado) ab.title = "Ligue o módulo para abrir a página dele"; cab.append(ab); }
    if (m.testar !== null) cab.append(btn(ocupado === m.id ? "Testando…" : "↻ Testar conexão", "btn-ghost modulo-testar", () => { void testar(m); }, !m.estado.ligado || l.erroMaquina !== null));
    f.append(voltar, cab);
    if (m.exemplos.length > 0) {
      const ex = el("div", "modulo-exemplos"); ex.append(el("span", "hint", "O que dá para pedir"));
      for (const e of m.exemplos) { const b = btn(e, "btn-ghost modulo-chip", () => perguntar(m, e), !m.estado.ligado); if (!m.estado.ligado) b.title = "Ligue o módulo para o agente conseguir responder"; ex.append(b); }
      f.append(ex);
    }
    const abas: [Aba, string][] = [["geral", "Visão geral"], ["ferramentas", "Ferramentas"], ["guia", "Guia"], ...(m.passos.length > 0 ? [["passos", "Primeiros passos"] as [Aba, string]] : [])];
    if (!abas.some(([a]) => a === aba)) aba = "geral";
    const barra = el("nav", "modulo-abas");
    for (const [a, rot] of abas) { const b = el("button", `modulo-aba${a === aba ? " ativa" : ""}`, rot); b.type = "button"; b.addEventListener("click", () => { aba = a; render(); }); barra.append(b); }
    const grade = el("div", "modulo-grade");
    const principal = el("div", "modulo-principal");
    principal.append(barra, ...(aba === "geral" ? abaGeral(m, l) : aba === "ferramentas" ? abaFerramentas(m) : aba === "guia" ? abaGuia(m) : abaPassos(m)));
    grade.append(principal, detalhes(m, l));
    f.append(grade);
    return f;
  }

  /** O bloco de um produto: de onde vieram os módulos, os avisos (fonte, licença, manifesto) e um cartão por módulo. */
  function blocoDoProduto(l: ModulosLista): HTMLElement {
    const box = el("div", "auditoria-detalhe modulos-produto");
    box.append(el("h3", "", l.rotulo));
    // Origem: de qual repositório os módulos vieram, em que commit e há quanto tempo (o app não leva módulo nenhum dentro).
    box.append(el("p", "hint modulos-origem", l.fonte.linha));
    // Aviso da fonte: sem acesso (o bloco fica só nisso), sem rede ou sem git (com os já baixados embaixo), erro do git.
    const f = l.fonte;
    if (f.mensagem !== "" && f.estado !== "atualizado" && f.estado !== "em-dia") box.append(el("p", `hint ${f.estado === "sem-rede" && f.baixados ? "guide-pair-note" : "bad-hint"}`, f.mensagem));
    if (!f.visiveis) return box;
    if (!l.liberado) box.append(el("p", "hint guide-pair-note", MSG_LICENCA(l.rotulo)));
    for (const a of l.avisos) box.append(el("p", "hint bad-hint", a));
    const grade = el("div", "modulo-cartoes");
    for (const x of l.modulos) grade.append(cartaoDaLista(x));
    box.append(grade);
    return box;
  }

  function render(): void {
    if (page === null) return;
    panel.replaceChildren();
    const l = aberto === null ? undefined : listaDo(aberto);
    const m = l?.modulos.find((x) => x.id === aberto);
    if (m !== undefined && l !== undefined) {
      if (erro !== null) panel.append(el("p", "hint bad-hint", erro));
      if (l.erroMaquina !== null) panel.append(el("p", "hint bad-hint", l.erroMaquina));
      panel.append(ficha(m, l));
      return;
    }
    aberto = null;
    const head = el("div", "guide-head");
    const body = el("div", "tut-body");
    // O selo é só "módulos": a página junta o que já vem no meu-bot e os produtos, e cada bloco leva o seu nome.
    const temProdutos = deps.temProdutos();
    body.append(el("span", "tut-badge", "módulos"), el("h2", "", "Módulos"), el("p", "", temProdutos ? "Cada módulo é uma peça à parte: ligue só o que for usar. As chaves ficam na máquina, só com você." : "O que já vem com o meu-bot nesta máquina."));
    // O que mais dá para contratar fica no console da conta (abre logado, no navegador).
    const mk = el("button", "btn btn-ghost btn-small", "Ver o Marketplace"); mk.type = "button";
    mk.title = "Abre no site o que dá para somar à sua conta: apps, máquinas e Macs a mais";
    // Falha ao abrir (sem navegador padrão, IPC fora): o motivo aparece ao lado do botão, em vez de o clique não fazer nada.
    mk.addEventListener("click", () => { mk.nextElementSibling?.classList.contains("mk-erro") && mk.nextElementSibling.remove(); void deps.api.contaAbrirConsole(CAMINHO_MARKETPLACE).catch((e: unknown) => { mk.after(el("p", "hint bad-hint mk-erro", `Não consegui abrir o Marketplace: ${ipcErrorText(e)}`)); }); });
    head.append(body);
    panel.append(head);
    if (!temProdutos) body.append(mk);
    // Sem produto de módulos nesta máquina: só o que já vem no meu-bot, sem "Atualizar módulos" e sem lista para ler.
    if (!temProdutos) {
      if (deps.crm !== null) panel.append(blocoIncluido(deps.crm));
      else panel.append(el("p", "hint", "Esta máquina não tem módulos."));
      return;
    }
    const b = el("button", "btn btn-ghost btn-small", "Atualizar módulos"); b.type = "button";
    b.disabled = baixando || lendo || ocupado !== null;
    b.title = "Confere o repositório de cada produto de módulos (git pull) e relê o estado na máquina";
    b.addEventListener("click", () => { void atualizar(); });
    body.append(b, document.createTextNode(" "), mk);
    if (baixando) panel.append(carregando("Conferindo os repositórios dos módulos…"));
    if (erro !== null) panel.append(el("p", "hint bad-hint", erro));
    if (deps.crm !== null) panel.append(blocoIncluido(deps.crm));
    if (listas === null) { if (lendo) panel.append(carregando("Lendo os módulos da máquina…")); return; }
    // O SSH é um só para todos os produtos: o erro da máquina aparece uma vez, em cima.
    const erroMaquina = listas.find((x) => x.erroMaquina !== null)?.erroMaquina ?? null;
    if (erroMaquina !== null) panel.append(el("p", "hint bad-hint", erroMaquina));
    for (const x of listas) panel.append(blocoDoProduto(x));
  }
  /** O estado do CRM mudou (consulta, instalação, progresso): repinta a lista se ela está na tela; a ficha não mostra o CRM. */
  function repintarLista(): void {
    // A licença chegou (ou mudou) depois de a página abrir: os produtos que passaram a existir são lidos agora.
    if (page !== null && deps.temProdutos() && listas === null && !lendo && !baixando && erro === null) { void atualizar(); return; }
    if (!panel.hidden && aberto === null) render();
  }

  return {
    pedirPlanilha,
    repintarLista,
    open: () => {
      if (page === null) { page = deps.definePage("modulos", "Módulos", panel, render); void atualizar(); }
      deps.openPage(page);
    },
  };
}
