/**
 * Avatar + menu da conta meu-bot (molde Rambox), compartilhado pela janela da máquina (barra do topo) e pelo seletor
 * (rodapé). Quem usa dá os botões-avatar, a ContaView atual e a API (entrar/cancelar/sair/openExternal); o menu abre
 * sob o botão clicado e fecha com clique fora, Esc, redimensionar ou mudança da conta.
 */
import type { ContaView } from "../../shared/ipc";
import { el } from "./dom.js";
import { resumoPlano } from "./conta-resumo.js";
import { CAMINHO_MARKETPLACE } from "./pro.js";

export interface ContaMenuApi { contaEntrar(): Promise<ContaView>; contaCancelar(): Promise<ContaView>; contaSair(): Promise<ContaView>; contaAbrirConsole(caminho: string): Promise<void>; openExternal(url: string): Promise<void> }
export interface ItemExtra { ico: string; texto: string; acao: () => void; atalho?: string }
export interface ContaMenuDeps {
  api: ContaMenuApi;
  view: () => ContaView | null;
  /** O que entrar/cancelar/sair devolveram: quem usa guarda e repinta. */
  aoMudar: (v: ContaView) => void;
  /** Itens depois do bloco da conta (Configurações, Tutoriais, Novidades…). */
  extras?: () => ItemExtra[];
}

export const inicialDe = (c: ContaView["conta"]): string => (c === null ? "?" : (c.nome ?? c.email).trim().charAt(0).toUpperCase() || "?");
const fotoOk = (v: ContaView): string | null => (v.foto !== null && v.foto.startsWith("data:image/") ? v.foto : null);
/** A foto dentro do elemento; se não carregar (bloqueio, bytes ruins), fica a inicial do nome no lugar. */
function porFoto(alvo: HTMLElement, v: ContaView): void {
  const foto = fotoOk(v);
  if (foto === null) { alvo.textContent = inicialDe(v.conta); return; }
  const img = document.createElement("img"); img.src = foto; img.alt = "";
  img.addEventListener("error", () => { alvo.replaceChildren(); alvo.textContent = inicialDe(v.conta); });
  alvo.replaceChildren(img);
}

export function montarMenuConta(botoes: HTMLButtonElement[], deps: ContaMenuDeps): { pintar: () => void; fechar: () => void } {
  let menu: HTMLElement | null = null;
  const fechar = (): void => { if (menu !== null) { menu.remove(); menu = null; } for (const b of botoes) b.setAttribute("aria-expanded", "false"); };
  const pintar = (): void => {
    const v = deps.view();
    for (const b of botoes) {
      b.hidden = v === null;
      if (v === null) continue;
      b.replaceChildren();
      const c = v.conta;
      if (v.situacao === "dentro" && c !== null) {
        b.classList.remove("fora");
        porFoto(b, v);
        b.title = `${c.email} · ${resumoPlano(c).rotulo}`;
      } else { b.classList.add("fora"); b.textContent = "⚇"; b.title = v.situacao === "entrando" ? "Aguardando o login no navegador…" : "Entrar com sua conta meu-bot"; }
    }
  };
  const item = (ico: string, texto: string, cls: string, acao: () => void, atalho?: string): HTMLButtonElement => {
    const b = el("button", `cm-item${cls === "" ? "" : ` ${cls}`}`); b.type = "button";
    b.append(el("span", "cm-ico", ico), el("span", "", texto));
    if (atalho !== undefined) b.append(el("span", "cm-atalho", atalho));
    b.addEventListener("click", () => { fechar(); acao(); });
    return b;
  };
  const abrir = (b: HTMLButtonElement): void => {
    const v = deps.view();
    if (v === null) return;
    if (menu !== null) { fechar(); return; }
    const m = el("div", "conta-menu"); m.setAttribute("role", "menu");
    const c = v.conta;
    // O console abre já entrado: o main pede um código com a sessão do app e o põe no #fragment da URL.
    const externo = (caminho: string): void => { void deps.api.contaAbrirConsole(caminho).catch(() => undefined); };
    const chama = (p: Promise<ContaView>): void => { void p.then(deps.aoMudar).catch(() => undefined); };
    if (v.situacao === "dentro" && c !== null) {
      const r = resumoPlano(c);
      const topo = el("div", "cm-topo");
      const av = el("div", "cm-avatar"); porFoto(av, v);
      topo.append(av, el("span", `cm-selo ${r.selo}`, r.rotulo), el("span", "cm-nome", c.nome ?? c.email));
      if (c.nome !== null) topo.append(el("span", "cm-email", c.email));
      m.append(topo);
      if (r.prazo !== null) m.append(item(r.vencido ? "⚠" : "🎁", r.prazo, `cm-trial${r.vencido ? " vencido" : ""}`, () => externo("/account/plan")));
      m.append(item("👤", "Perfil", "", () => externo("/account/profile")), item("▤", "Plano e pagamento", "", () => externo("/account/plan")), item("⊞", "Marketplace", "", () => externo(CAMINHO_MARKETPLACE)), item("▭", "Devices", "", () => externo("/account/devices")));
      for (const o of c.orgs) m.append(item("▣", o.nome, "", () => externo(`/organizations/${o.slug}/members`)));
      // Super admin: as Janelas de suporte (visão geral de todas as pessoas: VPS, usuários e este Mac) no site; o resto do
      // console fica a um clique de lá. Admin comum segue com o console.
      if (c.admin === "super") m.append(item("◧", "Janelas de suporte", "", () => externo("/support-window")));
      else if (c.admin !== null) m.append(item("★", "Console do admin", "", () => externo("/account/overview")));
      m.append(el("div", "cm-sep"));
    } else {
      m.append(el("div", "cm-dica", v.situacao === "entrando" ? "Aguardando login… conclua na janela do navegador." : "Você ainda não entrou com sua conta meu-bot neste Mac."));
      if (v.situacao === "entrando") m.append(item("↻", "Reabrir o navegador", "", () => chama(deps.api.contaEntrar())), item("✕", "Cancelar o login", "", () => chama(deps.api.contaCancelar())));
      else m.append(item("→", "Continuar com seu navegador", "", () => chama(deps.api.contaEntrar())));
      if (v.situacao === "erro" && v.erro !== null) m.append(el("div", "cm-dica", `O último login não terminou: ${v.erro}`));
      m.append(el("div", "cm-sep"));
    }
    const extras = deps.extras?.() ?? [];
    for (const x of extras) m.append(item(x.ico, x.texto, "", x.acao, x.atalho));
    if (v.situacao === "dentro") { if (extras.length > 0) m.append(el("div", "cm-sep")); m.append(item("⏻", "Sair", "cm-sair", () => chama(deps.api.contaSair()))); }
    document.body.append(m);
    const r = b.getBoundingClientRect();
    const abaixo = r.bottom + 6 + 320 < window.innerHeight || r.top < window.innerHeight / 2;
    if (abaixo) m.style.top = `${Math.round(r.bottom + 6)}px`; else m.style.bottom = `${Math.round(window.innerHeight - r.top + 6)}px`;
    const direita = window.innerWidth - r.right;
    if (direita < window.innerWidth / 2) m.style.right = `${Math.max(8, Math.round(direita))}px`; else m.style.left = `${Math.max(8, Math.round(r.left))}px`;
    b.setAttribute("aria-expanded", "true");
    menu = m;
  };
  for (const b of botoes) b.addEventListener("click", (ev) => { ev.stopPropagation(); abrir(b); });
  document.addEventListener("click", (ev) => { if (menu !== null && !menu.contains(ev.target as Node)) fechar(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && menu !== null) fechar(); });
  window.addEventListener("resize", fechar);
  pintar();
  return { pintar, fechar };
}
