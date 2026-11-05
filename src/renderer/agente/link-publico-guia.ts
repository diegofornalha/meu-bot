/** Link público da pessoa no guia (tutorial 13): ver o link, publicar e tirar do ar, trocar o nome. */
import type { LinkPublicoInfo, LinkPublicoItem } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { carregando } from "../lib/carregando.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { ctx, ehRemoto } from "../app/ctx.js";
import { registrarFonte } from "../tutoriais/fontes.js";
import { abrirLinkDoChat } from "../navegador/navegador-guia.js";
import { registrarPassos } from "../tutoriais/passos.js";

/** Tutorial 13: o link público da pessoa (null = desligado ou não consultado; `linkPublicoLido` separa os dois). */
export let linkPublicoState: LinkPublicoInfo | null = null;
export let linkPublicoLido = false;
/** false = a janela é do root: sem link por desenho (o tutorial 13 some da lista). */
export let linkPublicoPossivel = true;
/** A máquina tem o Link Público Global? Sem ele o passo diz que é o admin quem instala (não "ainda não ligou"). */
export let linkPublicoGlobal = true;
let linkNomeMsg: { text: string; bad: boolean } | null = null;
let linkNomeOcupado = false;
/** Passo 2: o que está no ar (null = ainda não lido), o publicar em andamento, o nome pedido, e o item armado para tirar do ar (dois cliques, 5 s). */
let linkLista: LinkPublicoItem[] | null = null;
let linkListaLida = false;
let linkListaPedida = false;
let linkPubOcupado = false;
let linkPubNome = "";
let linkRemovendo: string | null = null;
let linkPubMsg: { text: string; bad: boolean; url?: string } | null = null;
let linkRemoverArmado: string | null = null;
let linkRemoverTimer: number | null = null;
export async function refreshLinkLista(): Promise<void> {
  if (!ctx.caps.install || ctx.windowHost === "" || ctx.windowHost === "local") return;
  linkListaPedida = true;
  try { const r = await window.meuBot.linkPublicoLista(); if (r !== null) { linkPublicoState = r.info; linkPublicoLido = true; linkLista = r.itens; } } catch { /* máquina fora: fica o que havia */ }
  linkListaLida = true; linkListaPedida = false;
  ctx.paintGuide();
}
function botaoCopiar(url: string): HTMLButtonElement {
  const copy = el("button", "btn btn-ghost btn-small", "Copiar"); copy.type = "button";
  copy.addEventListener("click", () => { void navigator.clipboard.writeText(url).then(() => { copy.textContent = "Copiado"; window.setTimeout(() => { copy.textContent = "Copiar"; }, 1500); }); });
  return copy;
}
function desarmarRemover(): void { linkRemoverArmado = null; if (linkRemoverTimer !== null) { window.clearTimeout(linkRemoverTimer); linkRemoverTimer = null; } }
export async function refreshLinkPublico(): Promise<void> {
  if (!ctx.caps.install || ctx.windowHost === "" || ctx.windowHost === "local") return;
  try { const r = await window.meuBot.linkPublico(); linkPublicoState = r.info; linkPublicoPossivel = r.possivel; linkPublicoGlobal = r.global; linkPublicoLido = true; } catch { /* máquina fora: fica o que havia */ }
  ctx.paintGuide();
}
/** Tutorial 13: o link (passo 1), o que está no ar (passo 2) ou o campo para trocar o nome (passo 3). */
export function renderLinkPublico(container: HTMLElement, parte: "ver" | "testar" | "nome"): void {
  const box = el("div", "audio-controls");
  const lp = linkPublicoState;
  if (!linkPublicoLido) { box.append(carregando("Consultando a máquina…", "guia-link")); container.append(box); return; }
  if (lp === null) {
    box.append(el("p", "hint", !linkPublicoPossivel ? "Esta janela é da conta root da máquina: o link público é das contas de usuário (box-1, box-2…), não do root." : !linkPublicoGlobal ? "Esta máquina ainda não tem o Link Público Global (o nginx e o túnel da Cloudflare, do root). É o admin quem instala, no meu-bot-admin › Preparar máquina › Link Público Global; até lá, \"Conferir de novo\" não vai achar nada. Depois ele liga o seu link na aba Link Público Global." : "O Link Público Global está nesta máquina, mas o seu link ainda não está ligado. É o admin quem liga, no meu-bot-admin › Link Público Global, na linha da sua conta."));
    const b = el("button", "btn btn-ghost btn-small", "Conferir de novo"); b.type = "button"; b.addEventListener("click", () => { void refreshLinkPublico(); });
    box.append(b); container.append(box); return;
  }
  const row = el("div", "audio-row");
  const a = el("a", "audio-ok", lp.url) as HTMLAnchorElement; a.href = lp.url; a.target = "_blank"; a.rel = "noopener"; row.append(a);
  row.append(botaoCopiar(lp.url)); box.append(row);
  if (parte === "testar") {
    if (!linkListaLida && !linkListaPedida) void refreshLinkLista();
    // Publicar um arquivo deste Mac (o diálogo abre no main), com o nome no link opcional.
    const r1 = el("div", "audio-row");
    const pub = el("button", "btn btn-primary btn-small", linkPubOcupado && linkRemovendo === null ? "Publicando…" : "Publicar um arquivo…"); pub.type = "button"; pub.disabled = linkPubOcupado;
    pub.title = "Escolhe um arquivo deste Mac e põe no ar no seu link; um .md vira página; até 100 MB; um item com o mesmo nome é substituído";
    pub.addEventListener("click", () => {
      linkPubOcupado = true; linkPubMsg = null; desarmarRemover(); ctx.paintGuide();
      const pedido = linkPubNome.trim();
      void window.meuBot.linkPublicoPublicar(pedido === "" ? undefined : pedido)
        .then((r) => { if (r === null) return; linkPublicoState = r.info; linkLista = r.itens; linkListaLida = true; linkPubNome = ""; linkPubMsg = { text: "✓ No ar:", url: r.url, bad: false }; })
        .catch((e: unknown) => { linkPubMsg = { text: `✗ ${ipcErrorText(e)}`, bad: true }; })
        .finally(() => { linkPubOcupado = false; ctx.paintGuide(); });
    });
    const nomeI = el("input") as HTMLInputElement; nomeI.type = "text"; nomeI.placeholder = "nome no link (opcional)"; nomeI.maxLength = 128; nomeI.style.width = "180px"; nomeI.disabled = linkPubOcupado; nomeI.value = linkPubNome;
    nomeI.title = "Vazio = o nome do arquivo. Acentos e espaços viram hífen.";
    nomeI.addEventListener("input", () => { linkPubNome = nomeI.value; });
    r1.append(pub, nomeI); box.append(r1);
    if (linkPubMsg !== null) {
      const pm = el("p", linkPubMsg.bad ? "hint bad-hint" : "hint audio-ok", linkPubMsg.text);
      if (linkPubMsg.url !== undefined) { const u = linkPubMsg.url; const a2 = el("a", "audio-ok", u) as HTMLAnchorElement; a2.href = u; a2.target = "_blank"; a2.rel = "noopener"; pm.append(" ", a2, " ", botaoCopiar(u)); }
      box.append(pm);
    }
    // O que está no ar: abrir, ou tirar do ar em dois cliques (sem confirm(): o botão vira "Tirar mesmo?" por 5 s).
    if (!linkListaLida) box.append(carregando("Vendo o que está no ar…", "guia-link-lista"));
    else if (linkLista === null || linkLista.length === 0) box.append(el("p", "hint", "Nada no ar ainda."));
    else {
      box.append(el("p", "hint", `${linkLista.length} ${linkLista.length === 1 ? "item" : "itens"} no ar em ${lp.url}`));
      for (const it of linkLista) {
        const rowI = el("div", "audio-row");
        const nome = el("span", "", `${it.pasta ? "📁" : "📄"} /${it.nome}${it.pasta ? "/" : ""}`); nome.title = it.url;
        const abrir = el("button", "btn btn-ghost btn-small", "Abrir"); abrir.type = "button"; abrir.addEventListener("click", () => { void abrirLinkDoChat(it.url, false); });
        const armado = linkRemoverArmado === it.nome;
        const tirar = el("button", `btn btn-ghost btn-small${armado ? " bad-hint" : ""}`, linkRemovendo === it.nome ? "Tirando…" : armado ? "Tirar mesmo?" : "Tirar do ar"); tirar.type = "button"; tirar.disabled = linkPubOcupado;
        tirar.addEventListener("click", () => {
          if (!armado) { desarmarRemover(); linkRemoverArmado = it.nome; linkRemoverTimer = window.setTimeout(() => { linkRemoverArmado = null; linkRemoverTimer = null; ctx.paintGuide(); }, 5000); ctx.paintGuide(); return; }
          desarmarRemover(); linkPubOcupado = true; linkRemovendo = it.nome; linkPubMsg = null; ctx.paintGuide();
          void window.meuBot.linkPublicoRemover(it.nome)
            .then((r) => { linkPublicoState = r.info; linkLista = r.itens; linkPubMsg = { text: `✓ /${it.nome} saiu do ar.`, bad: false }; })
            .catch((e: unknown) => { linkPubMsg = { text: `✗ ${ipcErrorText(e)}`, bad: true }; })
            .finally(() => { linkPubOcupado = false; linkRemovendo = null; ctx.paintGuide(); });
        });
        rowI.append(nome, abrir, tirar);
        if (armado) { const c = el("button", "btn btn-ghost btn-small", "Cancelar"); c.type = "button"; c.addEventListener("click", () => { desarmarRemover(); ctx.paintGuide(); }); rowI.append(c); }
        box.append(rowI);
      }
    }
    box.append(el("p", "hint", "Tudo o que está aqui é público na internet, sem senha. Publicar de novo com o mesmo nome substitui."));
    const pedir = el("button", "btn btn-ghost btn-small", "Pedir um link de teste ao agente"); pedir.type = "button";
    pedir.addEventListener("click", () => { void ctx.goToChatFromGuide("Crie uma página HTML simples chamada ola.html com um \"Olá!\" e me dê o link público dela.", "O agente publica a página em ~/publico e responde com a URL; quando houver algo no ar, este passo se conclui sozinho."); });
    const rever = el("button", "btn btn-ghost btn-small", "Conferir"); rever.type = "button"; rever.addEventListener("click", () => { void refreshLinkPublico(); void refreshLinkLista(); });
    const r2 = el("div", "audio-row"); r2.append(pedir, rever); box.append(r2);
  }
  if (parte === "nome") {
    const r2 = el("div", "audio-row");
    const i = el("input") as HTMLInputElement; i.type = "text"; i.value = lp.nome; i.maxLength = 63; i.placeholder = lp.usuario; i.style.width = "160px"; i.disabled = linkNomeOcupado;
    i.title = "Só letras minúsculas, números e hífen (2 a 63 caracteres)";
    const salvar = el("button", "btn btn-primary btn-small", linkNomeOcupado ? "Trocando…" : "Trocar o nome"); salvar.type = "button"; salvar.disabled = linkNomeOcupado;
    const trocar = (): void => {
      const n = i.value.trim().toLowerCase();
      if (n === lp.nome) { linkNomeMsg = { text: "Esse já é o nome do seu link.", bad: false }; ctx.paintGuide(); return; }
      if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(n)) { linkNomeMsg = { text: "Nome inválido: só letras minúsculas, números e hífen (2 a 63 caracteres).", bad: true }; ctx.paintGuide(); return; }
      linkNomeOcupado = true; linkNomeMsg = null; ctx.paintGuide();
      void window.meuBot.linkPublicoNome(n)
        .then((r) => { linkPublicoState = r; linkNomeMsg = { text: `✓ Seu link agora é ${r.url}`, bad: false }; })
        .catch((e: unknown) => { linkNomeMsg = { text: `✗ ${ipcErrorText(e)}`, bad: true }; })
        .finally(() => { linkNomeOcupado = false; ctx.paintGuide(); });
    };
    salvar.addEventListener("click", trocar);
    i.addEventListener("keydown", (ev) => { if (ev.key === "Enter") trocar(); });
    r2.append(i, el("span", "hint", `.${lp.dominio}`), salvar); box.append(r2);
    if (linkNomeMsg !== null) box.append(el("p", linkNomeMsg.bad ? "hint bad-hint" : "hint audio-ok", linkNomeMsg.text));
  }
  container.append(box);
}

/** Liga os passos do link público ao guia; o renderer.ts chama uma vez. */
export function ligarLinkPublicoGuia(): void {
  registrarFonte("linkpublico", () => ({ known: linkPublicoLido || !ehRemoto(), dados: { linkPublico: linkPublicoState, linkPublicoPossivel } }));
  registrarPassos({
    "link-publico-ver": (txt) => renderLinkPublico(txt, "ver"),
    "link-publico-testar": (txt) => renderLinkPublico(txt, "testar"),
    "link-publico-nome": (txt) => renderLinkPublico(txt, "nome"),
  });
}
