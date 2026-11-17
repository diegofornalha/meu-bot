import { licenseSummary, deviceLine } from "../lib/admin-view.js";
import { byId as $, el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { ctx } from "../app/ctx.js";
import { paintEspaco } from "./espaco.js";
import { carregarControleRemoto, ligarControleRemoto } from "./controle-remoto.js";
import { aoMudarConta, blocoConta, contaAtual } from "../conta/conta.js";

function openSettings(): void {
  if (ctx.dialog.open) return;
  ctx.paintSupport(); void ctx.refreshSupportState(); void loadAlertPrefs(); paintEspaco(ctx.account?.cota); carregarControleRemoto();
  void window.meuBot.updateState().then(ctx.paintUpdateState).catch(() => undefined);
  ctx.settingsError.hidden = true;
  for (const g of ctx.settingsGroups) g.open = false;
  ctx.dialog.showModal();
}

/* ---------- Primeira notificação no momento certo (o botão "Enviar uma notificação de teste" saiu das Configurações em 30 out 2026) ---------- */
/** Primeira notificação desta instalação no momento certo (WhatsApp pareado e testado): o macOS pede a permissão junto. */
export function maybeAskNotificationsOnce(): void {
  if (!ctx.caps.chat || ctx.settings?.notifications !== true) return;
  try { if (localStorage.getItem("notif:asked") === "1") return; localStorage.setItem("notif:asked", "1"); } catch { return; }
  void window.meuBot.notifyTest().catch(() => undefined);
}

/* ---------- Segurança (REA do Rambox): aviso quando um Mac novo usar o meu-bot desta máquina ---------- */
const alertsGroup = $<HTMLElement>("alerts-group");
const alertWa = $<HTMLInputElement>("alert-wa");
const alertsHint = $<HTMLElement>("alerts-hint");
let alertPrefsLoaded: { whatsapp: boolean } | null = null;
/**
 * Grupo "Sua conta" (lado da pessoa), o último das Configurações e recolhido como os outros: plano, status, membro
 * desde, ciclo e os devices da conta, só leitura, como as telas de billing do Rambox. Quem muda isso é o admin
 * (pela página Suporte). O grupo é fixo no HTML; aqui só o corpo e o resumo da linha do título.
 */
const licensePanel = $<HTMLDetailsElement>("license-panel");
const licenseBody = $<HTMLElement>("license-body");
const licenseSum = $<HTMLElement>("license-sum");
async function loadLicensePanel(): Promise<void> {
  // A conta meu-bot é deste Mac: aparece em toda janela da pessoa (também em "este Mac"). A licença abaixo é da máquina.
  if (!ctx.caps.chat) { licensePanel.hidden = true; return; }
  licensePanel.hidden = false;
  const conta = contaAtual();
  const contaTxt = conta !== null && conta.situacao === "dentro" && conta.conta !== null ? conta.conta.email : "entrar";
  const bloco = blocoConta();
  if (ctx.windowHost === "local") { licenseSum.textContent = contaTxt; licenseBody.replaceChildren(bloco); return; }
  const view = await ctx.refreshLicense();
  if (view === null) { licenseSum.textContent = `${contaTxt} · plano e devices`; licenseBody.replaceChildren(bloco, el("p", "hint strong-hint", "Licença desta máquina"), el("p", "hint", "A máquina ainda não tem o backend novo: reinstale o backend para ver o plano e os devices.")); return; }
  const l = view.license;
  licenseSum.textContent = `${contaTxt} · ${l.plan === "pro" ? "Pro" : "Free"} · ${view.devices.length} device${view.devices.length === 1 ? "" : "s"}`;
  const ul = el("ul", "admin-health");
  for (const line of licenseSummary(view, Date.now(), ctx.caps.addons)) ul.append(el("li", line.ok === null ? "" : line.ok ? "ok" : "bad", line.text));
  const devs = el("ul", "admin-health");
  for (const d of view.devices) { const dl = deviceLine(d); devs.append(el("li", d.status === "pending" ? "bad" : "ok", d.status === "pending" ? `${dl.text} · pedido enviado ao admin` : dl.text)); }
  if (view.devices.length === 0) devs.append(el("li", "", "Nenhum device ainda."));
  licenseBody.replaceChildren(bloco, el("p", "hint strong-hint", "Licença desta máquina"), ul, el("p", "hint strong-hint", "Seus devices"), devs);
}
async function loadAlertPrefs(): Promise<void> {
  void loadLicensePanel();
  if (!ctx.caps.chat || ctx.windowHost === "local") { alertsGroup.hidden = true; return; }
  alertsGroup.hidden = false;
  try {
    alertPrefsLoaded = await window.meuBot.alertPrefs();
    if (alertPrefsLoaded === null) { alertsHint.textContent = "A máquina ainda não tem o backend novo: reinstale o backend para ligar os avisos."; alertWa.disabled = true; return; }
    // Por enquanto o aviso é sempre ligado (o interruptor fica travado): uma máquina que estava desligada liga de novo.
    if (!alertPrefsLoaded.whatsapp) { const next = { whatsapp: true }; await window.meuBot.setAlertPrefs(next); alertPrefsLoaded = next; }
    alertWa.checked = true; alertWa.disabled = true;
    alertsHint.textContent = "O aviso vai pelo seu próprio número, já pareado nesta máquina. Por enquanto, sempre ligado.";
  } catch (err) { alertsHint.textContent = `Não consegui ler: ${ipcErrorText(err)}`; }
}
async function saveAlertPrefs(): Promise<void> {
  if (alertsGroup.hidden || alertPrefsLoaded === null || alertWa.disabled) return;
  // Só WhatsApp: o e-mail (Resend) saiu por completo em 30 out.
  const next = { whatsapp: alertWa.checked };
  if (next.whatsapp === alertPrefsLoaded.whatsapp) return;
  try { await window.meuBot.setAlertPrefs(next); alertPrefsLoaded = next; }
  catch (err) { const tab = ctx.active(); if (tab !== null) ctx.addNotice(tab, `Avisos de segurança: ${ipcErrorText(err)}`, "warn"); }
}

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarConfiguracoes(): void {
  ligarControleRemoto();
  // Entrou ou saiu com o painel aberto: o resumo da linha "Sua conta" acompanha (o bloco em si se repinta sozinho).
  aoMudarConta(() => { if (ctx.dialog.open && !licensePanel.hidden) void loadLicensePanel(); });
  ctx.settingsBtn.addEventListener("click", () => openSettings());
  window.meuBot.on("ui:toggle-settings", () => { if (ctx.dialog.open) ctx.dialog.close(); else openSettings(); });
  // Deep link `meu-bot://app/v1/settings?id=…`: abre (ou mantém aberto) e expande a seção; seção escondida nesta
  // janela (sem cota, sem suporte, sem licença) ou id desconhecido = só as Configurações.
  window.meuBot.on("ui:settings", ({ grupo }) => {
    openSettings();
    const g = grupo === null ? undefined : ctx.settingsGroups.find((d) => d.dataset["group"] === grupo);
    if (g === undefined || g.hidden) return;
    for (const other of ctx.settingsGroups) other.open = other === g;
    g.scrollIntoView({ block: "start" });
  });
  window.meuBot.on("chat:notice", ({ conversationId, text }) => { const tab = ctx.tabs.get(conversationId); if (tab !== undefined) { ctx.addNotice(tab, text, "warn"); ctx.offerClaudeLogin(tab, text); } });
  window.meuBot.on("chat:account", ({ host, status }) => {
    if (host !== ctx.windowHost) return;
    ctx.account = status;
    ctx.paintContext(ctx.active());
    ctx.checkSessionThreshold();
    ctx.checkEspacoThreshold();
    paintEspaco(status?.cota);
    ctx.paintGuide(); // o passo "Ver os limites no rodapé" se marca quando a conta traz números
  });
  ctx.cancelBtn.addEventListener("click", () => ctx.dialog.close());
  ctx.dialog.addEventListener("close", () => ctx.onboardEvent("settings-closed"));
  ctx.form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    ctx.settingsError.hidden = true;
    // Conexão, Aparência, Entrada rápida e Inicialização saíram daqui (30 out): o modelo muda no seletor da caixa de
    // texto, o zoom pelo menu Visualizar, o atalho da entrada rápida no tutorial 14. Salvar só confirma o que ficou.
    const update = {};
    void saveAlertPrefs();
    window.meuBot.setSettings(update).then(
      (view) => {
        ctx.applySettings(view);
        ctx.dialog.close();
        const tab = ctx.active();
        if (tab !== null) ctx.addNotice(tab, "Configurações salvas.");
      },
      (err: unknown) => {
        ctx.settingsError.textContent = ipcErrorText(err);
        ctx.settingsError.hidden = false;
      },
    );
  });
}
