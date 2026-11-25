/**
 * Os menus nativos do app (o da aba da conversa, o do WhatsApp, o dos grupos) não estão no DOM: o controle externo não
 * os via nem escolhia nada neles. Aqui o molde do menu vira uma lista plana com o caminho de cada item. Puro, testado.
 */
export interface ItemDoMolde { label?: string; enabled?: boolean; type?: string; submenu?: unknown; click?: unknown }
export interface ItemPlano { rotulo: string; habilitado: boolean; clicar: (() => void) | null }

/** "Exportar › Markdown (.md)": o caminho pelos submenus; separador não entra; item sem `click` (título) não se escolhe. */
export function achatar(molde: readonly ItemDoMolde[], prefixo = ""): ItemPlano[] {
  const out: ItemPlano[] = [];
  for (const i of molde) {
    if (i.type === "separator" || typeof i.label !== "string") continue;
    const rotulo = prefixo === "" ? i.label : `${prefixo} › ${i.label}`;
    if (Array.isArray(i.submenu)) { out.push(...achatar(i.submenu as ItemDoMolde[], rotulo)); continue; }
    out.push({ rotulo, habilitado: i.enabled !== false, clicar: typeof i.click === "function" ? () => { (i.click as () => void)(); } : null });
  }
  return out;
}

/** O item pedido: pelo rótulo inteiro, ou pelo fim dele ("Markdown (.md)"), sem diferenciar maiúsculas. */
export function acharItem(itens: readonly ItemPlano[], rotulo: string): ItemPlano {
  const q = rotulo.trim().toLowerCase();
  const i = itens.find((x) => x.rotulo.toLowerCase() === q) ?? itens.find((x) => x.rotulo.toLowerCase().endsWith(`› ${q}`));
  if (i === undefined) throw new Error(`o menu aberto não tem "${rotulo}": ${itens.map((x) => x.rotulo).join("; ")}`);
  if (!i.habilitado || i.clicar === null) throw new Error(`"${i.rotulo}" está desligado neste menu`);
  return i;
}
