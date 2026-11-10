/**
 * Variante: admin. A página "Suporte" da janela de uma pessoa no meu-bot-admin: saúde da máquina, progresso
 * nos tutoriais, ações de suporte (dois cliques) e os registros (recolhidos; só lê o journal ao abrir). Fábrica
 * com dependências explícitas, no padrão de snake.ts: o renderer.ts dá o sistema de páginas e recebe de volta,
 * por `onWhatsapp`, o estado do WhatsApp que a saúde traz (é ele quem pinta a lateral).
 */
import { mountBackupCard } from "./backup-card.js";
import type { AdminAction, AdminHealth, MeuBotApi, WhatsappStatus, PlanName } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { carregando } from "../lib/carregando.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { cacheAgeText, type Cached } from "../lib/cache.js";
import { actionResultText, dateInputToIso, deviceParts, healthLines, isoToDateInput, licenseSummary, progressEmptyText, progressLines, progressUpdatedText, transcriptionNote, visibleActions, ESTE_MAC_MAQUINA, ESTE_MAC_BACKEND_TEXTO, produtoLabel, type HealthLine, type AddonRotulo } from "../lib/admin-view.js";
import type { LicensePatch, LicenseView } from "../../shared/ipc";

export interface SuportePageDeps {
  /** Catálogo de add-ons (caps.addons): rótulos e o que dá para incluir na licença. */
  addons(): readonly AddonRotulo[];
  /** A máquina da janela e, se conhecido, o nome da pessoa. */
  who: { host: string; person: string | null; machine: string | null };
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  /** Botão de dois cliques (o segundo confirma). */
  armConfirm(btn: HTMLButtonElement, label: string, run: () => void): void;
  fmtPhone(digits: string | null): string;
  api: Pick<MeuBotApi, "adminHealth" | "adminLogs" | "adminAction" | "setLicense" | "approveDevice" | "removeDevice" | "adminProdutos" | "adminBackupListar" | "adminBackupCriar" | "adminBackupConferir" | "adminBackupRestaurar" | "adminBackupWhatsapp" | "on">;
  /** A saúde trouxe o WhatsApp da máquina (null = ela não compartilha ou não tem): o renderer atualiza a lateral. */
  onWhatsapp(status: WhatsappStatus | null): void;
  /** O plano da conta (do card de licença): o renderer pinta o selo "PRO" no canto superior. */
  onPlan(plan: PlanName | null): void;
  /** Cache desta janela (lib/cache.ts, por máquina): a saúde da última vez aparece na hora, com "há X min". */
  cache: { read<T>(name: string): Cached<T> | null; write(name: string, value: unknown): void };
}

export interface SuportePage {
  /** Cria a página na primeira vez (e consulta a saúde) e a traz para a frente. */
  open(): void;
  refreshHealth(): Promise<void>;
}

interface State { /** Nomes dos MVPs registrados em Produtos (botões "＋ produto" do card de licença); lidos ao abrir. */ mvps: string[]; health: AdminHealth | null; /** Quando a saúde na tela foi lida de verdade (null = veio do cache ou ainda não leu). */ healthAt: number | null; healthErr: string | null; logs: string | null; busy: AdminAction | "health" | "logs" | null; msg: { text: string; bad: boolean } | null; /** Mudança de licença em andamento. */ licBusy: boolean; licMsg: { text: string; bad: boolean } | null; /** O admin desligou o suporte nesta janela (só "Religar" no este Mac, nada nas outras). */ desligado: boolean }

export function mountSuportePage(deps: SuportePageDeps): SuportePage {
  const state: State = { mvps: [], health: null, healthAt: null, healthErr: null, logs: null, busy: null, msg: null, licBusy: false, licMsg: null, desligado: false };
  // A saúde da última vez aparece na hora (com a idade); a consulta real troca por baixo.
  const cachedHealth = deps.cache.read<AdminHealth>("health");
  if (cachedHealth !== null) { state.health = cachedHealth.value; state.healthAt = cachedHealth.at; deps.onWhatsapp(cachedHealth.value.whatsapp); deps.onPlan(cachedHealth.value.license?.license.plan ?? null); }
  let page: PageTab | null = null;
  /** Registros recolhidos por padrão: só lê o journal da máquina quando a pessoa abre. */
  let logsOpen = false;
  const who = deps.who.person ?? deps.who.host;
  const backup = mountBackupCard({ api: deps.api, armConfirm: deps.armConfirm, who });

  async function refreshHealth(): Promise<void> {
    state.busy = "health"; render();
    try {
      state.health = await deps.api.adminHealth(); state.healthErr = null; state.healthAt = Date.now(); deps.cache.write("health", state.health);
      deps.onWhatsapp(state.health.whatsapp);
      deps.onPlan(state.health.license?.license.plan ?? null);
    } catch (err) { state.healthErr = ipcErrorText(err); }
    finally { state.busy = null; render(); }
  }
  async function refreshLogs(): Promise<void> {
    state.busy = "logs"; render();
    try { state.logs = await deps.api.adminLogs(); } catch (err) { state.logs = `não consegui ler: ${err instanceof Error ? err.message : String(err)}`; }
    finally { state.busy = null; render(); }
  }
  /** Roda uma mudança de licença (setLicense/approveDevice), atualiza a visão na tela e o cache. */
  async function runLicense(label: string, op: () => Promise<LicenseView>): Promise<void> {
    if (state.licBusy) return;
    state.licBusy = true; state.licMsg = null; render();
    try {
      const view = await op();
      if (state.health !== null) { state.health.license = view; deps.cache.write("health", state.health); }
      state.licMsg = { text: `${label}: feito`, bad: false };
    } catch (err) { state.licMsg = { text: ipcErrorText(err), bad: true }; }
    finally { state.licBusy = false; render(); }
  }

  const list = (lines: HealthLine[]): HTMLUListElement => {
    const ul = el("ul", "admin-health");
    for (const l of lines) {
      const li = el("li", l.ok === null ? "" : l.ok ? "ok" : "bad", l.text);
      if (l.step !== undefined) li.append(el("span", "admin-step", l.step));
      ul.append(li);
    }
    return ul;
  };
  const smallBtn = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = el("button", "btn btn-ghost btn-small", label); b.type = "button"; b.disabled = state.busy !== null;
    b.addEventListener("click", onClick);
    return b;
  };

  function render(): void {
    if (page === null) return;
    const panel = page.panel;
    panel.replaceChildren();
    const head = el("div", "guide-head");
    const body = el("div", "tut-body");
    body.append(el("span", "tut-badge", "suporte · espelho só leitura"), el("h2", "", who), el("p", "", `Máquina ${deps.who.machine ?? deps.who.host}. As ações abaixo ficam registradas para ${who} ver nas Configurações dela. Se ela desligar o suporte, o acesso acaba na hora.`));
    head.append(body);
    panel.append(head);

    // Saúde
    const h = el("div", "admin-card");
    const hHead = el("div", "admin-card-head"); hHead.append(el("strong", "", "Saúde da máquina"));
    if (state.health !== null && state.healthAt !== null && (state.busy === "health" || Date.now() - state.healthAt > 90_000)) hHead.append(el("span", "hint", state.busy === "health" ? `como estava ${cacheAgeText(state.healthAt)} · atualizando…` : `como estava ${cacheAgeText(state.healthAt)}`));
    // Enquanto consulta, o aviso "como estava … · atualizando…" já diz; o botão só fica desabilitado (smallBtn).
    hHead.append(smallBtn("Atualizar", () => { void refreshHealth(); }));
    h.append(hHead);
    const hp = state.health;
    if (state.healthErr !== null) h.append(el("p", "hint guide-pair-note", state.healthErr));
    else if (hp === null) h.append(carregando("Consultando a máquina dela…", "suporte-saude"));
    else {
      const lines = healthLines(hp, deps.fmtPhone);
      if (!hp.share.whatsapp) lines.push({ text: `WhatsApp: ${who} preferiu não compartilhar`, ok: null });
      h.append(list(lines));
    }
    panel.append(h);

    // Conta e licença: plano, status, membro desde, ciclo e os devices (a visão por conta, como o Rambox).
    const lc = el("div", "admin-card");
    lc.append(el("strong", "", "Conta e licença"));
    const view = hp?.license ?? null;
    if (hp === null) lc.append(carregando("Consultando a licença…", "suporte-licenca"));
    else if (view === null) lc.append(el("p", "hint", "Máquina fora do ar ou backend antigo (sem a rota de licença)."));
    else {
      lc.append(list(licenseSummary(view, Date.now(), deps.addons())));
      const licBtn = (label: string, run: () => void): HTMLButtonElement => {
        const b = el("button", "btn btn-ghost btn-small", label); b.type = "button"; b.disabled = state.licBusy;
        b.addEventListener("click", run);
        return b;
      };
      // O que tira algo da pessoa (acesso, plano, validade, produto) pede o segundo clique, como as ações de suporte.
      const licBtnConfirm = (label: string, confirm: string, run: () => void): HTMLButtonElement => {
        const b = el("button", "btn btn-ghost btn-small", label); b.type = "button"; b.disabled = state.licBusy;
        b.addEventListener("click", () => deps.armConfirm(b, confirm, run));
        return b;
      };
      const setLic = (label: string, patch: LicensePatch): void => { void runLicense(label, () => deps.api.setLicense(patch)); };
      // Validade/trial/active são do plano pago: de free sobem para pro.
      const pago: PlanName = "pro";
      // Devices da conta: "Aprovar" nos que levantaram a mão, "Revogar" nos ativos (volta no próximo hello se couber).
      const devs = el("div", "admin-devices");
      for (const d of view.devices) {
        const row = el("div", "admin-device-row");
        const dp = deviceParts(d);
        const main = el("div", "admin-device-main");
        main.append(el("strong", "admin-device-name", dp.name), el("span", "admin-device-meta hint", dp.meta));
        const st = el("span", `admin-device-status ${dp.ok ? "ok" : "bad"}`, dp.seen !== "" ? `${dp.status} · ${dp.seen}` : dp.status);
        row.append(main, st);
        if (d.status === "pending") row.append(licBtn(state.licBusy ? "Liberando…" : "Aprovar", () => { void runLicense(`device ${d.name || d.id} liberado`, () => deps.api.approveDevice(d.id)); }));
        else row.append(licBtnConfirm(state.licBusy ? "Revogando…" : "Revogar", "Confirmar? ela perde o acesso até aprovar de novo", () => { void runLicense(`device ${d.name || d.id} revogado`, () => deps.api.removeDevice(d.id)); }));
        devs.append(row);
      }
      if (view.devices.length === 0) devs.append(el("p", "hint", "Nenhum device registrado ainda."));
      lc.append(devs);
      // Campo com rótulo + <input>; a função devolve o input para o botão ler o valor na hora do clique.
      const field = (label: string, input: HTMLInputElement | HTMLSelectElement): HTMLElement => {
        const wrap = el("label", "admin-field"); input.disabled = state.licBusy;
        wrap.append(el("span", "hint", label), input);
        return wrap;
      };
      const dateInput = (iso: string | null): HTMLInputElement => { const i = el("input") as HTMLInputElement; i.type = "date"; i.value = isoToDateInput(iso); return i; };
      // Validade (expiresAt): estende a licença; vazio + "Remover validade" limpa.
      const exp = dateInput(view.license.expiresAt);
      const expCtl = el("div", "admin-actions");
      expCtl.append(
        field("Validade", exp),
        licBtn("Salvar validade", () => setLic("validade", { status: "active", plan: pago, expiresAt: dateInputToIso(exp.value) })),
        licBtnConfirm("Remover validade", "Confirmar? tira a data de validade", () => setLic("validade removida", { expiresAt: null })),
      );
      // Trial (trialEnd).
      const tri = dateInput(view.license.trialEnd);
      const triCtl = el("div", "admin-actions");
      triCtl.append(
        field("Trial termina", tri),
        licBtn("Salvar trial", () => setLic("trial", { status: "trialing", plan: pago, trialEnd: dateInputToIso(tri.value) })),
      );
      // Ciclo de cobrança (interval).
      const cycle = el("select") as HTMLSelectElement; cycle.disabled = state.licBusy;
      const cycleOpts: [string, string][] = [["", "nenhum"], ["month", "mensal"], ["year", "anual"]];
      for (const [v, t] of cycleOpts) { const o = el("option", "", t) as HTMLOptionElement; o.value = v; if ((view.license.interval ?? "") === v) o.selected = true; cycle.append(o); }
      const cycleCtl = el("div", "admin-actions");
      cycleCtl.append(field("Ciclo", cycle), licBtn("Salvar ciclo", () => setLic("ciclo", { interval: (cycle.value === "month" || cycle.value === "year") ? cycle.value : null })));
      // Limite exato de devices.
      const lim = el("input") as HTMLInputElement; lim.type = "number"; lim.min = "1"; lim.max = "100"; lim.value = String(view.deviceLimit); lim.disabled = state.licBusy;
      const limCtl = el("div", "admin-actions");
      limCtl.append(
        field("Limite de devices", lim),
        licBtn("Salvar limite", () => { const n = Number.parseInt(lim.value, 10); setLic("limite de devices", { deviceLimit: Number.isInteger(n) ? n : view.deviceLimit }); }),
        licBtn("+1", () => setLic("limite de devices", { deviceLimit: view.deviceLimit + 1 })),
      );
      // Plano e status rápidos.
      const ctl = el("div", "admin-actions");
      ctl.append(
        ...(view.license.plan !== "free" ? [licBtnConfirm("Mudar para Free", "Confirmar? ela perde o Pro agora", () => setLic("plano Free", { plan: "free", status: "free" }))] : []),
        ...(view.license.plan !== "pro" ? [licBtn("Mudar para Pro", () => setLic("plano Pro", { plan: "pro", status: "active" }))] : []),
        licBtn("Marcar Trial", () => setLic("status Trial", { plan: pago, status: "trialing" })),
        licBtn("Marcar Ativo", () => setLic("status Ativo", { plan: pago, status: "active" })),
        licBtnConfirm("Marcar Expirado", "Confirmar? a licença expira agora", () => setLic("status Expirado", { status: "expired" })),
      );
      // Add-ons, acumulativos por cima do plano (com ou sem o Pro): o Financeiro e os MVPs registrados em Produtos.
      const prodCtl = el("div", "admin-actions");
      const contratados = view.license.produtos ?? [];
      const candidatos = [...new Set([...deps.addons().map((a) => a.nome), ...state.mvps])].filter((n) => !contratados.includes(n));
      // Os chips dizem tudo: "× nome" é contratado (tira), "＋ nome" é disponível (inclui). Texto só quando não há nenhum.
      prodCtl.append(el("span", "hint", contratados.length === 0 && candidatos.length === 0 ? "Add-ons: nenhum (só o plano)" : "Add-ons (por cima do plano):"));
      for (const nome of contratados) prodCtl.append(licBtnConfirm(`× ${produtoLabel(nome, deps.addons())}`, `Confirmar? tira o ${produtoLabel(nome, deps.addons())} dela`, () => setLic(`produto ${nome} tirado`, { produtos: contratados.filter((x) => x !== nome) })));
      for (const nome of candidatos) prodCtl.append(licBtn(`＋ ${produtoLabel(nome, deps.addons())}`, () => setLic(`produto ${nome} incluído`, { produtos: [...contratados, nome] })));
      // Orientação de pagamento: aparece para a pessoa no aviso de plano (Pro vencido, add-on, Computador…).
      const pg0 = view.license.pagamento ?? null;
      const pagTxt = el("textarea", "admin-pagamento") as HTMLTextAreaElement;
      pagTxt.rows = 3; pagTxt.maxLength = 2000; pagTxt.placeholder = "Ex.: Pix (chave e-mail) financeiro@…; valor R$ 49/mês. Depois toque em \"Já paguei\"."; pagTxt.value = pg0?.instrucoes ?? ""; pagTxt.disabled = state.licBusy;
      const pagLink = el("input") as HTMLInputElement; pagLink.type = "url"; pagLink.placeholder = "https://… (opcional)"; pagLink.value = pg0?.link ?? "";
      const pagCtl = el("div", "admin-actions");
      const pagWrap = el("label", "admin-field"); pagWrap.append(el("span", "hint", "Como pagar (a pessoa vê no aviso de plano)"), pagTxt);
      pagCtl.append(
        pagWrap,
        field("Link de pagamento", pagLink),
        licBtn("Salvar orientação", () => setLic("orientação de pagamento", { pagamento: { instrucoes: pagTxt.value, link: pagLink.value.trim() === "" ? null : pagLink.value.trim() } })),
        ...(pg0 !== null ? [licBtnConfirm("Apagar orientação", "Confirmar? o aviso volta a só \"pedir ao admin\"", () => setLic("orientação de pagamento apagada", { pagamento: null }))] : []),
      );
      lc.append(expCtl, triCtl, cycleCtl, limCtl, prodCtl, ctl, pagCtl);
      if (state.licMsg !== null) lc.append(el("p", `hint ${state.licMsg.bad ? "guide-pair-note" : "audio-ok"}`, state.licMsg.text));
    }
    panel.append(lc);

    // Progresso nos tutoriais (onde a pessoa está e onde travou)
    const pg = el("div", "admin-card");
    pg.append(el("strong", "", "Progresso nos tutoriais"));
    const prog = hp?.progress ?? null;
    if (hp === null) pg.append(carregando("Consultando o progresso…", "suporte-progresso"));
    else if (!hp.share.progress) pg.append(el("p", "hint", `${who} preferiu não compartilhar o progresso nos tutoriais.`));
    else if (prog === null) pg.append(el("p", "hint", progressEmptyText(who)));
    else pg.append(list(progressLines(prog)), el("p", "hint", progressUpdatedText(prog.at)));
    panel.append(pg);

    // Ações
    const a = el("div", "admin-card");
    a.append(el("strong", "", "Ações de suporte"));
    const acts = el("div", "admin-actions");
    const esteMac = deps.who.machine === ESTE_MAC_MAQUINA;
    for (const o of visibleActions(hp, esteMac, state.desligado)) {
      const b = el("button", "btn btn-ghost btn-small", state.busy === o.id ? "Rodando…" : o.label); b.type = "button"; b.disabled = state.busy !== null;
      b.addEventListener("click", () => deps.armConfirm(b, o.confirm, () => {
        state.busy = o.id; state.msg = null; render();
        void deps.api.adminAction(o.id)
          .then((r) => { state.msg = { text: actionResultText(o.label, r), bad: !r.ok }; if (r.ok && o.id === "support-off") state.desligado = true; if (r.ok && o.id === "support-on") state.desligado = false; })
          .catch((err: unknown) => { state.msg = { text: ipcErrorText(err), bad: true }; })
          .finally(() => { state.busy = null; void refreshHealth(); if (logsOpen) void refreshLogs(); });
      }));
      acts.append(b);
    }
    a.append(acts);
    if (esteMac) a.append(el("p", "hint", ESTE_MAC_BACKEND_TEXTO));
    const note = transcriptionNote(hp);
    if (note !== null) a.append(el("p", "hint", note));
    if (state.msg !== null) a.append(el("p", `hint ${state.msg.bad ? "guide-pair-note" : "audio-ok"}`, state.msg.text));
    panel.append(a);
    // Backup e mudança de máquina (backup-card.ts): só com a permissão dela; restaurar só no app do super admin.
    backup.refresh(hp?.share.backup === true);
    panel.append(backup.el);

    // Registros: recolhido por padrão (é o que menos se olha e o mais pesado de ler). Só se ela compartilha.
    if (hp !== null && !hp.share.logs) {
      const nr = el("div", "admin-card"); nr.append(el("strong", "", "Registros (gateway e backend)"), el("p", "hint", `${who} preferiu não compartilhar os registros.`));
      panel.append(nr, el("p", "hint", "As conversas do WhatsApp dela estão na lateral (só leitura)."));
      return;
    }
    const r = el("details", "admin-card admin-logs-card");
    r.open = logsOpen;
    const sum = el("summary", "admin-card-head");
    sum.append(el("strong", "", "Registros (gateway e backend)"), el("span", "hint", logsOpen ? "" : "clique para abrir"));
    r.append(sum);
    r.addEventListener("toggle", () => {
      if (r.open === logsOpen) return;
      logsOpen = r.open;
      if (logsOpen && state.logs === null) void refreshLogs(); else render();
    });
    if (logsOpen) {
      const pre = el("pre", "admin-logs", state.logs ?? "Lendo…");
      r.append(smallBtn(state.busy === "logs" ? "Lendo…" : "Atualizar", () => { void refreshLogs(); }), pre);
      requestAnimationFrame(() => { pre.scrollTop = pre.scrollHeight; });
    }
    panel.append(r);
    panel.append(el("p", "hint", "As conversas do WhatsApp dela estão na lateral (só leitura)."));
  }

  return {
    open: () => {
      if (page === null) {
        const panel = el("section", "acervo-panel admin-panel"); panel.hidden = true;
        deps.panelsEl.append(panel);
        page = deps.definePage("suporte", `Suporte · ${who}`, panel, render);
        void deps.api.adminProdutos().then((l) => { state.mvps = l.map((p) => p.nome); render(); }).catch(() => { /* sem MVPs: só o meu-bot-crm */ });
        void refreshHealth();
      }
      deps.openPage(page);
    },
    refreshHealth,
  };
}
