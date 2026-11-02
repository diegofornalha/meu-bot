/** Leitura do que os scripts da máquina imprimem (`chave=valor`, uma por linha) e miúdos puros que todo motor usa. */

/** `chave=valor` por linha → Map (a primeira `=` separa; o valor fica como veio, sem trim). */
export const kvOf = (out: string): Map<string, string> => {
  const kv = new Map<string, string>();
  for (const line of out.split("\n")) { const i = line.indexOf("="); if (i > 0) kv.set(line.slice(0, i), line.slice(i + 1)); }
  return kv;
};
/** Como `kvOf`, com trim no valor (o STATUS imprime com espaços sobrando). */
export const kvTrimOf = (out: string): Map<string, string> => {
  const kv = new Map<string, string>();
  for (const line of out.split("\n")) { const i = line.indexOf("="); if (i > 0) kv.set(line.slice(0, i), line.slice(i + 1).trim()); }
  return kv;
};
export const jsonOr = (v: string | undefined): unknown => { try { return JSON.parse(v || "null"); } catch { return null; } };
/** "5511999999999:12@s.whatsapp.net" → "5511999999999"; null se não é um jid de telefone. */
export const phoneOf = (jid: string): string | null => { const m = /^(\d{8,15})[:@]/.exec(jid); return m === null ? null : m[1]!; };

/** "OpenClaw 2026.9.9 em /usr/local/bin (global, todos os usuários)": versão, caminho e se é do sistema ou só deste usuário. */
export function describeInstall(name: string, kv: Map<string, string>): string {
  // "OpenClaw 2026.9.9 (bcfc888)" → "2026.9.9": o hash do commit não ajuda ninguém na tela.
  const ver = (kv.get("ver") ?? "").replace(new RegExp(`^${name}\\s*`, "i"), "").replace(/\s*\([0-9a-f]{6,}\)\s*$/i, "").trim();
  const bin = kv.get("bin") ?? "";
  const real = kv.get("real") ?? "";
  const where = bin === "" ? "" : ` em ${bin.replace(/\/[^/]+$/, "")}`;
  // /data/data/<app>/ é a área do app no Android (Termux): também é só desta conta.
  const scope = bin === "" ? "" : bin.startsWith("/home/") || bin.startsWith("/Users/") || bin.startsWith("/root/") || bin.startsWith("/data/data/") ? " (só deste usuário)" : ` (global, todos os usuários${real !== "" && real !== bin ? `; ${real.replace(/\/[^/]+$/, "")}` : ""})`;
  return `${name}${ver === "" ? "" : ` ${ver}`}${where}${scope}`;
}
