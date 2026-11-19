/**
 * Arranque do app: instância única, argumentos (atalhos da mesa), menu, seletor, entrada rápida, túneis e
 * energia. Os handlers IPC moram em ipc/ (comuns e do meu-bot normal) e admin/ (meu-bot-admin); aqui só se
 * compõe: registerIpc, initPicker e o que depende da variante (caps()).
 */
import { ligarDepuracao } from "./app/depuracao";
import { app, BrowserWindow, dialog, nativeTheme, powerMonitor } from "electron";
import { onVersaoMinima } from "./maquina/backend";
import { LOCAL_HOST } from "./maquina/localBackend";
import { closeTunnel, ehSemBackend, ensureTunnel, log, markSuspect, onTunnelState, revalidate } from "./maquina/tunnel";
import { loadConversations } from "./conversa/conversation";
import { getAceleracaoHardware, getLastHost, getQuickEntry, getTheme, loadSettings, setLastHost, setQuickEntryStatusProvider } from "./app/settings";
import { applyQuickEntryShortcut, disposeQuickEntry, initQuickEntry, quickEntryStatus } from "./app/quickEntry";
import { loadMemory } from "./conversa/memory";
import { appVariant, caps, produto, userDataName } from "./app/variant";
import { personInfo } from "./admin/support-admin";
import { adminPickerSource } from "./admin/picker-source";
import { migrateAdminPessoas } from "./admin/user-data";
import { herdarDe, useVariantUserData, fundirDe, relatorioFusao } from "./app/user-data";
import { registerIpc } from "./ipc/index";
import { applyStagedOnQuit, onAntesDeRelancar, onAntesDeVoltar, onExigeSuper, applyUpdate as applyUpdateNow, atualizarAgora as atualizarAgoraNow, checkIfStale as checkUpdateIfStale, checkNow as checkUpdateNow, disposeUpdater, initUpdater, lastUpdateErrorWasNetwork, noteVersaoMinima, onUpdateState, updateMenuState } from "./atualizacao/updater";
import { checkNow as checkNetNow, disposeNet, initNet, onBackOnline } from "./app/net";
import { installBrowserHooks } from "./navegador/browser";
import { startTermApi } from "./terminal/term-api";
import { startControleRemoto, stopControleRemoto } from "./controle-remoto/controle-remoto";
import { limparSessaoAntiga, pararInspector } from "./inspector/inspector";
import { getBackendPort, getControleRemoto, guardarAntesDeVoltar } from "./app/settings";
import { installAppMenu, refreshAppMenu } from "./app/menu";
import { changeWindowZoom } from "./app/zoom";
import { clientPickerSource, hostPadraoAtual, initPicker, podeAbrirMaquina, seletorPodeAbrirAgora, showPicker } from "./maquina/picker";
import { registerUsuariosMacIpc, showUsuariosMac } from "./usuarios-mac/usuarios-mac-janela";
import { hostFromArgv, reliefHostFromArgv } from "./app/shortcuts";
import { initRelief, showRelief } from "./app/relief";
import { listSshHosts } from "./maquina/sshConfig";
import { allMainWindows, broadcast, disposeWindows, getLastFocusedHost, hostOfWindow, lastFocusedWindow, openMainWindow, sendToHost, sendWhenLoaded } from "./app/windows";
import { esquemaDe } from "./app/variant-core";
import { aoReceberUrl, instalarOpenUrl, registrarEsquema, tratarArgv } from "./conta/deep-link";
import { parseLinkConfiguracoes } from "./conta/deep-link-core";
import { aoRetornarAuth, aoRetorno, aoSair, contaEntrada, papelConfirmado } from "./conta/conta";

// Cada produto além do meu-bot tem userData próprio (senão dividiria pasta e trava de instância). Antes de tudo.
// O admin traz o pessoas.json antigo; um produto da pessoa (meu-bot-finance-staging…) nasce como cópia do meu-bot dela.
{ const ud = userDataName(); const de = produto().herdaDe; if (ud !== null) useVariantUserData(ud, caps().supportAdmin ? migrateAdminPessoas : de !== null ? herdarDe(de, produto().abreEm !== null) : undefined); }
// O meu-bot adota a pasta do antigo meu-bot-crm (uma vez; a origem fica como backup). Depois de herdar, antes de ler qualquer coisa.
{ const fd = produto().fundeDe; if (fd !== null && !app.commandLine.hasSwitch("user-data-dir")) fundirDe(fd)(app.getPath("userData"), app.getPath("appData")); }

// `app.disableHardwareAcceleration()` só vale ANTES do ready, então as configurações são lidas aqui, logo depois de
// a pasta de dados estar decidida. `loadSettings` é idempotente: o whenReady torna a chamar sem efeito colateral.
loadSettings();
if (!getAceleracaoHardware()) app.disableHardwareAcceleration();

// Staging (recompilado várias vezes por dia): o Chromium não guarda a chave dos cookies no Keychain. Com assinatura
// própria (sem Team ID da Apple) cada build é "outro app" para o macOS e o pedido de senha voltava a cada rebuild,
// mesmo com "Permitir Sempre". Produção segue no Keychain até haver certificado Apple. Custo em staging, uma vez na
// troca: os logins do Navegador e o que o safeStorage guardou (Google, Tailscale) precisam ser refeitos.
if (appVariant().endsWith("-staging")) app.commandLine.appendSwitch("use-mock-keychain");

// Esquema do deep link do login da conta (`meu-bot://auth?…`, um por produto). O `open-url` do macOS precisa estar
// ligado antes do `ready`: com o app fechado, o clique no link o abre e o evento chega ainda no arranque.
const ESQUEMA = esquemaDe(produto());
instalarOpenUrl(ESQUEMA);

// Uma instância só: abrir o app de novo (Dock, Finder, `open -a`) mostra o seletor de máquinas; chegando pelo deep
// link do login (Windows/Linux: a URL vem nos argumentos da instância nova), só o retorno é tratado, sem seletor.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => { if (!tratarArgv(argv, ESQUEMA)) openFromArgs(argv); });
}

/** `--host=<x>` abre a janela da máquina direto (atalho da mesa); qualquer outra coisa abre o seletor. */
function openFromArgs(argv: readonly string[]): void {
  // meu-bot-admin-mac: o app é só a janela das contas deste Mac.
  if (caps().usuariosMac) { showUsuariosMac(); return; }
  const relief = reliefHostFromArgv(argv);
  if (relief !== null) { showRelief(relief); return; }
  const host = hostFromArgv(argv);
  if (host === null) { showPicker(); return; }
  // Portão da conta: sem sessão neste Mac, o atalho da mesa cai no seletor (que abre no cartão de login).
  if (!contaEntrada()) { showPicker({ preselect: host }); return; }
  // Gestão: conta sem papel de admin não abre máquina nem pelo atalho; o seletor diz por quê.
  if (!podeAbrirMaquina()) { showPicker(); return; }
  if ((host !== LOCAL_HOST || !caps().hostLocal) && !listSshHosts().includes(host)) { showPicker({ error: `A máquina "${host}" do atalho não está no ~/.ssh/config.`, preselect: host }); return; }
  setLastHost(host);
  openMainWindow(host, "shortcut");
}

app.whenReady().then(() => {
  loadSettings();
  nativeTheme.themeSource = getTheme();
  loadMemory();
  loadConversations();
  registerIpc({ person: personInfo });
  // Aviso único depois de adotar a pasta do antigo meu-bot-crm: o que veio e o que precisa ser refeito.
  if (relatorioFusao !== null) {
    const r = relatorioFusao;
    void dialog.showMessageBox({ type: "info", title: "meu-bot", message: `Trouxe o que você tinha no ${r.origem}.`, detail: `${r.conversas} ${r.conversas === 1 ? "conversa veio" : "conversas vieram"} junto, com favoritos, memória e preferências. O CRM no Gmail abre com o seu plano. Só o login do Google (tutorial 15) e os logins do Navegador precisam ser refeitos uma vez. A pasta do ${r.origem} ficou intacta, como cópia de segurança.`, buttons: ["Entendi"] });
  }
  installAppMenu({
    openPicker: () => { if (caps().usuariosMac) showUsuariosMac(); else showPicker(); },
    toggleSettings: () => {
      // Só as janelas de máquina têm Configurações; seletor e alívio ignoram.
      const win = BrowserWindow.getFocusedWindow() ?? lastFocusedWindow();
      if (win !== null && !win.isDestroyed() && hostOfWindow(win) !== undefined) win.webContents.send("ui:toggle-settings", {});
    },
    zoom: (action) => { changeWindowZoom(action); },
    abrir: (oQue) => {
      const win = BrowserWindow.getFocusedWindow() ?? lastFocusedWindow();
      if (win !== null && !win.isDestroyed() && hostOfWindow(win) !== undefined) win.webContents.send("ui:abrir", { oQue });
    },
    atualizacao: {
      estado: updateMenuState,
      verificar: () => { void checkUpdateNow("explicito"); },
      atualizarAgora: () => { void atualizarAgoraNow().catch((e: unknown) => log(`[atualização] "Atualizar agora" pelo menu: ${e instanceof Error ? e.message : String(e)}`)); },
      aplicar: (versao) => { void applyUpdateNow(versao, "clique").catch((e: unknown) => log(`[atualização] pelo menu: ${e instanceof Error ? e.message : String(e)}`)); },
    },
  });
  // O Electron não tem item de menu reativo: o menu se refaz a cada mudança para "Reiniciar para atualizar" aparecer.
  onUpdateState(refreshAppMenu);
  initPicker(caps().supportAdmin ? adminPickerSource : clientPickerSource);
  if (caps().usuariosMac) registerUsuariosMacIpc();
  initRelief();
  initUpdater();
  // A troca sai por app.exit (sem will-quit): o backend local e o proxy da xAI deste Mac fecham antes, senão ficam
  // órfãos segurando a porta e o app reaberto não sobe os dele.
  onAntesDeRelancar(() => { closeTunnel(); });
  // Escolher a versão (super admin): o papel vem do servidor na hora; voltar guarda as configurações que a velha apagaria.
  onExigeSuper(async () => {
    const p = await papelConfirmado();
    if (p === null) throw new Error("não consegui confirmar a sua conta agora (entre na conta e confira a internet)");
    if (p.admin !== "super") throw new Error("só um super admin pode escolher a versão do app");
    return p.email;
  });
  onAntesDeVoltar(guardarAntesDeVoltar);
  // O backend de cada máquina diz no hello a versão mínima do app que atende: abaixo dela, a janela bloqueia até atualizar.
  onVersaoMinima(noteVersaoMinima);
  // Internet deste Mac (faixa OFFLINE). Quando volta: revalida os túneis, reabre o das janelas abertas que
  // caíram e refaz a checagem de atualização se ela falhou por rede.
  initNet();
  installBrowserHooks();
  if (caps().controleRemoto) void startTermApi().catch((e: unknown) => { log(`[terminal] controle local não subiu: ${e instanceof Error ? e.message : String(e)}`); });
  // Controle remoto (MCP): só se a pessoa ligou em Configurações; porta ocupada fica como erro no estado, não derruba nada.
  if (caps().inspector) limparSessaoAntiga(); // execução anterior que caiu: a chave do MCP não fica no disco
  if (caps().controleRemoto && getControleRemoto().ligado) void startControleRemoto().catch((e: unknown) => { log(`[mcp] não subiu: ${e instanceof Error ? e.message : String(e)}`); });
  onBackOnline(() => {
    markSuspect(); void revalidate();
    const hosts = new Set(allMainWindows().map((w) => hostOfWindow(w)).filter((h): h is string => h !== undefined && h !== LOCAL_HOST));
    // Só onde a janela usa túnel (o mesmo caps().tunnel do pré-aquecimento): no admin, reabrir aqui dava "túnel: erro"
    // na barra das pessoas sem o nosso backend (o este Mac, 10 nov 2026), sem nada que precisasse dele.
    if (caps().tunnel) for (const h of hosts) void ensureTunnel(h, getBackendPort(h)).catch(() => { /* a próxima mensagem tenta de novo */ });
    if (lastUpdateErrorWasNetwork()) void checkUpdateNow("rede-voltou");
  });
  // A entrada rápida é do chat: o meu-bot-admin não a sobe nem registra o atalho global.
  if (caps().chat) {
    setQuickEntryStatusProvider(quickEntryStatus);
    initQuickEntry({
      // Sem janela e sem máquina nenhuma (só onde o host "local" não é oferecido): o seletor abre no lugar.
      mainWindow: () => { const w = lastFocusedWindow(); if (w !== null) return w; const host = getLastFocusedHost() ?? getLastHost() ?? hostPadraoAtual(); if (host === null) { showPicker(); return null; } return openMainWindow(host, "quick"); },
      hostLabel: (win) => { const h = hostOfWindow(win) ?? "?"; return h === LOCAL_HOST ? "este Mac" : h; },
    });
    const qe = getQuickEntry();
    applyQuickEntryShortcut(qe.enabled, qe.shortcut);
  }
  // Deep link do login da conta: registra o esquema e passa a ouvir as URLs (as que chegaram antes saem agora);
  // conta.ts confere o state e troca o code pela sessão.
  registrarEsquema(ESQUEMA);
  // `meu-bot://app/v1/settings?id=sobre` (molde do Grok Bot): abre as Configurações da janela em uso naquela seção;
  // sem janela de máquina, reabre a última; sem nenhuma, o seletor. Qualquer outra URL é o retorno do login.
  aoReceberUrl((url) => {
    const cfg = parseLinkConfiguracoes(url, ESQUEMA);
    if (cfg === null) { void aoRetornarAuth(url); return; }
    log(`[deep link] configurações: id "${cfg.id}" → ${cfg.grupo ?? "sem seção"}`);
    const focada = BrowserWindow.getFocusedWindow() ?? lastFocusedWindow();
    const ultimo = getLastFocusedHost();
    const win = focada !== null && !focada.isDestroyed() && hostOfWindow(focada) !== undefined ? focada : ultimo !== null ? openMainWindow(ultimo, "shortcut") : null;
    if (win === null) { showPicker(); return; }
    if (win.isMinimized()) win.restore();
    win.show(); win.focus(); app.focus({ steal: true });
    sendWhenLoaded(win, "ui:settings", { grupo: cfg.grupo });
  });
  // Saiu da conta (ou a API derrubou a sessão): as janelas de máquina fecham e o seletor volta, no cartão de login.
  aoSair(() => { if (caps().usuariosMac) return; for (const w of allMainWindows()) w.close(); showPicker(); });
  // A pessoa estava no navegador e clicou em "Abrir o meu-bot" (ou o login concluiu): o app vem para a frente, na
  // janela que estava em uso; sem janela de máquina, o seletor.
  aoRetorno(() => {
    const w = lastFocusedWindow();
    if (w !== null && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } else showPicker();
    app.focus({ steal: true });
  });
  // Abertura: pelo seletor (Enter reabre a última máquina), ou direto na máquina de um atalho; no Windows/Linux a
  // URL do deep link também pode vir aqui.
  openFromArgs(process.argv);
  tratarArgv(process.argv, ESQUEMA);
  // Modo de depuração: o tique de 1 s do main para a faixa da janela (ligado no staging, pela paleta ou --depuracao).
  ligarDepuracao(broadcast);
  // Clicar no app (Dock, Finder) abre sempre o seletor; para ir direto a uma máquina existe o atalho dela. O clique numa
  // notificação também dispara `activate` no macOS: aí não (ele abre a janela da máquina e foca a conversa).
  app.on("activate", () => { if (!seletorPodeAbrirAgora()) return; if (caps().usuariosMac) showUsuariosMac(); else showPicker(); });

  // Estado do túnel de cada máquina vai para a janela dela.
  onTunnelState((host, state, detail) => {
    const mapped = state === "ready" ? "ready" : state === "error" ? "error" : state === "degraded" ? "degraded" : state === "connecting" ? "connecting" : "idle";
    sendToHost(host, "backend:status", { host, state: mapped, detail: state === "ready" ? "túnel ativo" : detail, ...(state === "error" && ehSemBackend(detail) ? { semBackend: true } : {}) });
  });

  // O Mac dormiu/acordou: revalida os túneis antes de confiar neles.
  let resumeTimer: NodeJS.Timeout | null = null;
  const scheduleRevalidate = (): void => {
    if (resumeTimer !== null) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => { resumeTimer = null; void revalidate(); }, 2000);
  };
  powerMonitor.on("suspend", () => markSuspect());
  powerMonitor.on("resume", () => { scheduleRevalidate(); void checkNetNow(true); checkUpdateIfStale("acordou"); });
  powerMonitor.on("unlock-screen", () => { scheduleRevalidate(); void checkNetNow(true); checkUpdateIfStale("acordou"); });
});

app.on("window-all-closed", () => {
  // No macOS o app fica no Dock; clicar nele reabre o seletor. Os túneis caem pela carência.
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => { pararInspector(); stopControleRemoto(); disposeNet(); disposeUpdater(); disposeQuickEntry(); disposeWindows(); closeTunnel(); applyStagedOnQuit(); });
