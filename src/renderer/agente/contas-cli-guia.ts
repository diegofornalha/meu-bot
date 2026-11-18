/** Contas de linha de comando na máquina (tutorial 11): Cloudflare e GitHub, login pelo Navegador, instalar o gh. */
import type { ContaEstado, ContaEvento, ContaId } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { esperaOuFalha, SEM_RESPOSTA } from "../lib/carregando.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { browserAccess } from "../lib/pro.js";
import { ctx, ehRemoto } from "../app/ctx.js";
import { registrarFonte } from "../tutoriais/fontes.js";
import { abrirLinkDoChat } from "../navegador/navegador-guia.js";
import { registrarPassos } from "../tutoriais/passos.js";

/** Tutorial 11: contas de CLI desta máquina (null = ainda não consultado) e o login em andamento. */
export let contasState: ContaEstado[] | null = null;
let contasErro: string | null = null;
let contaLogin: { id: ContaId; trocar: boolean; url: string | null; codigo: string | null; texto: string; rodando: boolean; ok: boolean | null } | null = null;
export async function refreshContas(): Promise<void> {
  if (!ctx.caps.install || ctx.windowHost === "") return;
  // Sem resposta ou com erro: fica o estado que havia, e o passo diz o motivo em vez de esperar para sempre.
  try { const r = await window.meuBot.contasStatus(); if (r !== null) { contasState = r; contasErro = null; } else contasErro = SEM_RESPOSTA; } catch (err) { contasErro = ipcErrorText(err); }
  ctx.paintGuide();
}
/** O link do login abre no Navegador do app: é por ele que o retorno do Cloudflare chega ao localhost da máquina. */
const navegadorPronto = (): boolean => ctx.caps.chat && ctx.caps.navegador && browserAccess(ctx.license, ctx.windowHost, ctx.caps.planoExigido, ctx.caps.produto) === "ok";
async function entrarConta(id: ContaId, trocar = false): Promise<void> {
  if (contaLogin?.rodando === true) return;
  contaLogin = { id, trocar, url: null, codigo: null, texto: "Pedindo o login na máquina…", rodando: true, ok: null };
  ctx.paintGuide();
  try { await window.meuBot.contasEntrar(id, navegadorPronto(), trocar); }
  catch (err) { contaLogin = { ...contaLogin, texto: `✗ ${ipcErrorText(err)}`, ok: false }; }
  finally { if (contaLogin !== null) contaLogin.rodando = false; ctx.paintGuide(); }
}
/** Botão "Instalar o GitHub CLI": em andamento, e o erro da última tentativa (some ao tentar de novo). */
let ghInstalando = false;
let ghErro: string | null = null;
export function renderConta(container: HTMLElement, id: ContaId): void {
  const box = el("div", "audio-controls");
  const st = contasState?.find((c) => c.id === id) ?? null;
  const login = contaLogin?.id === id ? contaLogin : null;
  const row = el("div", "audio-row");
  if (contasState === null) row.append(esperaOuFalha({ erro: contasErro, chave: "guia-contas", tentar: () => { contasErro = null; ctx.paintGuide(); void refreshContas(); } }));
  else if (st !== null && !st.presente && id === "github") {
    row.append(el("span", "hint", ghInstalando ? "Instalando o GitHub CLI na máquina…" : "O GitHub CLI (gh) não está instalado nesta máquina."));
    const b = el("button", "btn btn-primary btn-small", ghInstalando ? "Instalando…" : "Instalar o GitHub CLI"); b.type = "button";
    b.disabled = ghInstalando;
    b.addEventListener("click", () => {
      ghInstalando = true; ghErro = null; ctx.paintGuide();
      void window.meuBot.contasInstalarGh()
        .then((r) => { if (r !== null) contasState = r; })
        .catch((e: unknown) => { ghErro = `Não instalou: ${ipcErrorText(e)}`; })
        .finally(() => { ghInstalando = false; ctx.paintGuide(); });
    });
    row.append(b);
  }
  else if (st !== null && !st.presente) row.append(el("span", "hint", "Esta máquina não tem um Node 22 ou mais novo para o Cloudflare (o wrangler exige). Peça ao admin: em Preparar máquina, \"OpenClaw para todos\" traz o Node 24 em /opt, e este tutorial passa a usá-lo."));
  else {
    if (st?.conectado === true) row.append(el("span", "audio-ok", `✓ conectado${st.conta !== null ? ` · ${st.conta}` : ""}`));
    // Conectada: "Trocar de conta" (outra conta); "Conectar de novo" só quando o acesso é amplo (mesma conta, só sites).
    const conectada = st?.conectado === true;
    if (!conectada || st?.amplo === true || login?.rodando === true) {
      const b = el("button", `btn ${conectada ? "btn-ghost" : "btn-primary"} btn-small`, login?.rodando === true ? "Esperando a autorização…" : conectada ? "Conectar de novo (só sites)" : "Conectar"); b.type = "button";
      b.disabled = contaLogin?.rodando === true;
      b.addEventListener("click", () => { void entrarConta(id); });
      row.append(b);
    }
    if (conectada && login?.rodando !== true) {
      const t = el("button", "btn btn-ghost btn-small", "Trocar de conta"); t.type = "button";
      t.disabled = contaLogin?.rodando === true;
      t.addEventListener("click", () => { void entrarConta(id, true); });
      row.append(t);
    }
    if (login?.rodando === true) {
      const c = el("button", "btn btn-ghost btn-small", "Cancelar"); c.type = "button";
      c.addEventListener("click", () => { void window.meuBot.contasCancelar(); });
      row.append(c);
    } else if (st?.conectado === true) {
      const sair = el("button", "btn btn-ghost btn-small", "Sair"); sair.type = "button";
      sair.addEventListener("click", () => ctx.armConfirm(sair, "Confirmar? o agente perde o acesso", () => {
        void window.meuBot.contasSair(id).then((r) => { if (r !== null) contasState = r; contaLogin = null; ctx.paintGuide(); });
      }));
      row.append(sair);
    }
  }
  box.append(row);
  if (id === "github" && ghErro !== null) box.append(el("p", "hint bad-hint", ghErro));
  if (st?.amplo === true && login?.rodando !== true) box.append(el("p", "hint", "Esta conta foi logada com acesso amplo (Workers, D1, e-mail…). \"Conectar de novo\" troca por um acesso só para sites."));
  if (login !== null) {
    box.append(el("p", login.ok === false ? "hint bad-hint" : "hint", login.texto));
    if (login.codigo !== null && login.rodando) {
      const cr = el("div", "audio-row");
      const code = el("code", "conta-codigo", login.codigo);
      const copy = el("button", "btn btn-ghost btn-small", "Copiar"); copy.type = "button";
      copy.addEventListener("click", () => { void navigator.clipboard.writeText(login.codigo ?? "").then(() => { copy.textContent = "Copiado"; window.setTimeout(() => { copy.textContent = "Copiar"; }, 1500); }); });
      cr.append(code, copy);
      box.append(cr);
    }
    if (login.url !== null && login.rodando) {
      const again = el("button", "btn btn-ghost btn-small", "Abrir a página de novo"); again.type = "button";
      again.addEventListener("click", () => { if (login.url !== null) void abrirLinkDoChat(login.url, false); });
      box.append(again);
    }
  }
  container.append(box);
}
/** Passo "Entrar no Cloudflare" do guia: só o botão que abre o login no Navegador do agente. */
function renderCloudflareEntrar(txt: HTMLElement): void {
  const abrir = el("button", "btn btn-primary btn-small", "Abrir o Cloudflare"); abrir.type = "button";
  abrir.addEventListener("click", () => { void ctx.openNavTab("https://dash.cloudflare.com/login"); });
  txt.append(abrir);
}
/** Liga os passos das contas ao guia e os eventos do login; o renderer.ts chama uma vez. */
export function ligarContasCliGuia(): void {
  registrarFonte("contas", () => ({ known: contasState !== null || !ehRemoto(), dados: { contas: contasState } }));
  registrarPassos({
    "cloudflare-entrar": renderCloudflareEntrar,
    "conta-cloudflare": (txt) => renderConta(txt, "cloudflare"),
    "conta-github": (txt) => renderConta(txt, "github"),
  });
  window.meuBot.on("contas:evento", (ev: ContaEvento) => {
    if (contaLogin === null || contaLogin.id !== ev.id) return;
    if (ev.kind === "url") {
      contaLogin.url = ev.url; contaLogin.codigo = ev.codigo;
      contaLogin.texto = contaLogin.trocar
        ? ev.id === "github" ? "A página abriu no Navegador: entre com a outra conta do GitHub; daí o código é colado e o acesso autorizado sozinhos (se travar, cole o código abaixo e autorize). A conta antiga sai desta máquina quando a nova entrar." : "A página abriu no Navegador, já fora da conta antiga: entre com a outra conta do Cloudflare e autorize."
        : ev.codigo !== null ? "A página abriu no Navegador: o código é colado e o acesso autorizado sozinhos quando ela carregar (se travar, cole o código abaixo e autorize)." : "A página abriu no Navegador: entre na conta e autorize. Aqui atualiza sozinho.";
      void abrirLinkDoChat(ev.url, false, "Tutorial 11");
    } else if (ev.kind === "log") contaLogin.texto = ev.text;
    else {
      contaLogin.ok = ev.ok; contaLogin.texto = ev.ok ? `✓ ${ev.text}` : `✗ ${ev.text}`;
      if (ev.estado != null) { const est = ev.estado; contasState = [...(contasState ?? []).filter((c) => c.id !== est.id), est]; }
    }
    ctx.paintGuide();
  });
}
