/**
 * Gmail no guia (tutorial 15, Pro): o plano, a Conta Google da máquina e os três fatos que a página Gmail conta ao
 * guia (leu, buscou, lixeira + desfazer), cada um com o botão manual do guia para quem já fez por fora. O estado da conta vem do main (`googleContaStatus`) e do evento
 * `google-conta:changed`; os fatos chegam por `gmailGuiaFato`, que a página chama (`aoUsar`). Primeiro tutorial
 * feito pela receita "Como adicionar um tutorial" do ARQUITETURA.md.
 */
import type { GoogleContaStatus } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { browserAccess, pagamentoDoBloqueio, proBlockText } from "../lib/pro.js";
import { blocoPagamento } from "../lib/aviso-pagamento.js";
import { hostLabel } from "../lib/probe-text.js";
import { ctx } from "../app/ctx.js";
import type { GmailFato } from "./gmail-page.js";
import { registrarPassos } from "../tutoriais/passos.js";
import { registrarFonte } from "../tutoriais/fontes.js";

/** Conta Google da máquina, como o guia a vê (null = ainda não consultada). */
let status: GoogleContaStatus | null = null;
/** Fatos que não se desfazem (viram `lembrar` nos passos); só valem nesta janela até o guia gravar. */
let lido = false; let buscou = false; let lixeira = false; let desfez = false;
let proPedido = false;

/** A página Gmail conta o que a pessoa fez; o guia repinta e marca o passo. */
export function gmailGuiaFato(fato: GmailFato): void {
  if (fato === "lido") lido = true; else if (fato === "buscou") buscou = true; else if (fato === "lixeira") lixeira = true; else desfez = true;
  ctx.paintGuide();
}
export async function refreshGmailGuia(): Promise<void> {
  try { status = await window.meuBot.googleContaStatus(); } catch { /* sem resposta: fica o que havia */ }
  ctx.paintGuide();
}
const acesso = (): ReturnType<typeof browserAccess> | null => !ctx.navLicenseAsked ? null : browserAccess(ctx.license, ctx.windowHost, ctx.caps.planoExigido, ctx.caps.produto);

/** Passo 1: o plano desta máquina e o pedido ao admin (o mesmo desenho do Navegador). */
function renderGmailPro(txt: HTMLElement): void {
  const box = el("div", "audio-controls");
  const a = acesso();
  if (a === null) { box.append(el("p", "hint", "Consultando a licença desta máquina…")); txt.append(box); return; }
  if (a === "ok") { box.append(el("p", "audio-ok", `✓ plano Pro ativo em ${hostLabel(ctx.windowHost)}`)); txt.append(box); return; }
  const t = proBlockText(a, ctx.license, "google", ctx.caps.produto);
  box.append(el("p", "hint", t.text));
  const pg = pagamentoDoBloqueio(a, ctx.license);
  if (pg !== null) box.append(blocoPagamento(pg));
  const row = el("div", "audio-row");
  if (t.askAdmin) {
    const b = el("button", "btn btn-primary btn-small", proPedido ? "Pedido enviado ao admin ✓" : a === "assinatura" ? "Avisar o admin" : "Pedir o Pro ao admin"); b.type = "button"; b.disabled = proPedido;
    b.addEventListener("click", () => { b.disabled = true; void window.meuBot.browserRequestPro().then(() => { proPedido = true; ctx.paintGuide(); }).catch(() => { b.disabled = false; }); });
    row.append(b);
  }
  const again = el("button", "btn btn-ghost btn-small", "Conferir de novo"); again.type = "button";
  again.addEventListener("click", () => { void ctx.refreshLicense().then(() => ctx.paintGuide()); });
  row.append(again); box.append(row); txt.append(box);
}
/** Passo 2: abrir a Conta Google (entrar ou reautorizar); a página dela explica o resto. */
function renderGmailConectar(txt: HTMLElement): void {
  const row = el("div", "audio-row");
  if (status !== null && status.conectado && status.precisaReconectar) row.append(el("span", "hint", "A conta está nesta máquina, mas precisa reautorizar."));
  const b = el("button", "btn btn-primary btn-small", status?.conectado === true ? "Abrir a Conta Google" : "Entrar com Google"); b.type = "button";
  b.addEventListener("click", () => { ctx.contaGooglePage?.open(); });
  row.append(b); txt.append(row);
}
/** Passos 3 e 4: só o caminho até a página Gmail; o fato chega pela própria página. */
function renderGmailAbrir(txt: HTMLElement): void {
  const row = el("div", "audio-row");
  const b = el("button", "btn btn-primary btn-small", "Abrir o Gmail"); b.type = "button";
  b.addEventListener("click", () => { ctx.gmailPage?.open(); });
  row.append(b); txt.append(row);
}
/** Passo 5: conta de antes da lixeira (sem gmail.modify) precisa reconectar uma vez; o resto é a página Gmail. */
function renderGmailLixeira(txt: HTMLElement): void {
  if (status?.gmailEscreve === false) {
    txt.append(el("p", "hint", "A autorização desta conta é de antes da lixeira: reconecte a Conta Google uma vez (a leitura e a busca já funcionam)."));
    const r = el("div", "audio-row"); const b = el("button", "btn btn-ghost btn-small", "Reconectar na Conta Google"); b.type = "button";
    b.addEventListener("click", () => { ctx.contaGooglePage?.open(); }); r.append(b); txt.append(r);
  }
  renderGmailAbrir(txt);
}

/** Liga os passos e a fonte do Gmail ao guia; o renderer.ts chama uma vez. */
export function ligarGmailGuia(): void {
  registrarPassos({ "gmail-pro": renderGmailPro, "gmail-conectar": renderGmailConectar, "gmail-ler": renderGmailAbrir, "gmail-buscar": renderGmailAbrir, "gmail-lixeira": renderGmailLixeira });
  registrarFonte("google", () => ({
    known: status !== null,
    dados: { gmail: { access: acesso(), conectado: status?.conectado === true && !status.precisaReconectar, precisaReconectar: status?.precisaReconectar === true, gmailEscreve: status?.gmailEscreve ?? null, lido, buscou, lixeira, desfez } },
  }));
  window.meuBot.on("google-conta:changed", (st) => { status = st; ctx.paintGuide(); });
}
