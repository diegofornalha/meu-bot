import type { CrmInfo, CrmDiag, CrmLocal } from "../../shared/ipc";
import { MODELOS_PIPELINE, validarPipeline, etapasDoTexto, extrasDoModelo } from "../lib/crm-modelos.js";
import { el } from "../lib/dom.js";
import { carregando, esperaOuFalha } from "../lib/carregando.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { browserAccess, proBlockText, pagamentoDoBloqueio } from "../lib/pro.js";
import { blocoPagamento } from "../lib/aviso-pagamento.js";
import { hostLabel } from "../lib/probe-text.js";
import { ctx, ehRemoto } from "../app/ctx.js";
import { registrarFonte } from "../tutoriais/fontes.js";
import { registrarPassos } from "../tutoriais/passos.js";
import { navInstState, renderNavOpen } from "../navegador/navegador-guia.js";

// ---- Tutorial 17 · CRM pelo WhatsApp (Pro): estado na máquina, instalação, chave/pipeline/regras, teste.
export let crmState: CrmInfo | null = null;
let crmErro: string | null = null;
let crmBusy = false;
let crmLog: string[] = [];
let crmMsg: { text: string; bad: boolean } | null = null;
let crmDiag: CrmDiag | null = null;
let crmKeyDraft = "";
/** meu-bot-crm: pipelines do CRM da máquina e o padrão do WhatsApp (tutorial 17, passo "Criar o primeiro pipeline"). */
export let crmLocalState: CrmLocal | null = null;
let crmPipeDraft: { modelo: string; nome: string; etapas: string } | null = null;
let crmPipeNovo = false;
let crmPipeBusy = false;
let crmPipeMsg: { text: string; bad: boolean } | null = null;
/** Tutorial 17: escolher um modelo (ou do meu jeito), ajustar nome e etapas e criar; com vários e nenhum padrão, escolher. */
export function renderCrmPipeline(container: HTMLElement): void {
  const st = crmLocalState;
  if (crmPipeMsg !== null) container.append(el("p", `hint${crmPipeMsg.bad ? " guide-pair-note" : ""}`, crmPipeMsg.text));
  if (st === null) { container.append(carregando("Lendo o CRM desta máquina…")); void refreshCrm(); return; }
  const gmail = el("button", "linkish", "Ver no Gmail"); gmail.type = "button";
  gmail.addEventListener("click", () => { void ctx.openNavTab("https://mail.google.com/"); });
  if (st.padrao !== null) {
    const p = el("p", "hint"); p.append(`Pipeline do WhatsApp: ${st.pipelines.find((x) => x.key === st.padrao)?.name ?? st.padrao}. `, gmail); container.append(p);
    return;
  }
  // Já há pipelines (importados ou criados no Gmail), mas nenhum é o do WhatsApp: escolher um.
  if (st.pipelines.length > 0 && !crmPipeNovo) {
    container.append(el("p", "hint", "Seu CRM já tem pipelines. Qual deles o WhatsApp usa para anotar as conversas?"));
    const cards = el("div", "reply-cards guide-cards");
    for (const pl of st.pipelines) {
      const card = el("button", "reply-card"); card.type = "button"; card.disabled = crmPipeBusy;
      const body = el("div", "reply-body"); const title = el("div", "reply-title"); title.append(el("strong", "", pl.name));
      body.append(title, el("p", "", pl.boxes === 1 ? "1 caixa" : `${pl.boxes} caixas`));
      card.append(el("span", "reply-radio"), body);
      card.addEventListener("click", () => {
        crmPipeBusy = true; ctx.paintGuide();
        void window.meuBot.crmDefinirPadrao(pl.key).then((r) => { crmLocalState = r; crmPipeMsg = { text: `✓ O WhatsApp passa a anotar no pipeline "${pl.name}".`, bad: false }; })
          .catch((e: unknown) => { crmPipeMsg = { text: `Não deu: ${ipcErrorText(e)}`, bad: true }; }).finally(() => { crmPipeBusy = false; ctx.paintGuide(); });
      });
      cards.append(card);
    }
    const outro = el("button", "linkish", "Criar outro pipeline"); outro.type = "button";
    outro.addEventListener("click", () => { crmPipeNovo = true; ctx.paintGuide(); });
    container.append(cards, outro);
    return;
  }
  const cards = el("div", "reply-cards guide-cards");
  for (const m of MODELOS_PIPELINE) {
    const card = el("button", `reply-card${crmPipeDraft?.modelo === m.id ? " on" : ""}`); card.type = "button"; card.disabled = crmPipeBusy;
    const body = el("div", "reply-body"); const title = el("div", "reply-title"); title.append(el("strong", "", m.titulo));
    if (m.id === "midia-paga") title.append(el("span", "reply-default", "Mais usado"));
    body.append(title, el("p", "", m.etapas.length > 0 ? `${m.texto} Etapas: ${m.etapas.join(" › ")}.` : m.texto));
    card.append(el("span", "reply-radio"), body);
    card.addEventListener("click", () => { crmPipeDraft = { modelo: m.id, nome: m.nome, etapas: m.etapas.join("\n") }; crmPipeMsg = null; ctx.paintGuide(); });
    cards.append(card);
  }
  container.append(cards);
  const d = crmPipeDraft;
  if (d === null) return;
  const box = el("div", "wa-list-editor crm-pipe-editor");
  const nome = el("input") as HTMLInputElement; nome.type = "text"; nome.placeholder = "Nome do pipeline (ex.: Vendas LV)"; nome.value = d.nome;
  nome.addEventListener("input", () => { d.nome = nome.value; });
  const etapas = document.createElement("textarea"); etapas.rows = 5; etapas.placeholder = "Uma etapa por linha (de 2 a 12)"; etapas.value = d.etapas;
  etapas.addEventListener("input", () => { d.etapas = etapas.value; });
  const criar = el("button", "btn btn-primary btn-small", crmPipeBusy ? "criando…" : "Criar pipeline"); criar.type = "button"; criar.disabled = crmPipeBusy;
  criar.addEventListener("click", () => {
    const v = validarPipeline(d.nome, etapasDoTexto(d.etapas));
    if (!v.ok) { crmPipeMsg = { text: v.erro, bad: true }; ctx.paintGuide(); return; }
    crmPipeBusy = true; crmPipeMsg = null; ctx.paintGuide();
    void window.meuBot.crmCriarPipeline(v.name, v.stages, extrasDoModelo(d.modelo)).then((r) => { crmLocalState = r; crmPipeDraft = null; crmPipeNovo = false; crmPipeMsg = { text: `✓ Pipeline "${v.name}" criado: as conversas do WhatsApp passam a ser anotadas nele.`, bad: false }; })
      .catch((e: unknown) => { crmPipeMsg = { text: `Não deu para criar: ${ipcErrorText(e)}`, bad: true }; }).finally(() => { crmPipeBusy = false; ctx.paintGuide(); });
  });
  box.append(el("span", "hint", "Nome"), nome, el("span", "hint", "Etapas, na ordem do seu atendimento (uma por linha)"), etapas, criar);
  container.append(box);
}
export async function refreshCrm(): Promise<void> {
  if (!ctx.caps.install || ctx.windowHost === "" || ctx.windowHost === "local") return;
  try { crmState = await window.meuBot.crmInfo(); crmErro = null; } catch (err) { crmErro = ipcErrorText(err); /* fica o estado que havia */ }
  if (ctx.crmProprio()) { try { crmLocalState = await window.meuBot.crmLocal(); } catch { /* backend fora: fica o que havia */ } }
  ctx.paintGuide();
  void crmAutoPipeline();
}
async function crmDo(run: () => Promise<unknown>, okText: string | null): Promise<void> {
  if (crmBusy) return;
  crmBusy = true; crmMsg = null; ctx.paintGuide();
  try { const r = await run(); if (r !== null && typeof r === "object" && "available" in (r as object)) crmState = r as CrmInfo; crmMsg = okText === null ? null : { text: okText, bad: false }; }
  catch (err) { crmMsg = { text: /ASSINATURA_REQUIRED/.test(ipcErrorText(err)) ? `A assinatura do ${ctx.caps.produto} não está ativa nesta máquina.` : /PRO_REQUIRED/.test(ipcErrorText(err)) ? "Esta máquina não tem o plano Pro." : ipcErrorText(err), bad: true }; }
  finally { crmBusy = false; ctx.paintGuide(); }
}
/** Passo 1: o plano (mesmo gate do Navegador, texto do CRM). */
export function renderCrmPro(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  const a = browserAccess(ctx.license, ctx.windowHost, ctx.caps.planoExigido, ctx.caps.produto);
  if (a === "ok") { box.append(el("p", "audio-ok", ctx.caps.planoExigido === "free" ? `✓ plano Pro ativo em ${hostLabel(ctx.windowHost)}` : `✓ assinatura do ${ctx.caps.produto} ativa em ${hostLabel(ctx.windowHost)}`)); container.append(box); return; }
  const t = proBlockText(a, ctx.license, "crm", ctx.caps.produto);
  box.append(el("p", "hint", t.text));
  const pg = pagamentoDoBloqueio(a, ctx.license);
  if (pg !== null) box.append(blocoPagamento(pg));
  const row = el("div", "audio-row");
  if (t.askAdmin) {
    const b = el("button", "btn btn-primary btn-small", ctx.navAskedPro ? "Pedido enviado ao admin ✓" : a === "assinatura" ? "Avisar o admin" : "Pedir o Pro ao admin"); b.type = "button"; b.disabled = ctx.navAskedPro;
    b.addEventListener("click", () => { b.disabled = true; void window.meuBot.browserRequestPro().then(() => { ctx.navAskedPro = true; ctx.paintGuide(); }).catch(() => { b.disabled = false; }); });
    row.append(b);
  }
  const again = el("button", "btn btn-ghost btn-small", "Conferir de novo"); again.type = "button";
  again.addEventListener("click", () => { void ctx.refreshLicense().then(() => ctx.paintGuide()); });
  row.append(again); box.append(row); container.append(box);
}
/** Passo 2: plugin + streak.mjs na máquina. */
export function renderCrmInstall(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  // Este Mac: o plugin do CRM é do agente do WhatsApp de uma máquina por SSH, e a consulta nem é feita aqui.
  // Sem isto o passo ficava em "Consultando a máquina…" para sempre, com o Instalar desligado.
  if (!ehRemoto()) { box.append(el("p", "hint", "Neste Mac não há o que instalar: o CRM pelo WhatsApp é do agente de uma máquina por SSH.")); container.append(box); return; }
  const row = el("div", "audio-row");
  const inst = crmState?.installed === true;
  if (inst && !crmBusy) row.append(el("span", "audio-ok", "✓ instalado nesta máquina"));
  const b = el("button", `btn ${inst ? "btn-ghost" : "btn-primary"} btn-small`, crmBusy ? "Instalando…" : inst ? "Reinstalar" : "Instalar"); b.type = "button"; b.disabled = crmBusy || crmState === null;
  b.addEventListener("click", () => { crmLog = []; void crmDo(async () => { const r = await window.meuBot.installCrm(); if (!r.ok) throw new Error(r.log.at(-1) ?? "a instalação falhou"); return window.meuBot.crmInfo(); }, "Máquina pronta: o plugin do CRM está no OpenClaw."); });
  row.append(b); box.append(row);
  if (crmState === null) box.append(esperaOuFalha({ erro: crmErro, chave: "guia-crm", tentar: () => { crmErro = null; ctx.paintGuide(); void refreshCrm(); } }));
  if (crmBusy && crmLog.length > 0) box.append(el("pre", "admin-logs", crmLog.join("\n")));
  if (crmMsg !== null) box.append(el("p", `hint ${crmMsg.bad ? "guide-pair-note" : "audio-ok"}`, crmMsg.text));
  container.append(box);
}
/** Passo 3: chave da API (só vai à máquina), teste, pipeline e regras. */
const CRM_KEY_PROMPT = "Gere uma chave da API do Streak para mim pelo Navegador e guarde na máquina com `node ~/.local/share/meu-bot/crm/streak.mjs chave-set <chave>` (siga a skill streak-crm-navegador, seção \"Gerar a chave da API\"). Não me mostre a chave: só confirme quando o chave-set responder ok e diga o usuário.";
export async function crmAfterAgentKey(): Promise<void> {
  ctx.crmKeyFromAgent = false;
  await refreshCrm();
  if (crmState?.configured !== true) return;
  await crmDo(async () => { crmDiag = await window.meuBot.crmTest(); if (!crmDiag.ok) throw new Error(crmDiag.erro ?? "falhou"); return null; }, "Chave guardada pelo agente e testada.");
  await crmAutoPipeline();
}
/** Conta com um só pipeline: escolhe sozinho (a pessoa só escolhe quando há mais de um). Uma vez por janela. */
let crmAutoPipelineDone = false;
async function crmAutoPipeline(): Promise<void> {
  if (crmAutoPipelineDone || crmBusy || crmState?.configured !== true || crmState.pipelineKey !== null) return;
  if (crmDiag?.ok !== true) { try { crmDiag = await window.meuBot.crmTest(); } catch { return; } }
  if (crmDiag?.ok !== true || crmDiag.pipelines.length !== 1) return;
  crmAutoPipelineDone = true;
  const p = crmDiag.pipelines[0]!;
  await crmDo(() => window.meuBot.setCrm({ pipelineKey: p.key, pipelineName: p.name }), `Pipeline "${p.name}" escolhido sozinho: é o único da conta.`);
}
export function renderCrmConfig(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  const st = crmState;
  // Chave
  const keyRow = el("div", "support-name");
  const key = el("input"); key.type = "password"; key.autocomplete = "off"; key.spellcheck = false; key.maxLength = 200; key.disabled = crmBusy;
  key.placeholder = st?.configured === true ? "chave guardada na máquina · cole outra para trocar" : "cole aqui a chave da API do Streak";
  key.value = crmKeyDraft;
  key.addEventListener("input", () => { crmKeyDraft = key.value; saveKey.disabled = crmBusy || key.value.trim().length < 16; });
  const saveKey = el("button", "btn btn-primary btn-small", st?.configured === true ? "Trocar a chave" : "Guardar a chave"); saveKey.type = "button"; saveKey.disabled = crmBusy || key.value.trim().length < 16;
  saveKey.addEventListener("click", () => { const k = key.value.trim(); crmKeyDraft = ""; void crmDo(async () => { const r = await window.meuBot.setCrm({ apiKey: k }); crmDiag = await window.meuBot.crmTest(); if (!crmDiag.ok) throw new Error(crmDiag.erro ?? "a chave não funcionou"); return r; }, "Chave guardada e testada no Streak."); });
  key.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !saveKey.disabled) { ev.preventDefault(); saveKey.click(); } });
  keyRow.append(key, saveKey); box.append(keyRow);
  // Ou o agente faz: gera a chave no Gmail pelo Navegador e grava na máquina com `streak.mjs chave-set` (a skill
  // streak-crm-navegador tem o caminho). O app percebe a gravação pela linha da ferramenta e segue sozinho.
  if (st?.configured !== true) {
    const ag = el("div", "audio-row");
    const btn = el("button", "btn btn-ghost btn-small", "Pedir ao agente para gerar a chave"); btn.type = "button"; btn.disabled = crmBusy || navInstState !== true;
    btn.title = navInstState === true ? "Abre a conversa com o Navegador ligado para o agente: ele cria a chave no Streak e guarda na máquina, sem mostrar" : "Antes, conclua o tutorial do Navegador (o agente precisa dele)";
    btn.addEventListener("click", () => {
      if (ctx.caps.agenteNavegador && !ctx.navAgent.on) void window.meuBot.browserAgent(true).then((s) => { ctx.navAgent = s; ctx.paintNav(); });
      void ctx.goToChatFromGuide(CRM_KEY_PROMPT, "O agente abre o Gmail na aba Navegador, cria a chave no Streak e guarda na máquina; quando o `chave-set` responder, o passo se conclui aqui sozinho.");
    });
    ag.append(btn, el("span", "hint", "precisa da conta do Google logada na aba Navegador"));
    box.append(ag);
  }
  if (st?.configured === true) {
    const testRow = el("div", "audio-row");
    const test = el("button", "btn btn-ghost btn-small", crmBusy ? "Testando…" : "Testar a chave e listar pipelines"); test.type = "button"; test.disabled = crmBusy;
    test.addEventListener("click", () => { void crmDo(async () => { crmDiag = await window.meuBot.crmTest(); if (!crmDiag.ok) throw new Error(crmDiag.erro ?? "falhou"); return null; }, crmDiag?.ok ? null : null); });
    testRow.append(test);
    if (crmDiag?.ok === true) testRow.append(el("span", "audio-ok", `✓ ${crmDiag.usuario ?? "conta"} · ${crmDiag.pipelines.length} pipeline${crmDiag.pipelines.length === 1 ? "" : "s"}`));
    box.append(testRow);
    // Pipeline
    const pipes = crmDiag?.pipelines ?? (st.pipelineKey !== null ? [{ key: st.pipelineKey, name: st.pipelineName ?? st.pipelineKey }] : []);
    if (pipes.length > 0) {
      const pr = el("div", "support-name");
      const sel = document.createElement("select"); sel.className = "nav-url"; sel.disabled = crmBusy;
      const none = document.createElement("option"); none.value = ""; none.textContent = "escolha o pipeline…"; sel.append(none);
      for (const p of pipes) { const o = document.createElement("option"); o.value = p.key; o.textContent = p.name; if (p.key === st.pipelineKey) o.selected = true; sel.append(o); }
      sel.addEventListener("change", () => { const p = pipes.find((x) => x.key === sel.value); if (p === undefined) return; void crmDo(() => window.meuBot.setCrm({ pipelineKey: p.key, pipelineName: p.name }), `Pipeline "${p.name}" escolhido.`); });
      pr.append(el("span", "hint", "Pipeline:"), sel); box.append(pr);
      if (crmDiag?.pipeline) box.append(el("p", "hint", `Etapas: ${crmDiag.pipeline.stages.join(" → ")}. Campos: ${crmDiag.pipeline.fields.join(", ") || "nenhum"}.`));
    } else if (crmDiag !== null && crmDiag.ok) box.append(el("p", "hint guide-pair-note", "Nenhum pipeline nesta conta do Streak: crie um no Gmail e teste de novo."));
    // Regras
    const rules = el("div", "audio-row");
    const sil = document.createElement("input"); sil.type = "number"; sil.min = "1"; sil.max = "240"; sil.className = "nav-url"; sil.style.maxWidth = "80px"; sil.value = String(st.silencioMin); sil.disabled = crmBusy;
    sil.addEventListener("change", () => { const n = Number(sil.value); if (Number.isInteger(n) && n >= 1 && n <= 240 && n !== st.silencioMin) void crmDo(() => window.meuBot.setCrm({ silencioMin: n }), `Anota após ${n} min de silêncio.`); });
    const lab = el("label", "hint"); lab.append("anotar após ", sil, " min de silêncio na conversa");
    const auto = document.createElement("input"); auto.type = "checkbox"; auto.checked = st.criarSemPerguntar; auto.disabled = crmBusy;
    auto.addEventListener("change", () => { void crmDo(() => window.meuBot.setCrm({ criarSemPerguntar: auto.checked }), auto.checked ? "Box novo e etapa sem perguntar." : "Box novo e etapa só com o seu ok."); });
    const lab2 = el("label", "hint"); lab2.append(auto, " criar box e mudar etapa sem perguntar");
    rules.append(lab, lab2); box.append(rules);
  }
  if (crmBusy) box.append(el("p", "hint", "Falando com a máquina…"));
  if (crmMsg !== null) box.append(el("p", `hint ${crmMsg.bad ? "guide-pair-note" : "audio-ok"}`, crmMsg.text));
  container.append(box);
}
/** Passo 4: como testar e "Refazer do zero". */
export function renderCrmTest(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  box.append(el("p", "hint", `Também funciona sozinho: ${crmState?.silencioMin ?? 10} min depois da última mensagem de um contato que já tem box, o agente anota o que mudou e te avisa pelo WhatsApp.`));
  const row = el("div", "audio-row");
  const reset = el("button", "btn btn-ghost btn-small", "Refazer do zero"); reset.type = "button"; reset.disabled = crmBusy;
  reset.addEventListener("click", () => { if (!confirm("Apagar a chave da API e a configuração do CRM desta máquina e tirar o plugin?")) return; crmDiag = null; void crmDo(() => window.meuBot.resetCrm(), "CRM removido desta máquina."); });
  row.append(reset); box.append(row);
  if (crmMsg !== null) box.append(el("p", `hint ${crmMsg.bad ? "guide-pair-note" : "audio-ok"}`, crmMsg.text));
  container.append(box);
}

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarCrmGuia(): void {
  registrarFonte("crm", () => {
    const proprio = ctx.crmProprio() && ctx.motorCrm() === "proprio";
    return {
      known: ctx.navLicenseAsked && (crmState !== null || !ehRemoto()) && (!ctx.crmProprio() || !ehRemoto() || crmLocalState !== null),
      dados: { crm: { access: !ctx.navLicenseAsked ? null : browserAccess(ctx.license, ctx.windowHost, ctx.caps.planoExigido, ctx.caps.produto), info: crmState, local: crmLocalState }, produto: { planoExigido: ctx.caps.planoExigido, crmProprio: proprio, crmStreak: !proprio } },
    };
  });
  registrarPassos({
    "crm-pro": (txt) => renderCrmPro(txt),
    "crm-install": (txt) => renderCrmInstall(txt),
    "crm-config": (txt) => renderCrmConfig(txt),
    "crm-test": (txt) => renderCrmTest(txt),
    "crm-pipeline": (txt) => renderCrmPipeline(txt),
    // O Gmail web com a barra do CRM abre no Navegador do agente (renderizador do Navegador, em navegador-guia).
    "crm-gmail": (txt) => renderNavOpen(txt, "https://mail.google.com/"),
    "crm-importar": (txt) => { txt.append(el("p", "hint", "Na conversa, peça por exemplo: \"importa do Streak o pipeline Parceiros\" e cole a chave quando o agente pedir. Ele usa o importador da máquina; a chave não fica gravada.")); },
  });
  window.meuBot.on("crm:progress", ({ line }) => { crmLog = [...crmLog, line].slice(-6); if (crmBusy) ctx.paintGuide(); });
}
