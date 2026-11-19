/**
 * Conta meu-bot deste Mac, lado da tela: guarda a última ContaView que o main mandou, avisa quem desenha com ela
 * (painel "Sua conta" das Configurações, bloqueio Pro do Navegador) e monta o bloco "Entrar / e-mail · Sair".
 */
import type { ContaView } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { ctx, ehRemoto } from "../app/ctx.js";
import { relerPlano } from "../lib/aviso-pagamento.js";
import { caminhoDoPlano, fraseDaLicencaDaConta } from "../lib/pro.js";
import { hostLabel } from "../lib/probe-text.js";
import { montarMenuConta } from "../lib/conta-menu.js";

let view: ContaView | null = null;
const ouvintes = new Set<() => void>();
export const contaAtual = (): ContaView | null => view;
export const contaEntrou = (): boolean => view !== null && view.situacao === "dentro";
export function aoMudarConta(cb: () => void): () => void { ouvintes.add(cb); return () => ouvintes.delete(cb); }
const mudou = (v: ContaView): void => { view = v; for (const cb of ouvintes) cb(); };
/** Na abertura: pega a conta e passa a receber as mudanças. */
export function ligarConta(): void {
  window.meuBot.on("conta:changed", mudou);
  void window.meuBot.contaGet().then(mudou).catch(() => undefined);
  ligarMenuConta();
}

/* ---------- Avatar no topo + menu da conta (molde Rambox): módulo compartilhado com o seletor ---------- */
let menuConta: { pintar: () => void; fechar: () => void } | null = null;
function ligarMenuConta(): void {
  const botoes = ["conta-btn", "conta-btn-mini"].map((id) => document.getElementById(id) as HTMLButtonElement | null).filter((b): b is HTMLButtonElement => b !== null);
  if (botoes.length === 0) return;
  menuConta = montarMenuConta(botoes, {
    api: window.meuBot, view: () => view, aoMudar: mudou,
    extras: () => [
      { ico: "⚙", texto: "Configurações", acao: () => ctx.settingsBtn.click(), atalho: "⌘," },
      { ico: "▦", texto: "Tutoriais", acao: () => ctx.openPage(ctx.tutoriaisPage) },
      { ico: "📣", texto: "Novidades", acao: () => { void window.meuBot.openExternal("https://github.com/diegofornalha/meu-bot/blob/main/docs/CHANGELOG.md").catch(() => undefined); } },
    ],
  });
  aoMudarConta(() => { menuConta?.fechar(); menuConta?.pintar(); });
}

/**
 * A licença da conta na máquina desta janela: ela já a usa ("Tirar o Pro desta máquina", em dois toques), a conta tem
 * o que levar ("Usar o meu Pro nesta máquina"), ou nada disso (só o que o admin gravou).
 */
function blocoMaquina(c: ContaView, repintar: () => void): HTMLElement {
  const box = el("div", "conta-maquina");
  const nota = el("p", "hint"); nota.hidden = true;
  const dizer = (t: string): void => { nota.hidden = false; nota.textContent = t; };
  const acoes = el("div", "actions");
  const onde = hostLabel(ctx.windowHost);
  const rodar = (b: HTMLButtonElement, rotulo: string, acao: () => Promise<{ ok: true } | { ok: false; erro: string; semVaga?: string[] }>): void => {
    const antes = b.textContent; b.disabled = true; b.textContent = rotulo;
    void acao().then(async (r) => {
      if (r.ok) { await relerPlano(); repintar(); return; }
      b.disabled = false; b.textContent = antes;
      dizer(r.semVaga !== undefined && r.semVaga.length > 0 ? `A sua conta já usa a licença em ${r.semVaga.join(", ")}. Tire de lá primeiro.` : `Não deu certo: ${r.erro}`);
    }, (err: unknown) => { b.disabled = false; b.textContent = antes; dizer(`Não deu certo: ${ipcErrorText(err)}`); });
  };
  if (ctx.license?.origem === "conta") {
    const frase = fraseDaLicencaDaConta(onde, ctx.license.avisoRenovacao);
    box.append(el("p", "hint", `${frase.alerta ? "⚠ " : ""}${frase.texto}`));
    const tirar = el("button", "btn btn-ghost btn-small", "Tirar o Pro desta máquina"); tirar.type = "button";
    tirar.addEventListener("click", () => {
      if (tirar.dataset.confirma !== "1") { tirar.dataset.confirma = "1"; tirar.textContent = "Toque de novo para tirar"; setTimeout(() => { if (tirar.isConnected && !tirar.disabled) { delete tirar.dataset.confirma; tirar.textContent = "Tirar o Pro desta máquina"; } }, 5000); return; }
      rodar(tirar, "Tirando…", () => window.meuBot.planoTirarDaConta());
    });
    acoes.append(tirar);
  } else if (c.conta !== null && caminhoDoPlano({ remoto: true, conta: c.conta.licenca, maquinaLimite: c.conta.maquinaLimite, origem: ctx.license?.origem }) === "usar-da-conta") {
    const vagas = c.conta.maquinaLimite ?? 1;
    box.append(el("p", "hint", `A sua conta tem uma licença que ${onde} ainda não usa. Ela vale em ${vagas === 1 ? "uma máquina por vez" : `${vagas} máquinas ao mesmo tempo`}.`));
    const usar = el("button", "btn btn-primary btn-small", c.conta.licenca.plan === "pro" ? "Usar o meu Pro nesta máquina" : "Usar a minha assinatura nesta máquina"); usar.type = "button";
    usar.addEventListener("click", () => rodar(usar, "Aplicando nesta máquina…", () => window.meuBot.planoUsarDaConta()));
    acoes.append(usar);
  } else return box;
  box.append(acoes, nota);
  return box;
}

/** O bloco da conta para o painel "Sua conta": botão Entrar, "aguardando o navegador", ou e-mail com Sair. */
export function blocoConta(): HTMLElement {
  const box = el("div", "conta-bloco");
  const pinta = (): void => {
    box.replaceChildren();
    const c = view;
    if (c === null) { box.append(el("p", "hint", "Lendo a conta…")); return; }
    if (c.situacao === "dentro" && c.conta !== null) {
      const linha = el("p", "", "");
      linha.append(el("strong", "", c.conta.email), document.createTextNode(c.conta.nome !== null ? ` · ${c.conta.nome}` : ""), document.createTextNode(c.conta.admin !== null ? " · admin" : ""));
      const sair = el("button", "btn btn-ghost", "Sair"); sair.type = "button";
      sair.addEventListener("click", () => { sair.disabled = true; void window.meuBot.contaSair().then(mudou).catch((err: unknown) => { sair.disabled = false; box.append(el("p", "error", `Não consegui sair: ${ipcErrorText(err)}`)); }); });
      const acoes = el("div", "actions"); acoes.append(sair);
      const este = c.conta.devices.find((d) => d.este);
      box.append(linha, el("p", "hint", `Plano da conta: ${c.conta.licenca.plan === "pro" ? "Pro" : "Free"} · ${c.conta.devices.length} device${c.conta.devices.length === 1 ? "" : "s"}${c.conta.pedidos > 0 ? ` · ${c.conta.pedidos} pedido${c.conta.pedidos === 1 ? "" : "s"} aberto${c.conta.pedidos === 1 ? "" : "s"}` : ""}.${ehRemoto() ? "" : " Este Mac usa o plano da conta."}`));
      if (ehRemoto()) box.append(blocoMaquina(c, pinta));
      if (este !== undefined && este.status === "pending") box.append(el("p", "error", `Este Mac aguarda a liberação do admin: a conta já usa ${c.conta.licenca.deviceLimit} device${c.conta.licenca.deviceLimit === 1 ? "" : "s"}.`));
      box.append(acoes);
      return;
    }
    if (c.situacao === "entrando") {
      const reabrir = el("button", "btn btn-ghost", "Reabrir o navegador"); reabrir.type = "button";
      reabrir.addEventListener("click", () => { reabrir.disabled = true; void window.meuBot.contaEntrar().then(mudou).catch(() => { reabrir.disabled = false; }); });
      const cancelar = el("button", "btn btn-ghost btn-small", "Cancelar"); cancelar.type = "button";
      cancelar.addEventListener("click", () => { void window.meuBot.contaCancelar().then(mudou).catch(() => undefined); });
      const acoes = el("div", "actions"); acoes.append(reabrir, cancelar);
      box.append(el("p", "", "Aguardando login…"), el("p", "hint", "Conclua o login na janela do navegador que acabou de abrir."), acoes);
      return;
    }
    const entrar = el("button", "btn btn-primary", "Continuar com seu navegador"); entrar.type = "button";
    entrar.addEventListener("click", () => { entrar.disabled = true; void window.meuBot.contaEntrar().then(mudou).catch((err: unknown) => { entrar.disabled = false; box.append(el("p", "error", `Não consegui abrir o login: ${ipcErrorText(err)}`)); }); });
    const acoes = el("div", "actions"); acoes.append(entrar);
    box.append(el("p", "", "Você ainda não entrou com sua conta meu-bot neste Mac."), el("p", "hint", "O login abre no seu navegador e volta para o app sozinho. O plano free continua funcionando sem conta."));
    if (c.situacao === "erro" && c.erro !== null) box.append(el("p", "error", `O último login não terminou: ${c.erro}`));
    box.append(acoes);
  };
  pinta();
  // Enquanto o bloco está na tela, repinta a cada mudança (o deep link chega com o painel aberto).
  const solta = aoMudarConta(() => { if (box.isConnected) pinta(); else solta(); });
  return box;
}
