/**
 * Permissões das Ferramentas (parte pura, testada): o que a pessoa respondeu ao cartão "O que vai acontecer?" da
 * conversa. "Permitir sempre" e "Nunca permitir" ficam guardados por conta, app e ação; "Permitir uma vez" não fica.
 * A forma é a das permissões de câmera e microfone do Navegador (navegador/nav-permissoes-core.ts). Não existe
 * "permitir tudo": cada ação de cada app é liberada por si, e a página Ferramentas mostra e revoga o que foi dado.
 */
export type DecisaoDoCartao = "sempre" | "agora" | "nunca" | "cancelar";
/** conta → app (slug) → ação → true (permitir sempre) | false (nunca). Ausente = perguntar. */
export type PermissoesGuardadas = Record<string, Record<string, Record<string, boolean>>>;
export interface PermissaoDada { app: string; acao: string; permite: boolean }

/** O que já foi decidido para esta ação: "sempre", "nunca" ou null (perguntar). */
export function permissaoGuardada(g: PermissoesGuardadas, conta: string, app: string, acao: string): "sempre" | "nunca" | null {
  const v = g[conta]?.[app]?.[acao];
  return v === true ? "sempre" : v === false ? "nunca" : null;
}
/** Grava "sempre" ou "nunca"; "agora" e "cancelar" não ficam guardados. Devolve um objeto novo (o de entrada não muda). */
export function guardarPermissao(g: PermissoesGuardadas, conta: string, app: string, acao: string, d: DecisaoDoCartao): PermissoesGuardadas {
  if (d !== "sempre" && d !== "nunca") return g;
  return { ...g, [conta]: { ...(g[conta] ?? {}), [app]: { ...(g[conta]?.[app] ?? {}), [acao]: d === "sempre" } } };
}
/** Tira uma permissão guardada (o "revogar" da página Ferramentas): a ação volta a perguntar. Limpa o que ficou vazio. */
export function revogarPermissao(g: PermissoesGuardadas, conta: string, app: string, acao: string): PermissoesGuardadas {
  if (g[conta]?.[app]?.[acao] === undefined) return g;
  const doApp = { ...g[conta]![app]! }; delete doApp[acao];
  const daConta = { ...g[conta]! };
  if (Object.keys(doApp).length === 0) delete daConta[app]; else daConta[app] = doApp;
  const out = { ...g };
  if (Object.keys(daConta).length === 0) delete out[conta]; else out[conta] = daConta;
  return out;
}
/** As permissões guardadas de uma conta, para a página Ferramentas, em ordem de app e ação. */
export function permissoesDaConta(g: PermissoesGuardadas, conta: string): PermissaoDada[] {
  const out: PermissaoDada[] = [];
  for (const [app, acoes] of Object.entries(g[conta] ?? {})) for (const [acao, permite] of Object.entries(acoes)) out.push({ app, acao, permite });
  return out.sort((a, b) => a.app.localeCompare(b.app) || a.acao.localeCompare(b.acao));
}
/** Lê o que veio do disco: qualquer coisa fora da forma é descartada (arquivo de outra versão, editado à mão). */
export function lerPermissoes(bruto: unknown): PermissoesGuardadas {
  const out: PermissoesGuardadas = {};
  const obj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
  if (!obj(bruto)) return out;
  for (const [conta, apps] of Object.entries(bruto)) {
    if (!obj(apps)) continue;
    for (const [app, acoes] of Object.entries(apps)) {
      if (!obj(acoes) || !/^[a-z0-9_]{2,60}$/.test(app)) continue;
      for (const [acao, v] of Object.entries(acoes)) {
        if (typeof v !== "boolean" || !/^[A-Za-z0-9_.:-]{1,120}$/.test(acao)) continue;
        ((out[conta] ??= {})[app] ??= {})[acao] = v;
      }
    }
  }
  return out;
}
