/**
 * Handlers IPC comuns ao meu-bot e ao meu-bot-admin: leituras da máquina (WhatsApp, logins) e o que é só
 * deste Mac (configurações, memória, abrir o seletor). Nada aqui escreve na máquina da pessoa.
 */
import { app, dialog, Menu, nativeTheme, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { SettingsUpdate, SettingsView, WhatsappGroupMenuAction, WhatsappGroupPatch, WhatsappMenuAction } from "../../shared/ipc";
import { slugify } from "../conversa/export";
import { log } from "../maquina/backend";
import { whatsappChats, whatsappClearPlan, whatsappClearSessions, whatsappKeepPaused, whatsappExportBody, whatsappLearnNames, whatsappPause, whatsappSetMarks, whatsappStatus, whatsappThread, whatsappGroups, whatsappGroupClear, whatsappGroupClearPlan, whatsappGroupThread, whatsappRefreshGroups, whatsappSetGroup, whatsappGatewayOf, whatsappPausaModoOf } from "../whatsapp/whatsapp";
import { JID_RE } from "../whatsapp/whatsapp-grupos-core";
import { setNavWhatsapp } from "../navegador/navegador-whatsapp";
import { parseWaMarkPatches } from "../whatsapp/whatsapp-marks";
import { closeTerminal, openTerminal, ownedTerminal, replayTerminal, resizeTerminal, writeTerminal } from "../terminal/terminal";
import { isSupportAlias } from "../suporte/support-code";
import { registrar, registrarVarios } from "../auditoria/auditoria";
import { acaoDaMarca } from "../auditoria/auditoria-core";
import { applyUpdate, checkNow, updateState } from "../atualizacao/updater";
import { checkNow as netCheckNow, hostIsLocalAddr } from "../app/net";
import { claudeAuthInfo } from "../agente/claudeLogin";
import { xaiAuthInfo } from "../agente/xaiLogin";
import { contasStatus } from "../agente/contas-cli";
import { linkPublicoStatus } from "../agente/link-publico";
import { xaiKeyStatus } from "../agente/xaiKey";
import { closeTunnel } from "../maquina/tunnel";
import { anyConversationBusy } from "../conversa/conversation";
import { getBackendPort, getQuickEntry, settingsView, updateSettings } from "../app/settings";
import { applyQuickEntryShortcut } from "../app/quickEntry";
import { getMemory, NOTAS_MAX, PERFIL_MAX, setMemory } from "../conversa/memory";
import { knownModels, showPicker } from "../maquina/picker";
import { broadcast, sendToHost } from "../app/windows";
import { adotarContaDoMac, contaConectar, contaDesconectar, contaStatus, garantirFotoPerfil, onContaDesconectada } from "../google/conta-google";
import { garantirClientesGoogle } from "../google/cliente-release";
import { dispararDadosAoDrive, enviarDadosAoDrive, estadoDadosDrive, pastaBackupDados } from "../google/dados-drive";
import { definirSenhaBackup, limparSenhaBackup, temSenhaBackup } from "../google/senha-backup";
import { getDadosNoDrive, setDadosNoDrive } from "../app/settings";
import { agendaCriar, agendaProximos, gmailApagar, gmailLer, gmailListar, gmailRestaurar, planilhaEscrever, planilhaLer } from "../google/apis";
import { validaBusca, validaId, validaMax, validaPagina } from "../google/gmail-core";
import { gmailAgenteParar } from "../google/gmail-api";
import { changeWindowZoom, currentZoom } from "../app/zoom";
import { parseZoomAction } from "../app/zoom-core";
import { caps, compilacao } from "../app/variant";
import { whatsappArchiveToCrm, whatsappGroupArchiveToCrm } from "../crm/whatsapp-crm";
import { assertAcesso, assertCrmProprio } from "../licenca/acesso";
import { waGroupAgente, waGroupDeleted, waGroupMenuTemplate, waMenuState, waMenuTemplate, type WaMenuCaps, type WaMenuEntry } from "../whatsapp/wa-menu";
import { capacidadesDe } from "../whatsapp/whatsapp-capacidades";

/** O que o menu pode oferecer nesta máquina, pela tabela de capacidades (gateway visto na última consulta); desconhecido = menu completo. */
function waMenuCapsOf(host: string): WaMenuCaps | null {
  const gateway = whatsappGatewayOf(host);
  return gateway === null ? null : capacidadesDe(gateway, true, true, { pausaModo: whatsappPausaModoOf(host) });
}
import { EXTERNAL_URL, hostFromEvent, waJid, waNumber, windowFromEvent } from "./context";
import { handleShared, onShared } from "./registry";
import { estado as estadoDepuracao, modoDepuracao, setDepuracao } from "../app/depuracao";

export interface SharedIpcDeps {
  /** No meu-bot-admin: a pessoa dona da máquina e o apelido dela para ela (vem de admin/support-admin.ts; aqui só se injeta). */
  person: (host: string) => { name: string; machine: string | null } | null;
}

/** Versão + data do renderer.js empacotado: dois builds da mesma versão (dist local) não se confundem. */
let buildId: string | null = null;
function appBuildId(): string {
  if (buildId === null) {
    let stamp = "?";
    try { stamp = String(Math.trunc(fs.statSync(path.join(__dirname, "..", "..", "renderer", "renderer.js")).mtimeMs)); } catch { /* sem stamp: vale a versão */ }
    buildId = `${app.getVersion()}+${stamp}`;
  }
  return buildId;
}

export function registerSharedIpc(deps: SharedIpcDeps): void {
  handleShared("window:info", (event) => {
    const ctx = hostFromEvent(event);
    if (ctx === null) return null;
    const c = caps();
    const p = c.supportAdmin ? deps.person(ctx.host) : null;
    return { host: ctx.host, models: knownModels(ctx.host), caps: c, person: p?.name ?? null, machine: p?.machine ?? null, version: app.getVersion(), build: appBuildId(), depuracao: modoDepuracao(), compilacao: compilacao() };
  });
  // Zoom da janela (interface inteira): só de uma janela de máquina; payload fora do contrato é ignorado.
  handleShared("window:zoom", (event, action: unknown) => {
    if (hostFromEvent(event) === null) return currentZoom();
    const a = parseZoomAction(action);
    return a === null ? currentZoom() : changeWindowZoom(a);
  });
  handleShared("ui:open-picker", () => showPicker());
  // Modo de depuração (faixa no topo): estado com os últimos eventos, e ligar/desligar para todas as janelas.
  handleShared("depuracao:estado", () => estadoDepuracao());
  handleShared("depuracao:ligar", (_event, payload: unknown) => { const on = (payload as { on?: unknown } | null)?.on; return setDepuracao(on === true ? true : on === false ? false : null); });
  // Conta Google geral deste Mac (login + Gmail + Agenda + Sheets): conta do Mac, não vai à máquina (sem host/túnel).
  // Conta Google da máquina da janela (cada VM tem a sua; desconectar numa não mexe nas outras).
  const hostConta = (event: Electron.IpcMainInvokeEvent): string => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return h.host; };
  handleShared("google-conta:status", async (event, payload: unknown) => {
    const host = hostConta(event);
    // Build sem o client OAuth (config/google-*.json fora do git): busca na release antes de dizer "não configurado".
    let busca: string | null = null;
    if (!contaStatus(host).configurado) busca = await garantirClientesGoogle({ forcar: (payload as { forcar?: unknown } | null)?.forcar === true });
    // A foto pode faltar num token gravado antes do cache; busca em segundo plano e avisa quando entrar.
    void garantirFotoPerfil(host).then((r) => { if (r !== null) sendToHost(host, "google-conta:changed", r); }).catch(() => { /* sem foto a tela so fica sem avatar */ });
    return { ...contaStatus(host), busca };
  });
  // Conta Google é do plano Pro: conectar (ou adotar a conta antiga) passa pelo mesmo portão do Navegador.
  handleShared("google-conta:adotar-do-mac", async (event) => { const host = hostConta(event); await assertAcesso(host); const r = await adotarContaDoMac(host); sendToHost(host, "google-conta:changed", r); if (r.conectado && !r.precisaReconectar) dispararDadosAoDrive(); return r; });
  handleShared("google-conta:conectar", async (event) => {
    const host = hostConta(event); await assertAcesso(host); const r = await contaConectar(host); sendToHost(host, "google-conta:changed", r);
    if (r.conectado && !r.precisaReconectar) dispararDadosAoDrive(); // a cópia que falhou "sem conta" sai agora
    return r;
  });
  handleShared("google-conta:desconectar", async (event) => { const host = hostConta(event); const r = await contaDesconectar(host); gmailAgenteParar(host); sendToHost(host, "google-conta:changed", r); return r; });
  // O Google recusou renovar e o main apagou o token: as janelas da máquina viram "desconectada" na hora (a página E-mail
  // volta ao cartão com "Entrar com Google") e o agente do Gmail para, como no desconectar pela pessoa.
  onContaDesconectada((host) => { gmailAgenteParar(host); sendToHost(host, "google-conta:changed", contaStatus(host)); });
  // Cópia do CRM e do financeiro desta máquina no Drive da Conta Google: estado, "guardar agora" e o interruptor.
  handleShared("backup-dados:status", (event) => {
    const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida");
    return { ligado: getDadosNoDrive(), temSenha: temSenhaBackup(), ...estadoDadosDrive(h.host) };
  });
  handleShared("backup-dados:agora", async (event) => {
    const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida");
    return { ligado: getDadosNoDrive(), temSenha: temSenhaBackup(), ...(await enviarDadosAoDrive(h.host)) };
  });
  // Abre no Finder a pasta das cópias locais desta máquina. Cria se ainda não houver (primeira cópia não saiu).
  handleShared("backup-dados:abrir-pasta", async (event) => {
    const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida");
    const dir = pastaBackupDados(h.host);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const erro = await shell.openPath(dir);
    if (erro !== "") throw new Error(`não consegui abrir a pasta: ${erro}`);
    return { pasta: dir };
  });
  // Senha do pacote cifrado. O valor entra e nunca mais sai: o status só diz se existe.
  handleShared("backup-dados:senha", (event, payload: unknown) => {
    const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida");
    const p = (payload ?? {}) as { senha?: unknown; limpar?: unknown };
    if (p.limpar === true) limparSenhaBackup();
    else definirSenhaBackup(typeof p.senha === "string" ? p.senha : "");
    return { ligado: getDadosNoDrive(), temSenha: temSenhaBackup(), ...estadoDadosDrive(h.host) };
  });
  handleShared("backup-dados:ligar", (event, payload: unknown) => {
    const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida");
    setDadosNoDrive((payload as { ligado?: unknown } | null)?.ligado === true);
    return { ligado: getDadosNoDrive(), temSenha: temSenhaBackup(), ...estadoDadosDrive(h.host) };
  });
  // Página Gmail (31 out): recurso Pro, como a Conta Google. Ler e buscar valem com a autorização antiga; a lixeira
  // pede gmail.modify (GMAIL_SEM_PERMISSAO → a tela oferece Reconectar).
  const idDe = (payload: unknown): string => { const id = validaId((payload as { id?: unknown } | null)?.id); if (id === null) throw new Error("id de mensagem inválido"); return id; };
  handleShared("gmail:listar", async (event, payload: unknown) => {
    const host = hostConta(event); await assertAcesso(host);
    const p = (payload ?? {}) as Record<string, unknown>;
    return gmailListar(host, { busca: validaBusca(p["busca"]), max: validaMax(p["max"]), pagina: validaPagina(p["pagina"]) });
  });
  handleShared("gmail:ler", async (event, payload: unknown) => { const host = hostConta(event); await assertAcesso(host); return gmailLer(host, idDe(payload)); });
  handleShared("gmail:apagar", async (event, payload: unknown) => { const host = hostConta(event); await assertAcesso(host); return gmailApagar(host, idDe(payload)); });
  handleShared("gmail:restaurar", async (event, payload: unknown) => { const host = hostConta(event); await assertAcesso(host); return gmailRestaurar(host, idDe(payload)); });
  handleShared("google-conta:agenda", (event, payload: unknown) => { const d = (payload as { dias?: unknown } | null)?.dias; return agendaProximos(hostConta(event), typeof d === "number" ? d : 7); });
  handleShared("google-conta:agenda-criar", (event, payload: unknown) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    const s = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const titulo = s(p["titulo"], 200), inicio = s(p["inicio"], 40), fim = s(p["fim"], 40);
    if (titulo === "" || inicio === "" || fim === "") throw new Error("preencha título, início e fim");
    return agendaCriar(hostConta(event), { titulo, inicio, fim, ...(typeof p["descricao"] === "string" ? { descricao: p["descricao"].slice(0, 2000) } : {}) });
  });
  handleShared("google-conta:planilha-ler", (event, payload: unknown) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    const id = typeof p["id"] === "string" ? p["id"].trim() : ""; const intervalo = typeof p["intervalo"] === "string" ? p["intervalo"].trim().slice(0, 100) : "";
    if (!/^[A-Za-z0-9_-]{10,80}$/.test(id) || intervalo === "") throw new Error("informe o id da planilha e o intervalo (ex.: Página1!A1:C10)");
    return planilhaLer(hostConta(event), id, intervalo);
  });
  handleShared("google-conta:planilha-escrever", (event, payload: unknown) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    const id = typeof p["id"] === "string" ? p["id"].trim() : ""; const intervalo = typeof p["intervalo"] === "string" ? p["intervalo"].trim().slice(0, 100) : "";
    if (!/^[A-Za-z0-9_-]{10,80}$/.test(id) || intervalo === "") throw new Error("informe o id da planilha e o intervalo");
    const vs = Array.isArray(p["valores"]) ? (p["valores"] as unknown[]).slice(0, 1000).map((l) => (Array.isArray(l) ? l.slice(0, 50).map((c) => String(c ?? "")) : [])) : [];
    if (vs.length === 0) throw new Error("nada para gravar");
    return planilhaEscrever(hostConta(event), id, intervalo, vs);
  });
  handleShared("shell:open-external", (_event, payload: unknown) => {
    const url = (payload as { url?: unknown })?.url;
    if (typeof url === "string" && EXTERNAL_URL.test(url)) void shell.openExternal(url);
  });

  // Leituras da máquina desta janela.
  handleShared("whatsapp:status", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    // O áudio do Hermes (config.yaml) já vem no próprio whatsappStatus.
    const t0 = Date.now();
    return whatsappStatus(h.host).then((st) => { log(`[whatsapp] status de ${h.host}: ${st.gateway ?? "-"} ${st.state} connected=${st.connected} em ${Date.now() - t0} ms`); return st; });
  });
  handleShared("whatsapp:chats", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return whatsappChats(h.host);
  });
  handleShared("whatsapp:thread", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const number = (payload as { number?: unknown } | null)?.number;
    if (typeof number !== "string") throw new Error("número inválido");
    return whatsappThread(h.host, number);
  });
  handleShared("claude-login:auth", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return claudeAuthInfo(h.host);
  });
  handleShared("xai-login:auth", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return xaiAuthInfo(h.host); });
  handleShared("contas:status", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return contasStatus(h.host); });
  handleShared("link-publico:status", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return linkPublicoStatus(h.host); });
  handleShared("xai-key:status", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return xaiKeyStatus(h.host);
  });

  // Menu "…" da conversa do WhatsApp: os itens vêm de wa-menu.ts (puro); aqui só o Menu do Electron.
  handleShared("ui:wa-menu", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) return null;
    const entries = waMenuTemplate(waMenuState(payload), caps(), waMenuCapsOf(h.host));
    return new Promise<WhatsappMenuAction | null>((resolve) => {
      let settled = false;
      const pick = (action: WhatsappMenuAction | null): void => { if (!settled) { settled = true; resolve(action); } };
      const toItem = (e: WaMenuEntry): Electron.MenuItemConstructorOptions =>
        "separator" in e ? { type: "separator" }
          : "submenu" in e ? { label: e.label, submenu: e.submenu.map(toItem) }
            : { label: e.label, enabled: e.enabled, ...(e.action === null ? {} : { click: () => pick(e.action) }) };
      const menu = Menu.buildFromTemplate(entries.map(toItem));
      // O callback de fechamento corre antes do click; o adiamento deixa o click vencer.
      menu.popup({ window: h.win, callback: () => setTimeout(() => pick(null), 0) });
    });
  });
  // Grupos: a área "Grupos" da lista e o tutorial 11. As regras (nunca "*", nunca ligar sem quem aciona, desligar o
  // último fecha o canal de grupos) moram em whatsapp-grupos-core.ts; as mudanças vão para a auditoria.
  const waJid = (payload: unknown): string => {
    const jid = (payload as { jid?: unknown } | null)?.jid;
    if (typeof jid !== "string" || !JID_RE.test(jid)) throw new Error("grupo inválido");
    return jid;
  };
  handleShared("whatsapp:groups", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return whatsappGroups(h.host);
  });
  handleShared("whatsapp:group-thread", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return whatsappGroupThread(h.host, waJid(payload));
  });
  handleShared("whatsapp:group-set", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const jid = waJid(payload);
    const raw = (payload as { patch?: { agente?: unknown; quemAciona?: unknown } } | null)?.patch ?? {};
    const patch: WhatsappGroupPatch = {};
    if (raw.agente !== undefined) {
      if (raw.agente !== "desligado" && raw.agente !== "mencao" && raw.agente !== "sempre") throw new Error("modo inválido");
      patch.agente = raw.agente;
    }
    if (raw.quemAciona !== undefined) {
      if (raw.quemAciona === "todos") patch.quemAciona = "todos";
      else if (Array.isArray(raw.quemAciona) && raw.quemAciona.length <= 50 && raw.quemAciona.every((n) => typeof n === "string")) patch.quemAciona = raw.quemAciona as string[];
      else throw new Error("lista de números inválida");
    }
    const antes = await whatsappGroups(h.host);
    const depois = await whatsappSetGroup(h.host, jid, patch);
    const g = depois.grupos.find((x) => x.jid === jid);
    const alvo = g?.nome ?? jid;
    const era = antes.grupos.find((x) => x.jid === jid)?.agente ?? "desligado";
    const acoes: { acao: "whatsapp.grupo-ligar" | "whatsapp.grupo-desligar" | "whatsapp.grupo-quem"; alvo: string; detalhe: string }[] = [];
    if (g !== undefined && g.agente !== era) acoes.push(g.agente === "desligado" ? { acao: "whatsapp.grupo-desligar", alvo, detalhe: jid } : { acao: "whatsapp.grupo-ligar", alvo, detalhe: `${g.agente === "mencao" ? "só quando mencionado" : "sempre"} · ${jid}` });
    const quem = (q: string[] | "todos"): string => (q === "todos" ? "todos do grupo" : q.map((n) => `+${n}`).join(", "));
    if (quem(antes.quemAciona) !== quem(depois.quemAciona)) acoes.push({ acao: "whatsapp.grupo-quem", alvo: quem(depois.quemAciona), detalhe: `antes: ${quem(antes.quemAciona) || "ninguém"}` });
    void registrarVarios(h.host, acoes);
    if (quem(antes.quemAciona) !== quem(depois.quemAciona)) void setNavWhatsapp(h.host, "sincronizar").catch(() => undefined);
    return depois;
  });
  handleShared("whatsapp:groups-refresh", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return whatsappRefreshGroups(h.host);
  });
  handleShared("ui:wa-group-menu", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) return null;
    waJid(payload);
    return new Promise<WhatsappGroupMenuAction | null>((resolve) => {
      let settled = false;
      const pick = (action: WhatsappGroupMenuAction | null): void => { if (!settled) { settled = true; resolve(action); } };
      const menu = Menu.buildFromTemplate(waGroupMenuTemplate(waGroupAgente(payload), waMenuCapsOf(h.host), waGroupDeleted(payload)).map((e) => ("separator" in e ? { type: "separator" as const } : { label: e.label, click: () => pick(e.action) })));
      menu.popup({ window: h.win, callback: () => setTimeout(() => pick(null), 0) });
    });
  });
  handleShared("whatsapp:export", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const number = waNumber(payload);
    const format = (payload as { format?: unknown }).format;
    if (format !== "md" && format !== "json") throw new Error("formato inválido");
    const { name, body } = await whatsappExportBody(h.host, number, format);
    const result = await dialog.showSaveDialog(h.win, {
      title: "Exportar conversa do WhatsApp",
      defaultPath: path.join(app.getPath("documents"), `whatsapp-${slugify(name)}.${format}`),
      filters: format === "md" ? [{ name: "Markdown", extensions: ["md"] }] : [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || result.filePath === undefined || result.filePath === "") return null;
    fs.writeFileSync(result.filePath, body, { mode: 0o600 });
    return { path: result.filePath };
  });

  // Limpar o histórico de um contato (a confirmação é da tela, inline na lista).
  handleShared("whatsapp:clear-plan", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const { own, shared } = await whatsappClearPlan(h.host, waNumber(payload));
    return { own: own.length, shared: shared.length };
  });
  // Com o CRM próprio liberado na máquina: antes de limpar, a conversa vai para o CRM (a tela só limpa depois que isto der certo).
  handleShared("whatsapp:archive-crm", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    await assertCrmProprio(h.host);
    const r = await whatsappArchiveToCrm(h.host, waNumber(payload));
    if (!r.vazio) void registrar(h.host, "crm.guardar-conversa", `+${waNumber(payload)}`, r.box !== null ? `caixa ${r.box.nome}` : "no contato");
    return r;
  });
  // A confirmação é da tela (inline na lista). Zerar a principal só com `includeShared`: se ela apareceu
  // depois que a pessoa confirmou só a sessão do contato, recusa em vez de zerar sem aviso.
  handleShared("whatsapp:clear", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const includeShared = (payload as { includeShared?: unknown }).includeShared === true;
    const { own, shared, paused } = await whatsappClearPlan(h.host, waNumber(payload));
    if (shared.length > 0 && !includeShared) throw new Error("a conversa mudou; abra Limpar histórico de novo");
    if (own.length + shared.length === 0) throw new Error("não há histórico desta conversa na máquina");
    // Pausado continua pausado depois de limpar: a pausa vai para a lista durável antes do reset.
    if (paused) await whatsappKeepPaused(h.host, waNumber(payload), own);
    await whatsappClearSessions(h.host, [...own, ...shared]);
    // Registro de auditoria: quem limpou (o dono ou o admin pelo nome); a pessoa vê o que o suporte fez.
    void registrar(h.host, "whatsapp.limpar", `+${waNumber(payload)}`);
  });

  // Grupos: mesmo trio do contato (plano › guardar no CRM › limpar). Grupo não tem contato único: a máquina abre
  // a caixa fixa dele no pipeline padrão na primeira vez e reaproveita depois; sem pipeline padrão nada é limpo.
  handleShared("whatsapp:group-clear-plan", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return whatsappGroupClearPlan(h.host, waJid(payload));
  });
  handleShared("whatsapp:group-archive-crm", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    await assertCrmProprio(h.host);
    const jid = waJid(payload);
    const r = await whatsappGroupArchiveToCrm(h.host, jid);
    if (!r.vazio) void registrar(h.host, "crm.guardar-conversa", jid, r.box !== null ? `caixa ${r.box.nome}${r.criada ? " (aberta agora)" : ""}` : "grupo");
    return r;
  });
  handleShared("whatsapp:group-clear", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const jid = waJid(payload);
    await whatsappGroupClear(h.host, jid);
    void registrar(h.host, "whatsapp.limpar", jid);
  });
  // Excluir/restaurar um grupo na lista: só a marca na máquina (whatsapp-lista.json), como na conversa; o openclaw.json
  // não muda e o agente continua como está. Volta sozinho quando o agente recebe mensagem nova do grupo.
  handleShared("whatsapp:group-mark", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const jid = waJid(payload);
    const p = payload as { deleted?: unknown; alias?: unknown };
    // Apelido: só a vista (os dois apps), nunca o WhatsApp nem o agente; "" apaga.
    if (typeof p.alias === "string") {
      const alias = p.alias.replace(/\s+/g, " ").trim().slice(0, 80);
      await whatsappSetMarks(h.host, [{ jid, alias }]);
      return;
    }
    const deleted = p.deleted === true;
    await whatsappSetMarks(h.host, [{ jid, deleted }]);
    void registrar(h.host, deleted ? "whatsapp.grupo.excluir" : "whatsapp.grupo.restaurar", jid);
  });

  // Pausar/retomar o agente para um contato.
  handleShared("whatsapp:pause", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const paused = (payload as { paused?: unknown }).paused === true;
    // Prazo só com pausar (2 ou 24 h); fora disso, até retomar. A máquina calcula o fim com o relógio dela.
    const h0 = (payload as { horas?: unknown }).horas;
    const horas = paused && (h0 === 2 || h0 === 24) ? h0 : undefined;
    await whatsappPause(h.host, waNumber(payload), paused, caps().supportAdmin ? "admin" : "dono", horas);
    void registrar(h.host, paused ? "whatsapp.pausar" : "whatsapp.retomar", `+${waNumber(payload)}`, paused ? (horas === undefined ? "até retomar" : `por ${horas} h`) : "");
  });

  // Arquivar/desarquivar/excluir conversas: a marcação mora na máquina (whatsapp-lista.json), então o meu-bot da
  // pessoa e o meu-bot-admin veem a mesma lista. Vai para o registro de auditoria (a migração e o cache de nomes não).
  handleShared("whatsapp:mark", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const patches = parseWaMarkPatches(payload);
    await whatsappSetMarks(h.host, patches);
    // Uma linha por contato (excluir em massa também); migração (com `at`) e cache de nomes ficam de fora.
    const acoes = patches.flatMap((p) => { const acao = acaoDaMarca(p); return acao === null ? [] : [{ acao, alvo: `+${p.number}`, detalhe: p.alias !== undefined ? `apelido "${p.alias}"` : patches.length > 1 ? `em massa (${patches.length})` : "" }]; });
    void registrarVarios(h.host, acoes);
  });

  // Nomes dos contatos sem nome: lê o histórico deles de uma vez e guarda na máquina (cache; não é ação de suporte).
  handleShared("whatsapp:names", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const list = (payload as { numbers?: unknown } | null)?.numbers;
    if (!Array.isArray(list) || list.length === 0 || list.length > 20 || !list.every((n) => typeof n === "string")) throw new Error("números inválidos");
    return whatsappLearnNames(h.host, list as string[]);
  });

  // Terminal: sessões presas à janela que as abriu. Entrada e resize sem resposta (uma por tecla). Os dois
  // apps: no meu-bot-admin a pessoa vê no registro dela que o suporte abriu um terminal.
  handleShared("term:open", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const p = payload as { cols?: unknown; rows?: unknown } | null;
    const id = await openTerminal(h.win, h.host, typeof p?.cols === "number" ? p.cols : 80, typeof p?.rows === "number" ? p.rows : 24);
    if (caps().supportAdmin && isSupportAlias(h.host)) void registrar(h.host, "terminal.abrir");
    return { id };
  });
  const termOf = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, payload: unknown) => {
    const win = windowFromEvent(event);
    const id = (payload as { id?: unknown } | null)?.id;
    return win === null || typeof id !== "string" ? null : ownedTerminal(id, win.id);
  };
  onShared("term:input", (event, payload: unknown) => {
    const s = termOf(event, payload);
    const data = (payload as { data?: unknown }).data;
    if (s !== null && (typeof data === "string" || data instanceof Uint8Array)) writeTerminal(s, data);
  });
  onShared("term:resize", (event, payload: unknown) => {
    const s = termOf(event, payload);
    const p = payload as { cols?: unknown; rows?: unknown };
    if (s !== null && typeof p.cols === "number" && typeof p.rows === "number") resizeTerminal(s, p.cols, p.rows);
  });
  handleShared("term:close", (event, payload: unknown) => { const s = termOf(event, payload); if (s !== null) closeTerminal(s); });
  handleShared("term:replay", (event, payload: unknown) => { const s = termOf(event, payload); return s === null ? new Uint8Array() : replayTerminal(s); });

  // Atualização automática do próprio app.
  handleShared("update:state", () => updateState());
  handleShared("update:check", () => checkNow("explicito"));
  handleShared("net:check", (_event, payload: unknown) => netCheckNow((payload as { force?: unknown } | null)?.force === true));
  handleShared("host:local-addr", (event) => { const h = hostFromEvent(event)?.host; return h === undefined ? false : hostIsLocalAddr(h); });
  // "Reiniciar e atualizar": só da janela de uma máquina, e só para a versão que o botão mostrou.
  handleShared("update:apply", (event, payload: unknown) => {
    if (hostFromEvent(event) === null) throw new Error("origem inválida");
    const v = (payload as { expectedVersion?: unknown } | null)?.expectedVersion;
    if (typeof v !== "string" || v === "") throw new Error("versão esperada inválida");
    return applyUpdate(v, "clique");
  });

  // Configurações e memória: deste Mac, valem para os dois apps.
  // Abrir ao entrar no Mac: o sistema é a fonte da verdade (a pessoa pode mudar nos Ajustes); só o app empacotado se registra.
  const withLogin = (v: SettingsView): SettingsView => ({ ...v, openAtLogin: app.isPackaged && app.getLoginItemSettings().openAtLogin, openAtLoginAvailable: app.isPackaged });
  handleShared("settings:get", (event) => withLogin(settingsView(hostFromEvent(event)?.host)));
  handleShared("settings:set", (event, update: unknown) => {
    const host = hostFromEvent(event)?.host;
    const u = (update ?? {}) as SettingsUpdate;
    const clean: SettingsUpdate = {
      ...(typeof u.backendModel === "string" ? { backendModel: u.backendModel } : {}),
      ...(typeof u.backendModelForHost === "string" ? { backendModelForHost: u.backendModelForHost } : {}),
      ...(typeof u.backendPort === "number" ? { backendPort: u.backendPort } : {}),
      ...(typeof u.backendPortForHost === "number" ? { backendPortForHost: u.backendPortForHost } : {}),
      ...(typeof u.theme === "string" ? { theme: u.theme } : {}),
      ...(typeof u.notifications === "boolean" ? { notifications: u.notifications } : {}),
      ...(typeof u.openAtLogin === "boolean" ? { openAtLogin: u.openAtLogin } : {}),
      ...(typeof u.atualizarOcioso === "boolean" ? { atualizarOcioso: u.atualizarOcioso } : {}),
      ...(typeof u.abaFixa === "string" ? { abaFixa: u.abaFixa as NonNullable<SettingsUpdate["abaFixa"]> } : {}),
      ...(typeof u.contextBudgetTokens === "number" ? { contextBudgetTokens: u.contextBudgetTokens } : {}),
      ...(typeof u.memoryEveryTurns === "number" ? { memoryEveryTurns: u.memoryEveryTurns } : {}),
      ...(typeof u.quickEntryEnabled === "boolean" ? { quickEntryEnabled: u.quickEntryEnabled } : {}),
      ...(typeof u.quickEntryShortcut === "string" ? { quickEntryShortcut: u.quickEntryShortcut } : {}),
      ...(u.onboarding === "done" || u.onboarding === "skipped" || u.onboarding === "pending" ? { onboarding: u.onboarding } : {}),
    };
    // Porta nova derruba o túnel (todos, se é a padrão; só o desta máquina, se é a dela), o que cortaria uma
    // resposta em andamento; recusa até ficar ocioso.
    const defaultPortChanges = clean.backendPort !== undefined && clean.backendPort !== getBackendPort();
    const hostPortChanges = host !== undefined && clean.backendPortForHost !== undefined && clean.backendPortForHost !== getBackendPort(host);
    const portChanges = defaultPortChanges || hostPortChanges;
    if (portChanges && anyConversationBusy()) {
      throw new Error("Há uma resposta em andamento. Espere terminar antes de trocar a porta.");
    }
    const view = updateSettings(clean, host);
    // A entrada rápida é do chat: o meu-bot-admin não registra o atalho global.
    if (caps().chat) { const qe = getQuickEntry(); applyQuickEntryShortcut(qe.enabled, qe.shortcut); }
    nativeTheme.themeSource = view.theme;
    if (defaultPortChanges) closeTunnel(); else if (hostPortChanges) closeTunnel(host);
    // Outras janelas (fonte, tema, notificações…): cada uma recebe a visão com o modelo da sua máquina.
    broadcast("settings:changed", settingsView());
    if (clean.openAtLogin !== undefined && app.isPackaged) app.setLoginItemSettings({ openAtLogin: clean.openAtLogin });
    return withLogin(view);
  });

  const memoryView = () => ({ ...getMemory(), limits: { notas: NOTAS_MAX, perfil: PERFIL_MAX } });
  handleShared("memory:get", () => memoryView());
  handleShared("memory:set", (_event, payload: unknown) => {
    const p = (payload ?? {}) as { notas?: unknown; perfil?: unknown };
    setMemory({
      ...(typeof p.notas === "string" ? { notas: p.notas } : {}),
      ...(typeof p.perfil === "string" ? { perfil: p.perfil } : {}),
    });
    const view = memoryView();
    broadcast("memory:changed", view);
    return view;
  });
}
