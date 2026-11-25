/**
 * Abre um menu nativo lembrando o que ele tem, para o controle externo ler (menu_ler) e escolher (menu_escolher).
 * Um menu por vez: o de cima é sempre o último aberto. Para a pessoa nada muda.
 */
import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { acharItem, achatar, type ItemPlano } from "./menu-aberto-core";

let aberto: { win: BrowserWindow; menu: Menu; itens: ItemPlano[] } | null = null;

export function abrirMenu(win: BrowserWindow, molde: MenuItemConstructorOptions[], aoFechar: () => void): void {
  const menu = Menu.buildFromTemplate(molde);
  aberto = { win, menu, itens: achatar(molde) };
  menu.popup({ window: win, callback: () => { if (aberto?.menu === menu) aberto = null; aoFechar(); } });
}

export const menuAberto = (): { rotulo: string; habilitado: boolean }[] | null => (aberto === null ? null : aberto.itens.map((i) => ({ rotulo: i.rotulo, habilitado: i.habilitado && i.clicar !== null })));

/** Escolhe o item (como o clique da pessoa) ou só fecha o menu. O fechamento adia o "nada escolhido"; o clique chega antes. */
export function escolherNoMenu(rotulo: unknown, fechar: unknown): { escolhido: string | null } {
  const a = aberto;
  if (a === null) throw new Error("nenhum menu aberto: abra um com ui_clicar direito=true (na aba de uma conversa, num contato do WhatsApp)");
  if (fechar === true) { a.menu.closePopup(a.win); return { escolhido: null }; }
  if (typeof rotulo !== "string" || rotulo.trim() === "") throw new Error("diga o rotulo do item (veja menu_ler) ou fechar=true");
  const item = acharItem(a.itens, rotulo);
  a.menu.closePopup(a.win);
  item.clicar?.();
  return { escolhido: item.rotulo };
}
