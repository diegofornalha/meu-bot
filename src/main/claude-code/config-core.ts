/**
 * Claude Code deste Mac, parte pura: ler o `~/.claude.json` sem se perder em formato quebrado. O `mcpServers` de topo é
 * o escopo user; `projects[pasta].mcpServers` é o escopo local de cada pasta, que vence o user naquela pasta. Quem
 * escreve o arquivo é sempre o `claude` CLI (claude-code/cli.ts); aqui só se lê. Sem Electron: testável com node --test.
 */
export const objeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** `null` = o arquivo não existe; "ilegivel" = não é um objeto JSON (não mexemos nele). */
export function lerConfig(conteudo: string | null): Record<string, unknown> | "ilegivel" | null {
  if (conteudo === null) return null;
  try { const j: unknown = JSON.parse(conteudo); return objeto(j) ? j : "ilegivel"; } catch { return "ilegivel"; }
}

/** As pastas com entrada local do servidor `nome` (só as que ainda existem: o `claude` só a tira rodando dentro dela). */
export function entradasLocais(j: Record<string, unknown>, nome: string, pastaExiste: (pasta: string) => boolean): { pasta: string; entrada: unknown }[] {
  const out: { pasta: string; entrada: unknown }[] = [];
  if (!objeto(j["projects"])) return out;
  for (const [pasta, p] of Object.entries(j["projects"])) {
    if (!objeto(p) || !objeto(p["mcpServers"]) || p["mcpServers"][nome] === undefined || !pastaExiste(pasta)) continue;
    out.push({ pasta, entrada: p["mcpServers"][nome] });
  }
  return out;
}
