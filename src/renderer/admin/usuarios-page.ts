/**
 * Variante: admin. Aba "Usuários" da janela de uma pessoa, abaixo de Auditoria: só numa máquina em que o admin entra
 * como root. Lista os usuários de login (sudo, meu-bot, chave, disco usado/limite), cria usuários comuns (sem sudo) com
 * a chave SSH deste Mac, regula o limite de disco em % do disco (uma fatia que se redistribui) e apaga. Baixar o limite
 * de quem já ocupa mais não corta às cegas: a aba mostra o que ocupa espaço e o admin escolhe o que apagar.
 * O main acha a máquina pela janela e confere tudo; a tela só pede. Fábrica como auditoria-page.ts.
 */
import { backendAtras, pctDe, textoDoLimite } from "../lib/admin-view.js";
import type { MeuBotApi, UsuarioMaquina, UsuariosVisao } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { carregando as espera } from "../lib/carregando.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { proximoBox } from "../lib/usuarios-nome.js";

export interface UsuariosPageDeps {
  who: string;
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  api: Pick<MeuBotApi, "adminUsuarios" | "adminUsuarioCriar" | "adminUsuarioLimite" | "adminUsuarioApagar" | "adminUsuarioMaiores" | "adminUsuarioApagarItem" | "adminUsuarioRecursos" | "adminSwapLigar" | "adminGovernanca" | "adminBackendsAtualizar" | "adminHermesGlobal" | "adminOpenclawGlobal" | "adminUsuarioApelido" | "adminUsuarioManterLigado" | "adminUsuarioPreparar" | "on" | "adminUsuarioNosSeletores" | "adminUsuariosSincronizar">;
}
const NOME_RE = /^[a-z][a-z0-9_-]{1,31}$/;
/** O prefixo fixo dos usuários criados aqui (cópia de PREFIXO_USUARIO, src/main/admin/usuarios-core.ts). */
const PREFIXO = "box-";
const comPrefixo = (n: string): string => (n.startsWith(PREFIXO) ? n : `${PREFIXO}${n}`);
const PROTEGIDOS = new Set(["openclaw", "hermes", "auditoria"]);
const tam = (kb: number): string => (kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1).replace(".", ",")} GB` : kb >= 1024 ? `${Math.round(kb / 1024)} MB` : `${kb} KB`);
/** % do disco que o limite representa (arredondado). */
/** Quanto do limite macio já foi usado: perto a partir de 80% (o 1º aviso da pessoa), cheio em 100% (espelha nivelUso de usuarios-core.ts). */
const nivelUso = (usadoKb: number | null, limiteKb: number | null): "ok" | "perto" | "cheio" =>
  usadoKb === null || limiteKb === null || limiteKb <= 0 ? "ok" : usadoKb >= limiteKb ? "cheio" : usadoKb >= limiteKb * 0.8 ? "perto" : "ok";
/** % do tempo em que a cota de CPU segurou a box (cpu.stat: µs parados ÷ períodos de 100 ms). */
const cpuSegurada = (b: { cpuPeriodos: number; cpuEstranguladoUsec: number }): number => (b.cpuPeriodos > 0 ? Math.round(b.cpuEstranguladoUsec / (b.cpuPeriodos * 1000)) : 0);
type Maiores = { home: string | null; itens: { kb: number; pasta: boolean; caminho: string }[] };

export function mountUsuariosPage(deps: UsuariosPageDeps): { open: () => void } {
  let page: PageTab | null = null;
  let visao: UsuariosVisao | null = null;
  let erro: string | null = null;
  let ocupado: string | null = null;
  /** O agente do WhatsApp escolhido para a próxima conta (Hermes é o padrão de sempre). */
  let motorNovo: "hermes" | "openclaw" = "hermes"; // o que está rodando ("criar", "limite:maria", "apagar:maria"…)
  /** Limite de disco já preenchido ao criar: a menor % que dá os 3 GB da conta padrão (a máquina informa); 1% enquanto não informou. Dá para apagar e deixar sem limite. */
  const PCT_PADRAO = "1";
  const pctPadrao = (): string => (visao?.pctMinimo != null ? String(visao.pctMinimo) : PCT_PADRAO);
  /** O que a pessoa digitou depois do box-; null = ainda não mexeu (o campo mostra o próximo número da sequência). Idem o %: null = o padrão. */
  let nome: string | null = null; let pctNovo: string | null = null;
  const nomeAgora = (): string => nome ?? proximoBox(visao?.usuarios.map((u) => u.nome) ?? []);
  let msg: { text: string; bad: boolean } | null = null;
  /** % digitado na linha de cada usuário (antes de salvar). */
  const rascunho = new Map<string, string>();
  /** Tetos digitados na linha (RAM em MB, CPU em %), antes de salvar. */
  const rascunhoRec = new Map<string, { ram: string; cpu: string }>();
  /** Usuário com o apelido em edição (o campo aparece no lugar do nome). */
  let editandoApelido: string | null = null; let apelidoTxt = "";
  /** Liberar espaço: o usuário, o % pedido e o que ocupa espaço na pasta dele. */
  let liberar: { nome: string; pct: number; maiores: Maiores | null; erro: string | null; itemArmado: string | null } | null = null;
  /** Resultado da sincronização com os seletores feita ao abrir a aba (uma linha discreta; null = nada a dizer). */
  let sincronia: string | null = null;
  /** Log do último job de criar/preparar (ao vivo enquanto roda; fica na tela depois para se ver o que aconteceu). */
  let jobLog: string[] = [];
  deps.api.on("admin:usuarios-progresso", (p) => {
    if (ocupado === null || !(ocupado === "criar" || ocupado === "backends" || ocupado.startsWith("preparar:"))) return;
    // A instalação do backend despeja o `systemctl status` inteiro: só as linhas que dizem algo.
    const l = p.line.replace(/\s+$/, "");
    if (l.trim() === "" || /^\s*(Invocation|Main PID|Tasks|Memory|CPU|CGroup|└─|Loaded|Docs):?/.test(l) || /^\s*[a-zA-Z]{3} \d{2} \d{2}:\d{2}:\d{2} /.test(l)) return;
    jobLog.push(l); render();
  });

  /** Uma vez ao abrir a aba: os usuários comuns com a chave deste Mac que faltam em algum seletor entram (em segundo plano). */
  async function sincronizar(): Promise<void> {
    try {
      const r = await deps.api.adminUsuariosSincronizar();
      const partes: string[] = [];
      if (r.entraram.length > 0) partes.push(`${r.entraram.length === 1 ? "1 usuário entrou" : `${r.entraram.length} usuários entraram`} nos seletores (meu-bot e admin): ${r.entraram.join(", ")}.`);
      if (r.semChave.length > 0) partes.push(`Sem a chave deste Mac, fora dos seletores: ${r.semChave.join(", ")}.`);
      for (const f of r.falhas) partes.push(`${f.nome}: ${f.motivo}.`);
      sincronia = partes.length > 0 ? partes.join(" ") : null;
      if (r.entraram.length > 0) await ler(); else render();
    } catch (e) { sincronia = `Não consegui conferir os seletores: ${ipcErrorText(e)}`; render(); }
  }
  async function ler(): Promise<void> {
    erro = null; render();
    try { visao = await deps.api.adminUsuarios(); } catch (e) { erro = ipcErrorText(e); }
    render();
  }
  async function rodar(chave: string, f: () => Promise<UsuariosVisao>, ok: string): Promise<boolean> {
    ocupado = chave; msg = null; if (chave === "criar" || chave === "backends" || chave.startsWith("preparar:")) jobLog = []; render();
    try { visao = await f(); msg = { text: ok, bad: false }; return true; }
    catch (e) { msg = { text: `✗ ${ipcErrorText(e).replace(/^ACIMA_DO_LIMITE: /, "")}`, bad: true }; return false; }
    finally { ocupado = null; render(); }
  }
  async function criar(): Promise<void> {
    const digitado = nomeAgora().trim();
    const n = comPrefixo(digitado);
    if (digitado === "" || !NOME_RE.test(n)) { msg = { text: "Nome inválido: minúsculas, números, - ou _, começando por letra (2 a 32).", bad: true }; render(); return; }
    // Sem o tamanho do disco (df falhou na máquina), não há como calcular a fatia: cria sem limite.
    const pctTxt = pctNovo ?? pctPadrao();
    const p = visao?.discoKb === null ? 0 : pctTxt.trim() === "" ? 0 : Number(pctTxt);
    if (!Number.isInteger(p) || p < 0 || p > 100) { msg = { text: "Limite: uma porcentagem inteira de 0 a 100 (vazio = sem limite).", bad: true }; render(); return; }
    // Mais boxes do que cabem na RAM com o teto padrão: avisa, não bloqueia (a conta é do admin; a coluna Pressão mostra o efeito).
    const cap = visao?.capacidade ?? null;
    const avisoCap = cap !== null && cap.boxes + 1 > cap.cabem ? ` Atenção: com este serão ${cap.boxes + 1} boxes, mais que as ${cap.cabem} que cabem na RAM com ${cap.padraoMb} MB cada; acompanhe a coluna Pressão.` : "";
    if (await rodar("criar", () => deps.api.adminUsuarioCriar(n, p, motorNovo), `✓ Usuário ${n} criado (sem sudo)${p > 0 ? `, com ${p}% do disco` : ""}.`)) {
      // Já entrou nos seletores (meu-bot e admin): a mensagem diz com que nome, ou o que faltou.
      const sel = visao?.seletores;
      if (sel !== undefined) msg = sel.aviso !== null ? { text: `Usuário ${n} criado, mas ${sel.aviso}. Tente "Nos seletores" na linha dele.`, bad: true }
        : visao?.preparo != null ? { text: `Usuário ${n} criado, mas a preparação parou: ${visao.preparo}. Use "Preparar" na linha dele para continuar de onde parou.`, bad: true }
        : visao?.global === true ? { text: `✓ ${n} está pronto: Claude Code Global, backend do meu-bot e ${motorNovo === "openclaw" ? "OpenClaw escolhido para o WhatsApp" : "Hermes com transcrição"}. No meu-bot (aba Usuário, ${sel.alias}) falta só ler o QR do WhatsApp.`, bad: false }
        : { text: `✓ ${n} está pronto: Claude Code, backend do meu-bot e ${motorNovo === "openclaw" ? "OpenClaw escolhido para o WhatsApp" : "Hermes com transcrição"}. No meu-bot (aba Usuário, ${sel.alias}) falta só entrar no Claude e ler o QR do WhatsApp.`, bad: false };
      if (avisoCap !== "" && msg !== null) msg = { text: `${msg.text}${avisoCap}`, bad: true };
      nome = null; pctNovo = null; render();
    }
  }
  async function salvarRecursos(u: UsuarioMaquina): Promise<void> {
    const r = rascunhoRec.get(u.nome) ?? { ram: u.ramMaxMb === null ? "" : String(u.ramMaxMb), cpu: u.cpuMaxPct === null ? "" : String(u.cpuMaxPct) };
    const ram = r.ram.trim() === "" ? 0 : Number(r.ram); const cpu = r.cpu.trim() === "" ? 0 : Number(r.cpu);
    if (!Number.isInteger(ram) || ram < 0 || !Number.isInteger(cpu) || cpu < 0) { msg = { text: "Tetos: RAM em MB e CPU em % de um núcleo, números inteiros (vazio = sem teto).", bad: true }; render(); return; }
    if (ram > 0 && ram < 256) { msg = { text: "RAM máxima muito baixa: com menos de 256 MB o agente nem sobe.", bad: true }; render(); return; }
    if (await rodar(`recursos:${u.nome}`, () => deps.api.adminUsuarioRecursos(u.nome, ram, cpu), `✓ Tetos de ${u.nome}: RAM ${ram === 0 ? "sem teto" : `${ram} MB`}, CPU ${cpu === 0 ? "sem teto" : `${cpu}%`}.`)) rascunhoRec.delete(u.nome);
  }
  async function salvarLimite(u: UsuarioMaquina): Promise<void> {
    // O mesmo texto que o campo mostra: sem rascunho, o % atual (Salvar sem editar não pode virar "sem limite").
    const txt = textoDoLimite(rascunho.get(u.nome), u.limiteKb, visao?.discoKb ?? null).trim();
    const p = txt === "" ? 0 : Number(txt);
    if (!Number.isInteger(p) || p < 0 || p > 100) { msg = { text: "Limite: uma porcentagem inteira de 0 a 100 (vazio = sem limite).", bad: true }; render(); return; }
    const novoKb = visao?.discoKb !== null && visao?.discoKb !== undefined && p > 0 ? Math.floor((visao.discoKb * p) / 100) : 0;
    // Já ocupa mais que o limite novo: abre o "liberar espaço" para o admin escolher o que apagar.
    if (novoKb > 0 && u.usadoKb !== null && u.usadoKb > novoKb) { await abrirLiberar(u.nome, p); return; }
    if (await rodar(`limite:${u.nome}`, () => deps.api.adminUsuarioLimite(u.nome, p), `✓ Limite de ${u.nome}: ${p === 0 ? "sem limite" : `${p}% do disco`}.`)) rascunho.delete(u.nome);
  }
  async function abrirLiberar(n: string, pct: number): Promise<void> {
    liberar = { nome: n, pct, maiores: null, erro: null, itemArmado: null }; render();
    try { liberar.maiores = await deps.api.adminUsuarioMaiores(n); } catch (e) { if (liberar !== null) liberar.erro = ipcErrorText(e); }
    render();
  }
  async function apagarItem(caminho: string): Promise<void> {
    if (liberar === null) return;
    const l = liberar;
    if (l.itemArmado !== caminho) { l.itemArmado = caminho; render(); return; }
    ocupado = `item:${caminho}`; l.itemArmado = null; render();
    try { l.maiores = await deps.api.adminUsuarioApagarItem(l.nome, caminho); visao = await deps.api.adminUsuarios(); msg = { text: `✓ Apagado: ${caminho}`, bad: false }; }
    catch (e) { msg = { text: `✗ ${ipcErrorText(e)}`, bad: true }; }
    finally { ocupado = null; render(); }
  }
  async function aplicarDepoisDeLiberar(): Promise<void> {
    if (liberar === null) return;
    const l = liberar;
    if (await rodar(`limite:${l.nome}`, () => deps.api.adminUsuarioLimite(l.nome, l.pct), `✓ Limite de ${l.nome}: ${l.pct}% do disco.`)) { liberar = null; rascunho.delete(l.nome); render(); }
  }

  function cartaoLiberar(v: UsuariosVisao): HTMLElement | null {
    if (liberar === null) return null;
    const l = liberar;
    const u = v.usuarios.find((x) => x.nome === l.nome);
    const alvoKb = v.discoKb !== null ? Math.floor((v.discoKb * l.pct) / 100) : 0;
    const falta = u?.usadoKb !== null && u?.usadoKb !== undefined ? Math.max(0, u.usadoKb - alvoKb) : 0;
    const c = el("div", "admin-card");
    c.append(el("strong", "", `Liberar espaço de ${l.nome} para ${l.pct}% (${tam(alvoKb)})`));
    c.append(el("p", "hint", falta > 0 ? `${l.nome} ocupa ${tam(u?.usadoKb ?? 0)}: faltam ${tam(falta)}. Escolha o que apagar da pasta dele (dois cliques em cada item).` : `Pronto: ${l.nome} ocupa ${tam(u?.usadoKb ?? 0)}, cabe no limite novo.`));
    if (l.erro !== null) c.append(el("p", "hint bad-hint", l.erro));
    else if (l.maiores === null) c.append(espera(`Lendo o que ocupa espaço na pasta de ${l.nome}…`));
    else if (l.maiores.itens.length === 0) c.append(el("p", "hint", "Nada grande na pasta."));
    else {
      const t = el("table", "auditoria-tabela");
      const cab = el("tr"); for (const h of ["Tamanho", "Item", ""]) cab.append(el("th", "", h)); t.append(cab);
      for (const it of l.maiores.itens) {
        const tr = el("tr");
        const rel = l.maiores.home !== null ? it.caminho.slice(l.maiores.home.length + 1) : it.caminho;
        const b = el("button", "btn btn-ghost btn-small", ocupado === `item:${it.caminho}` ? "Apagando…" : l.itemArmado === it.caminho ? "Confirmar? apaga de vez" : "Apagar"); b.type = "button";
        b.disabled = ocupado !== null;
        b.addEventListener("click", () => { void apagarItem(it.caminho); });
        const td = el("td"); td.append(b);
        tr.append(el("td", "", tam(it.kb)), el("td", "", `${it.pasta ? "📁 " : ""}${rel}`), td);
        t.append(tr);
      }
      c.append(t);
    }
    const acoes = el("div", "admin-actions");
    const ap = el("button", "btn btn-primary btn-small", ocupado === `limite:${l.nome}` ? "Aplicando…" : `Aplicar ${l.pct}%`); ap.type = "button"; ap.disabled = falta > 0 || ocupado !== null;
    ap.addEventListener("click", () => { void aplicarDepoisDeLiberar(); });
    const cancelar = el("button", "btn btn-ghost btn-small", "Cancelar"); cancelar.type = "button"; cancelar.addEventListener("click", () => { liberar = null; render(); });
    acoes.append(ap, cancelar); c.append(acoes);
    return c;
  }

  function render(): void {
    if (page === null) return;
    const panel = page.panel; panel.replaceChildren();
    const head = el("div", "guide-head"); const hb = el("div", "tut-body");
    hb.append(el("span", "tut-badge", "usuários"), el("h2", "", `Usuários · ${deps.who}`), el("p", "", "Os usuários de login desta máquina. Os novos são comuns (sem sudo) e entram pela chave SSH deste Mac. O limite de disco é uma fatia (%) do disco, que você redistribui quando quiser."));
    head.append(hb); panel.append(head);

    const form = el("div", "admin-card"); form.append(el("strong", "", "Criar usuário"));
    const linha = el("div", "admin-actions");
    // O "box-" fica fixo na frente: digita "maria", nasce "box-maria".
    const prefixo = el("span", "usuarios-prefixo", PREFIXO);
    const input = el("input") as HTMLInputElement; input.type = "text"; input.placeholder = proximoBox(visao?.usuarios.map((u) => u.nome) ?? []); input.value = nomeAgora(); input.maxLength = 32 - PREFIXO.length; input.disabled = ocupado !== null;
    input.title = `O usuário nasce como ${PREFIXO}<o que você digitar>`;
    input.autocapitalize = "off"; input.spellcheck = false;
    // Quem digita "box-3" vê "box-3" (o prefixo fixo já está na frente), não "box-box-3".
    input.addEventListener("input", () => { let v = input.value.toLowerCase(); if (v.startsWith(PREFIXO)) v = v.slice(PREFIXO.length); nome = v; if (input.value !== v) input.value = v; });
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") void criar(); });
    const pin = el("input") as HTMLInputElement; pin.type = "number"; pin.min = "0"; pin.max = "100"; pin.step = "1"; pin.placeholder = visao?.discoKb === null ? "sem limite (disco não lido)" : "% do disco"; pin.value = visao?.discoKb === null ? "" : (pctNovo ?? pctPadrao());
    pin.title = visao?.pctMinimo != null ? `Limite de disco da conta. ${visao.pctMinimo}% é o mínimo neste disco: a conta padrão ocupa 1,6 GB (voz, Claude Code, OpenClaw, wrangler) e precisa de sobra. Vazio = sem limite` : "Limite de disco da conta (vazio = sem limite)"; pin.disabled = ocupado !== null || visao?.discoKb === null; pin.style.width = "110px";
    pin.addEventListener("input", () => { pctNovo = pin.value; });
    // O agente do WhatsApp da conta nova: Hermes (padrão) ou OpenClaw. O sistema é agnóstico; o pareamento no meu-bot dela completa.
    const motorSel = el("select") as HTMLSelectElement; motorSel.title = "Com que agente do WhatsApp a conta nasce. Hermes: o de todos em /opt/hermes, com transcrição. OpenClaw: a escolha fica gravada e o onboard acontece no pareamento, no meu-bot dela";
    for (const [v, t] of [["hermes", "WhatsApp: Hermes"], ["openclaw", "WhatsApp: OpenClaw"]] as const) { const o = el("option", "", t); o.value = v; motorSel.append(o); }
    motorSel.value = motorNovo; motorSel.addEventListener("change", () => { motorNovo = motorSel.value === "openclaw" ? "openclaw" : "hermes"; });
    const b = el("button", "btn btn-primary btn-small", ocupado === "criar" ? "Criando e preparando… (alguns minutos)" : "Criar"); b.type = "button"; b.disabled = ocupado !== null;
    b.addEventListener("click", () => { void criar(); });
    const campo = el("span", "usuarios-nome"); campo.append(prefixo, input);
    linha.append(campo, pin, motorSel, b); form.append(linha);
    // No lugar do texto descritivo: o que o job está fazendo agora (e o que fez, depois).
    if (jobLog.length > 0) { const ul = el("ul", "support-log"); for (const l of jobLog.slice(-40)) ul.append(el("li", "", l)); form.append(ul); ul.scrollTop = ul.scrollHeight; }
    if (msg !== null) form.append(el("p", `hint ${msg.bad ? "bad-hint" : "audio-ok"}`, msg.text));
    if (sincronia !== null) form.append(el("p", "hint", sincronia));
    panel.append(form);

    if (visao !== null) { const c = cartaoLiberar(visao); if (c !== null) panel.append(c); }

    const lista = el("div", "admin-card");
    const topo = el("div", "admin-actions"); topo.append(el("strong", "grow", "Usuários de login"));
    // Backend por box: quem está atrás da versão deste app ganha o botão de reinstalar em todas (uma por vez; quem
    // está com chat em andamento é pulado e aparece na mensagem final).
    const doApp = visao?.backendDoApp ?? null;
    const atrasadas = visao === null || doApp === null ? [] : visao.usuarios.filter((u) => u.backendInstalado && !u.sudo && backendAtras(u.backendVersao, doApp));
    if (atrasadas.length > 0) {
      const ab = el("button", "btn btn-primary btn-small", ocupado === "backends" ? "Atualizando… (alguns minutos)" : `Atualizar todas (${atrasadas.length})`); ab.type = "button"; ab.disabled = ocupado !== null;
      ab.title = `Reinstala o backend do meu-bot ${visao?.backendDoApp ?? ""} em: ${atrasadas.map((u) => u.nome).join(", ")}. O serviço de cada uma reinicia; quem está com chat em andamento é pulado.`;
      ab.addEventListener("click", () => { void rodar("backends", () => deps.api.adminBackendsAtualizar(), "✓ Backends atualizados.").then((ok) => { const r = visao?.atualizacao ?? []; const resto = r.filter((x) => x.estado !== "atualizada"); if (ok && resto.length > 0) { msg = { text: `${r.filter((x) => x.estado === "atualizada").length} atualizada(s) · ${resto.map((x) => `${x.nome}: ${x.motivo}`).join(" · ")}`, bad: true }; render(); } }); });
      topo.append(ab);
    }
    const at = el("button", "btn btn-ghost btn-small", "Atualizar"); at.type = "button"; at.addEventListener("click", () => { void ler(); }); topo.append(at);
    lista.append(topo);
    if (erro !== null) lista.append(el("p", "hint bad-hint", erro));
    else if (visao === null) lista.append(espera("Lendo os usuários da máquina…"));
    else {
      const v = visao;
      const distribuido = v.usuarios.reduce((s, u) => s + (pctDe(u.limiteKb, v.discoKb) ?? 0), 0);
      const apertados = v.usuarios.filter((u) => nivelUso(u.usadoKb, u.limiteKb) !== "ok").length;
      if (v.discoKb !== null) lista.append(el("p", `hint ${distribuido > 100 ? "bad-hint" : ""}`, `Disco: ${tam(v.discoKb)} · distribuído: ${distribuido}% · livre: ${Math.max(0, 100 - distribuido)}%${distribuido > 100 ? " (passou de 100%: se todos encherem, o disco acaba antes dos limites)" : ""}${v.cota ? "" : " · cota de disco ainda desligada nesta máquina"}`));
      if (apertados > 0) lista.append(el("p", "hint notice-warn", `${apertados === 1 ? "1 usuário está" : `${apertados} usuários estão`} perto do limite de disco (a pessoa já foi avisada no WhatsApp a 80%): no limite ainda grava por 7 dias com a folga, depois trava. Use "Liberar espaço" ou aumente o %.`));
      const pressionadas = v.usuarios.filter((u) => u.pressao !== null && u.pressao.estado !== "folgada");
      if (pressionadas.length > 0) lista.append(el("p", "hint notice-warn", `${pressionadas.length === 1 ? "1 box está" : `${pressionadas.length} boxes estão`} ${pressionadas.some((u) => u.pressao?.estado === "estrangulada") ? "apertada ou estrangulada" : "apertada"} de RAM/CPU: ${pressionadas.map((u) => u.nome).join(", ")}. Passe o mouse na coluna Pressão para ver o motivo e o que fazer.`));
      // RAM: os agentes (OpenClaw, Hermes, Claude) ficam ligados e cada um usa centenas de MB; aqui se vê quem usa quanto.
      if (v.ram !== null) {
        const outros = v.usuarios.reduce((s, u) => s + u.ramKb, 0);
        lista.append(el("p", "hint", `RAM: ${tam(v.ram.usoKb)} em uso de ${tam(v.ram.totalKb)} (${Math.round((v.ram.usoKb * 100) / Math.max(1, v.ram.totalKb))}%) · root: ${tam(v.ram.rootKb)} · usuários: ${tam(outros)} · swap: ${v.ram.swapKb > 0 ? `${tam(v.ram.swapUsoKb)} de ${tam(v.ram.swapKb)}` : "nenhuma"}`));
        // Capacidade: quantas boxes cabem no teto dos usuários (user.slice) com o teto padrão por box; e a CPU prometida.
        const c = v.capacidade;
        if (c !== null) {
          const passou = c.boxes > c.cabem;
          const nucleos = c.cpuNucleos ?? 0;
          const linha = el("p", `hint ${passou ? "notice-warn" : ""}`, `boxes: ${c.boxes} de ${c.cabem} (${c.padraoMb} MB de RAM cada, teto dos usuários ${tam(c.capMb * 1024)}${c.reservaAplicada ? "" : ", reserva do sistema ainda não aplicada"})${nucleos > 0 ? ` · CPU: ${nucleos} núcleos, ${Math.round(c.cpuPrometidoPct / 100)} prometidos` : ""}${passou ? " · mais boxes do que cabem na RAM: acompanhe a coluna Pressão" : ""}`);
          linha.title = "Cabem = teto dos usuários ÷ teto padrão por box (RECURSOS_PADRAO). CPU prometida acima dos núcleos é normal: as boxes ficam ociosas quase sempre (o Claude roda na API); o peso de CPU divide por igual quando disputam.";
          lista.append(linha);
        }
        // Governança: a reserva para o sistema e o isolamento das boxes; um botão só quando falta algo (nada reinicia).
        const g = v.governanca;
        if (!g.reserva || g.semIsolamento.length > 0) {
          const gv = el("div", "admin-actions");
          const b = el("button", "btn btn-ghost btn-small", ocupado === "governanca" ? "Aplicando…" : "Aplicar governança de RAM/CPU"); b.type = "button"; b.disabled = ocupado !== null;
          b.title = "Reserva memória para o sistema (teto de todos os usuários juntos no user.slice, deixando 3 GB ou 10% livres) e aplica a cada box swap própria de 256 MB, 640 MB protegidos e peso de CPU igual; nada reinicia";
          b.title = "Só isto; tudo de uma vez em Preparar máquina"; b.addEventListener("click", () => { void rodar("governanca", () => deps.api.adminGovernanca(), "✓ Governança aplicada: reserva para o sistema e isolamento das boxes."); });
          gv.append(b, el("span", "hint", !g.reserva ? "Sem a reserva, os usuários juntos podem tomar toda a RAM e derrubar o sistema (SSH, túnel, nginx)." : `${g.semIsolamento.length === 1 ? "1 box ainda está" : `${g.semIsolamento.length} boxes ainda estão`} sem isolamento (${g.semIsolamento.join(", ")}): uma delas estourando puxa o swap de todas.`));
          lista.append(gv);
        }
        // Sem swap, RAM cheia faz o Linux matar um processo (um agente some); com ela, a máquina só desacelera.
        if (v.ram.swapKb === 0) {
          const sw = el("div", "admin-actions");
          const b = el("button", "btn btn-ghost btn-small", ocupado === "swap" ? "Ligando…" : "Ligar memória de reserva (8 GB)"); b.type = "button"; b.disabled = ocupado !== null;
          b.title = "Cria um /swapfile de 8 GB (cópia do /etc/fstab antes), sem reiniciar: se a RAM encher, a máquina desacelera em vez de derrubar um agente";
          b.addEventListener("click", () => { void rodar("swap", () => deps.api.adminSwapLigar(), "✓ Memória de reserva (swap) de 8 GB ligada."); });
          sw.append(b, el("span", "hint", "Esta máquina não tem swap: se a RAM encher, o Linux derruba um processo."));
          lista.append(sw);
        }
      }
      // Hermes só na pasta do root (700): os outros usuários não o alcançam e cada um acabaria baixando uma cópia.
      if (v.hermes === "global") lista.append(el("p", "hint", "Hermes e transcritor: um só para todos os usuários (/opt/hermes e /opt/transcriber); os dados de cada um ficam na pasta dele."));
      else if (v.hermes !== null) {
        const hg = el("div", "admin-actions");
        const completar = v.hermes === "sem-transcritor";
        const b = el("button", "btn btn-ghost btn-small", ocupado === "hermes" ? "Instalando…" : completar ? "Instalar o transcritor para todos" : "Instalar Hermes para todos"); b.type = "button"; b.disabled = ocupado !== null;
        b.title = "Instala o Hermes em /opt/hermes (só leitura para os outros) e aponta o comando hermes de todos para lá; o do root continua como está. Baixa ~1 GB na primeira vez";
        b.addEventListener("click", () => { void rodar("hermes", () => deps.api.adminHermesGlobal(), "✓ Hermes e transcritor instalados para todos: os usuários usam os mesmos programas, sem baixar uma cópia cada um."); });
        hg.append(b, el("span", "hint", completar ? "O Hermes já é de todos, mas falta o transcritor compartilhado (/opt/transcriber): sem ele, cada usuário instala o próprio para ouvir áudios." : v.hermes === "root" ? "O Hermes desta máquina está só na pasta do root: os outros usuários não conseguem usá-lo e cada um baixaria uma cópia." : "Esta máquina não tem Hermes."));
        lista.append(hg);
      }
      // O sistema é agnóstico: a máquina pode receber o OpenClaw e o Hermes. O mesmo instalador do "Preparar máquina".
      if (v.openclaw === "global") lista.append(el("p", "hint", "OpenClaw: um só para todos os usuários (/opt/openclaw); os dados de cada um ficam na pasta dele."));
      else if (v.openclaw !== null) {
        const og = el("div", "admin-actions");
        const b = el("button", "btn btn-ghost btn-small", ocupado === "openclaw" ? "Instalando…" : "Instalar OpenClaw para todos"); b.type = "button"; b.disabled = ocupado !== null;
        b.title = "Instala o OpenClaw em /opt/openclaw, com o Node dele (só leitura para os outros), e aponta o comando openclaw de todos para lá; o do root continua como está";
        b.addEventListener("click", () => { void rodar("openclaw", () => deps.api.adminOpenclawGlobal(), "✓ OpenClaw instalado para todos: os usuários usam o mesmo programa, sem baixar uma cópia cada um."); });
        og.append(b, el("span", "hint", v.openclaw === "root" ? "O OpenClaw desta máquina está só na pasta do root: os outros usuários não o alcançam, e cada um acabaria baixando uma cópia." : "Esta máquina não tem o OpenClaw: sem o de todos, cada usuário baixaria o Node 24 e uma cópia."));
        lista.append(og);
      }
      if (v.usuarios.length === 0) lista.append(el("p", "hint", "Nenhum usuário de login além do root."));
      else {
        const t = el("table", "auditoria-tabela");
        const cab = el("tr"); for (const h of ["Usuário", "Sudo", "meu-bot", "Backend", "RAM", "Pressão", "RAM máx (MB)", "CPU %", "Usado", "Limite", "Limite %", "Entrar", ""]) cab.append(el("th", "", h)); t.append(cab);
        for (const u of v.usuarios) {
          const tr = el("tr");
          const acesso = v.hostname !== null ? `ssh${v.chave !== null ? ` -i ${v.chave}` : ""} ${u.nome}@${v.hostname}${v.port !== null && v.port !== "22" ? ` -p ${v.port}` : ""}` : "";
          const pct = pctDe(u.limiteKb, v.discoKb);
          const usado = u.usadoKb === null ? "—" : tam(u.usadoKb);
          const limite = u.usadoKb === null ? "—" : u.limiteKb === null ? "sem limite" : tam(u.limiteKb);
          const nu = nivelUso(u.usadoKb, u.limiteKb);
          const tdUsado = el("td", nu === "cheio" ? "notice-error" : nu === "perto" ? "notice-warn" : "", usado);
          if (nu !== "ok") tdUsado.title = nu === "cheio" ? "no limite: ainda grava por até 7 dias com a folga de 10%, depois trava; use Liberar espaço ou aumente o %" : "perto do limite (80%+; a pessoa já foi avisada no WhatsApp): use Liberar espaço ou aumente o %";
          // Limite: macio (o que a pessoa vê); conta criada antes da folga mostra "sem folga" até o admin salvar de novo.
          const tdLimite = el("td", "", limite);
          if (u.limiteKb !== null && u.hardKb !== null && u.hardKb === u.limiteKb) { const sf = el("span", "hint", " · sem folga"); sf.title = "Limite macio igual ao duro (conta de antes da folga): Salvar o mesmo % aplica a folga de 10% e os 7 dias de carência"; tdLimite.append(sf); }
          // RAM: a memória própria (anon) do cgroup, que o kernel não solta; sem cgroup, a soma dos processos (RSS).
          const tdRamUso = el("td", "", u.box !== null ? tam(u.box.anonKb) : u.ramKb > 0 ? tam(u.ramKb) : "—");
          if (u.box !== null) tdRamUso.title = `processos (RSS): ${tam(u.ramKb)} · com cache do Linux: ${tam(u.box.usoKb)} (ele solta quando aperta) · pico desde que subiu: ${u.box.picoKb === null ? "—" : tam(u.box.picoKb)} · swap: ${tam(u.box.swapKb)}`;
          // Pressão: folgada / apertada / estrangulada, com o motivo e o que fazer no título.
          const pr = u.pressao;
          const tdPr = el("td", pr === null ? "" : pr.estado === "estrangulada" ? "notice-error usuarios-pressao" : pr.estado === "apertada" ? "notice-warn usuarios-pressao" : "usuarios-pressao", pr === null ? "—" : pr.estado);
          if (pr !== null && u.box !== null) tdPr.title = `${pr.motivo}${pr.dica !== "" ? `. ${pr.dica}` : ""} · PSI mem 60 s: ${u.box.psiMem60}% · PSI CPU 60 s: ${u.box.psiCpu60}% · teto batido desde que a box subiu: ${u.box.evMax}× · mortes por memória desde que a box subiu: ${u.box.oomKill} · CPU segurada pela cota: ${cpuSegurada(u.box)}% do tempo`;
          // A dica visível (não só no título) e, havendo teto sugerido, um botão que preenche RAM máx/CPU %: o admin confere e salva.
          if (pr !== null && pr.estado !== "folgada" && pr.dica !== "") {
            tdPr.append(el("div", "hint usuarios-pressao-dica", pr.dica));
            const sg = pr.sugestao;
            if (!u.sudo && (sg.ramMaxMb !== null || sg.cpuPct !== null)) {
              const us = el("button", "btn btn-ghost btn-small", "Usar sugestão"); us.type = "button"; us.disabled = ocupado !== null;
              us.title = `Preenche ${sg.ramMaxMb !== null ? `RAM máx com ${sg.ramMaxMb} MB` : ""}${sg.ramMaxMb !== null && sg.cpuPct !== null ? " e " : ""}${sg.cpuPct !== null ? `CPU % com ${sg.cpuPct}` : ""}; nada muda até você clicar em Salvar`;
              us.addEventListener("click", () => {
                const atual = rascunhoRec.get(u.nome) ?? { ram: u.ramMaxMb === null ? "" : String(u.ramMaxMb), cpu: u.cpuMaxPct === null ? "" : String(u.cpuMaxPct) };
                rascunhoRec.set(u.nome, { ram: sg.ramMaxMb !== null ? String(sg.ramMaxMb) : atual.ram, cpu: sg.cpuPct !== null ? String(sg.cpuPct) : atual.cpu });
                render();
              });
              tdPr.append(us);
            }
          }
          const tdPct = el("td");
          const ip = el("input") as HTMLInputElement; ip.type = "number"; ip.min = "0"; ip.max = "100"; ip.step = "1"; ip.style.width = "64px";
          ip.value = textoDoLimite(rascunho.get(u.nome), u.limiteKb, v.discoKb); ip.placeholder = "—"; ip.disabled = ocupado !== null || u.sudo;
          ip.title = u.sudo ? "quem tem sudo não leva limite por aqui" : "% do disco (vazio = sem limite)";
          ip.addEventListener("input", () => { rascunho.set(u.nome, ip.value); });
          ip.addEventListener("keydown", (ev) => { if (ev.key === "Enter") void salvarLimite(u); });
          const sv = el("button", "btn btn-ghost btn-small", ocupado === `limite:${u.nome}` ? "…" : "Salvar"); sv.type = "button"; sv.disabled = ocupado !== null || u.sudo;
          sv.addEventListener("click", () => { void salvarLimite(u); });
          tdPct.append(ip, " ", sv);
          const tdAp = el("td", "usuarios-acoes");
          // "Nos seletores": refaz, para este usuário, o que criar e a sincronização ao abrir a aba já fazem (meu-bot e admin).
          if (!u.sudo && !u.meuBot && u.chave) {
            const ab = el("button", "btn btn-ghost btn-small", ocupado === `abrir:${u.nome}` ? "…" : "Nos seletores"); ab.type = "button"; ab.disabled = ocupado !== null;
            ab.title = "Põe este usuário no seletor do meu-bot e do staging (~/.ssh/config deste Mac, com cópia antes) e no do admin, sem instalar nada na conta";
            ab.addEventListener("click", () => {
              ocupado = `abrir:${u.nome}`; msg = null; render();
              void deps.api.adminUsuarioNosSeletores(u.nome)
                .then((r) => { msg = r.aviso !== null ? { text: `${r.alias} está no seletor do meu-bot, mas ${r.aviso}.`, bad: true } : { text: r.novo ? `✓ ${u.nome} entrou nos seletores: no meu-bot como ${r.alias} (aba Usuário) e no admin.` : `${u.nome} já estava nos dois seletores (${r.alias}).`, bad: false }; })
                .catch((e: unknown) => { msg = { text: `✗ ${ipcErrorText(e)}`, bad: true }; })
                .finally(() => { ocupado = null; render(); });
            });
            tdAp.append(ab, " ");
          }
          // Conta sem o onboarding completo (criada antes dele, ou um passo falhou): retoma de onde parou.
          if (!u.pronto && !u.sudo && !PROTEGIDOS.has(u.nome)) {
            const pp = el("button", "btn btn-ghost btn-small", ocupado === `preparar:${u.nome}` ? "Preparando… (alguns minutos)" : "Preparar"); pp.type = "button"; pp.disabled = ocupado !== null;
            pp.title = "Instala o Claude Code e o backend do meu-bot na conta dele e deixa o Hermes com a transcrição da máquina; o que já está feito passa direto";
            pp.addEventListener("click", () => { void rodar(`preparar:${u.nome}`, () => deps.api.adminUsuarioPreparar(u.nome), `✓ ${u.nome} está pronto: falta só entrar no Claude e ler o QR do WhatsApp.`); });
            tdAp.append(pp, " ");
          }
          // Sem linger o agente dele (systemctl --user) morre quando ele sai da máquina e não volta ao reiniciar.
          if (!u.ligado) {
            const lg = el("button", "btn btn-ghost btn-small", ocupado === `ligado:${u.nome}` ? "…" : "Manter ligado"); lg.type = "button"; lg.disabled = ocupado !== null;
            lg.title = "Hoje o agente dele para quando ele sai da máquina e não volta ao reiniciar. Liga o linger do systemd: os serviços dele seguem rodando sozinhos";
            lg.addEventListener("click", () => { void rodar(`ligado:${u.nome}`, () => deps.api.adminUsuarioManterLigado(u.nome), `✓ ${u.nome} fica sempre ligado: o agente dele segue rodando sem ele conectado e volta ao reiniciar.`); });
            tdAp.append(lg, " ");
          }
          if (!u.sudo && !PROTEGIDOS.has(u.nome)) {
            // Um clique apaga, sem confirmação: o usuário e a pasta dele somem na hora.
            const ap = el("button", "btn btn-ghost btn-small", ocupado === `apagar:${u.nome}` ? "Apagando…" : "Apagar"); ap.type = "button"; ap.disabled = ocupado !== null;
            ap.title = "Apaga o usuário e a pasta dele na hora, sem pedir confirmação";
            ap.addEventListener("click", () => { void rodar(`apagar:${u.nome}`, () => deps.api.adminUsuarioApagar(u.nome), `✓ Usuário ${u.nome} apagado, com a pasta dele.`); });
            tdAp.append(ap);
          }
          // Tetos (systemd, na fatia do usuário): RAM em MB e CPU em % de um núcleo; vazio = sem teto.
          const tdRam = el("td"); const tdCpu = el("td");
          const rr = rascunhoRec.get(u.nome) ?? { ram: u.ramMaxMb === null ? "" : String(u.ramMaxMb), cpu: u.cpuMaxPct === null ? "" : String(u.cpuMaxPct) };
          const iram = el("input") as HTMLInputElement; iram.type = "number"; iram.min = "0"; iram.step = "128"; iram.placeholder = "—"; iram.style.width = "72px"; iram.value = rr.ram; iram.title = "RAM máxima em MB (vazio = sem teto); sugestão para um agente: 1024";
          const icpu = el("input") as HTMLInputElement; icpu.type = "number"; icpu.min = "0"; icpu.step = "25"; icpu.placeholder = "—"; icpu.style.width = "56px"; icpu.value = rr.cpu; icpu.title = "CPU em % de um núcleo (100 = um núcleo; vazio = sem teto)";
          for (const i of [iram, icpu]) { i.disabled = ocupado !== null || u.sudo; i.addEventListener("input", () => { rascunhoRec.set(u.nome, { ram: iram.value, cpu: icpu.value }); }); i.addEventListener("keydown", (ev) => { if (ev.key === "Enter") void salvarRecursos(u); }); }
          const sr = el("button", "btn btn-ghost btn-small", ocupado === `recursos:${u.nome}` ? "…" : "Salvar"); sr.type = "button"; sr.disabled = ocupado !== null || u.sudo;
          sr.title = u.sudo ? "quem tem sudo não leva teto por aqui" : "grava os tetos de RAM e CPU";
          sr.addEventListener("click", () => { void salvarRecursos(u); });
          tdRam.append(iram); tdCpu.append(icpu, " ", sr);
          // Usuário: o apelido em destaque e o login embaixo; ✎ edita o apelido (o login e a pasta não mudam).
          const tdNome = el("td");
          if (editandoApelido === u.nome) {
            const ia = el("input") as HTMLInputElement; ia.type = "text"; ia.maxLength = 40; ia.placeholder = "apelido (vazio tira)"; ia.value = apelidoTxt; ia.style.width = "140px";
            ia.addEventListener("input", () => { apelidoTxt = ia.value; });
            const salvarAp = (): void => { const a = apelidoTxt; editandoApelido = null; void rodar(`apelido:${u.nome}`, () => deps.api.adminUsuarioApelido(u.nome, a), a.trim() === "" ? `✓ ${u.nome} ficou sem apelido.` : `✓ Apelido de ${u.nome}: ${a.trim()}.`); };
            ia.addEventListener("keydown", (ev) => { if (ev.key === "Enter") salvarAp(); if (ev.key === "Escape") { editandoApelido = null; render(); } });
            const ok = el("button", "btn btn-ghost btn-small", "OK"); ok.type = "button"; ok.addEventListener("click", salvarAp);
            tdNome.append(ia, " ", ok);
            setTimeout(() => ia.focus(), 0);
          } else {
            if (u.apelido !== "") tdNome.append(el("strong", "", u.apelido), el("br"), el("span", "hint", u.nome)); else tdNome.append(u.nome);
            const ed = el("button", "linkish", " ✎"); ed.type = "button"; ed.title = "Apelido (nome de exibição): o login e a pasta não mudam"; ed.disabled = ocupado !== null;
            ed.addEventListener("click", () => { editandoApelido = u.nome; apelidoTxt = u.apelido; render(); });
            tdNome.append(ed);
          }
          // Entrar: o comando inteiro numa linha (quebrado no meio ele não serve para copiar).
          const tdAcesso = el("td"); if (acesso !== "") tdAcesso.append(el("code", "usuarios-ssh", acesso));
          // Backend: a versão gravada na conta dela; "desatualizado" quando este app traz uma mais nova ("Atualizar todas" no topo).
          const atras = u.backendInstalado && v.backendDoApp !== null && backendAtras(u.backendVersao, v.backendDoApp);
          const tdBk = el("td", atras ? "notice-warn" : "", !u.backendInstalado ? "—" : `${u.backendVersao ?? "sem versão"}${atras ? " · desatualizado" : ""}`);
          if (atras) tdBk.title = `este app traz o backend ${v.backendDoApp}; "Atualizar todas" reinstala (o serviço dela reinicia; com chat em andamento ela é pulada)`;
          tr.append(tdNome, el("td", "", u.sudo ? "sim" : "não"), el("td", "", u.meuBot ? "instalado" : "—"), tdBk, tdRamUso, tdPr, tdRam, tdCpu, tdUsado, tdLimite, tdPct, tdAcesso, tdAp);
          t.append(tr);
        }
        // Onze colunas não cabem numa janela estreita: a tabela rola de lado dentro do cartão em vez de vazar dele.
        const rolo = el("div", "usuarios-rolo"); rolo.append(t);
        lista.append(rolo);
      }
    }
    panel.append(lista);
  }

  return {
    open: () => {
      if (page === null) {
        const panel = el("section", "acervo-panel usuarios-panel"); panel.hidden = true; deps.panelsEl.append(panel);
        page = deps.definePage("usuarios", `Usuários · ${deps.who}`, panel, () => { render(); void ler(); });
        void sincronizar();
      }
      deps.openPage(page);
    },
  };
}
