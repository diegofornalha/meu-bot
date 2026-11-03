/**
 * Sincronização do modelo de máquinas (config/ssh-hosts.conf) com o ~/.ssh/config: calcula o que
 * falta e o texto a acrescentar. Puro (sem fs, sem Electron): testável com node --test.
 *
 * Regras: um Host que já existe no arquivo local nunca é alterado; só entram os Host e os Include
 * ausentes, sempre no fim do arquivo, sob um comentário com a data. Hosts que existem só no Mac são
 * relatados, para quem quiser levá-los para o modelo versionado.
 */

export interface SshBlock { aliases: string[]; text: string }
export interface SshConfigParsed { includes: string[]; blocks: SshBlock[] }

const WILDCARD = /[*?!]/;

/** Divide o texto em linhas de Include (em qualquer nível) e blocos `Host …` com seu texto. */
export function parseSshConfig(text: string): SshConfigParsed {
  const includes: string[] = [];
  const blocks: SshBlock[] = [];
  let current: { aliases: string[]; lines: string[] } | null = null;
  const flush = (): void => {
    if (current === null) return;
    while (current.lines.length > 0 && current.lines[current.lines.length - 1]!.trim() === "") current.lines.pop();
    blocks.push({ aliases: current.aliases, text: current.lines.join("\n") });
    current = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^(\S+)\s*(?:=|\s)\s*(.*)$/.exec(line);
    const key = m?.[1]?.toLowerCase();
    const value = m?.[2]?.trim() ?? "";
    if (key === "host") {
      flush();
      current = { aliases: value.split(/\s+/).filter((a) => a !== ""), lines: [raw] };
      continue;
    }
    if (key === "include") { for (const p of value.split(/\s+/)) if (p !== "") includes.push(p); }
    if (current !== null) current.lines.push(raw);
  }
  flush();
  return { includes, blocks };
}

/** Caminho de Include normalizado para comparar: `~` → home, relativo → ~/.ssh/. */
export function normalizeInclude(pattern: string, home: string): string {
  if (pattern.startsWith("~/")) return `${home}/${pattern.slice(2)}`;
  if (pattern === "~") return home;
  if (pattern.startsWith("/")) return pattern;
  return `${home}/.ssh/${pattern}`;
}

export interface SshSyncPlan {
  /** Linhas `Include …` do modelo que faltam no arquivo local (texto original do modelo). */
  includesToAdd: string[];
  /** Blocos do modelo cujos aliases não existem no arquivo local. */
  hostsToAdd: SshBlock[];
  /** Aliases do modelo que já existiam (mantidos como estão). */
  kept: string[];
  /** Aliases só do arquivo local, sem curinga, que o modelo não conhece. */
  onlyLocal: string[];
  /** Aliases do modelo que a pessoa removeu pelo seletor (marca `# meu-bot: não sincronizar …`): não voltam. */
  skipped: string[];
  /** Aliases do modelo cuja máquina (HostName, User, Port) já existe no Mac com outro nome: não entram de novo. */
  sameTarget: { alias: string; as: string }[];
}

const plainAliases = (blocks: SshBlock[]): string[] => blocks.flatMap((b) => b.aliases).filter((a) => !WILDCARD.test(a));

/** Marca que "Remover do seletor" deixa no ~/.ssh/config: o sync não traz esses aliases de volta do modelo. */
const SKIP_RE = /^\s*#\s*meu-bot:\s*não sincronizar\s+(.+?)\s*$/i;
export const skipLine = (host: string): string => `# meu-bot: não sincronizar ${host}`;
export function skippedAliases(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const m = SKIP_RE.exec(raw);
    if (m !== null) for (const a of m[1]!.split(/\s+/)) if (a !== "") out.add(a);
  }
  return [...out];
}

/** Destino de um bloco (`user@hostname:porta`, porta 22 por padrão), para reconhecer a mesma máquina sob outro nome; null sem HostName. */
export function targetOf(block: SshBlock): string | null {
  let hostName: string | null = null; let user = ""; let port = "22";
  for (const raw of block.text.split(/\r?\n/)) {
    const m = /^\s*(\S+)\s*(?:=|\s)\s*(.*)$/.exec(raw);
    if (m === null) continue;
    const k = m[1]!.toLowerCase(); const v = m[2]!.trim();
    if (k === "hostname") hostName = v.toLowerCase(); else if (k === "user") user = v; else if (k === "port") port = v;
  }
  return hostName === null ? null : `${user}@${hostName}:${port}`;
}

/**
 * `includedTexts`: conteúdo dos arquivos que o ~/.ssh/config inclui (o Cursor deste Mac pode ter a lista dele num
 * Include): máquina que está lá conta como existente. Em 3/11 o sync recriava agente-box e agente-root já presentes
 * no cursor_config, trazia de volta o que a pessoa tinha removido e repetia a VM que ela tinha renomeado.
 */
export function planSshSync(templateText: string, currentText: string, home: string, includedTexts: readonly string[] = []): SshSyncPlan {
  const tpl = parseSshConfig(templateText);
  const cur = parseSshConfig(currentText);
  const allBlocks = [...cur.blocks, ...includedTexts.flatMap((t) => parseSshConfig(t).blocks)];
  const curIncludes = new Set(cur.includes.map((p) => normalizeInclude(p, home)));
  const includesToAdd = tpl.includes.filter((p) => !curIncludes.has(normalizeInclude(p, home)));
  const curAliases = new Set(plainAliases(allBlocks));
  const skip = new Set(skippedAliases(currentText));
  const targets = new Map<string, string>();
  for (const b of allBlocks) {
    const t = targetOf(b); const a = b.aliases.find((x) => !WILDCARD.test(x));
    if (t !== null && a !== undefined && !targets.has(t)) targets.set(t, a);
  }
  const hostsToAdd: SshBlock[] = [];
  const kept: string[] = [];
  const skipped: string[] = [];
  const sameTarget: { alias: string; as: string }[] = [];
  for (const b of tpl.blocks) {
    const plain = b.aliases.filter((a) => !WILDCARD.test(a));
    if (plain.length === 0) continue;
    if (plain.some((a) => curAliases.has(a))) { kept.push(...plain.filter((a) => curAliases.has(a))); continue; }
    if (plain.some((a) => skip.has(a))) { skipped.push(...plain.filter((a) => skip.has(a))); continue; }
    const t = targetOf(b); const as = t === null ? undefined : targets.get(t);
    if (as !== undefined) { sameTarget.push({ alias: plain[0]!, as }); continue; }
    hostsToAdd.push(b);
  }
  const tplAliases = new Set(plainAliases(tpl.blocks));
  const onlyLocal = [...new Set(plainAliases(cur.blocks))].filter((a) => !tplAliases.has(a));
  return { includesToAdd, hostsToAdd, kept, onlyLocal, skipped, sameTarget };
}

/** Texto a acrescentar no fim do ~/.ssh/config (vazio se não há nada a fazer). */
export function renderSshAppend(plan: SshSyncPlan, stamp: string): string {
  if (plan.includesToAdd.length === 0 && plan.hostsToAdd.length === 0) return "";
  const parts: string[] = [`# meu-bot: máquinas sincronizadas em ${stamp}`];
  for (const inc of plan.includesToAdd) parts.push(`Include ${inc}`);
  for (const b of plan.hostsToAdd) parts.push("", b.text);
  return `\n${parts.join("\n")}\n`;
}

/** Valores de IdentityFile do modelo, com `~` expandido, para avisar se a chave não está no Mac. */
export function identityFiles(templateText: string, home: string): string[] {
  const out = new Set<string>();
  for (const raw of templateText.split(/\r?\n/)) {
    const m = /^\s*IdentityFile\s*(?:=|\s)\s*(\S+)/i.exec(raw);
    if (m === null) continue;
    const p = m[1]!;
    out.add(p.startsWith("~/") ? `${home}/${p.slice(2)}` : p);
  }
  return [...out];
}

/**
 * Tira um host do texto do ~/.ssh/config ("Remover do seletor"). Bloco só dele: sai o bloco inteiro (da linha
 * Host até a próxima Host/Match). Bloco com vários nomes (`Host a b`): sai só o nome. O resto do arquivo fica
 * igual, comentários e Include inclusive, e entra a marca `# meu-bot: não sincronizar <host>` no fim.
 * `removed: null` = o host não está neste arquivo (pode vir de um Include, que não é mexido).
 */
export function removeSshHost(text: string, host: string): { text: string; removed: "block" | "alias" | null } {
  const lines = text.split(/\r?\n/);
  const isHeader = (l: string): RegExpExecArray | null => /^\s*(host|match)(\s*=\s*|\s+)(.*)$/i.exec(l);
  let start = -1;
  let aliases: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = isHeader(lines[i]!);
    if (m === null || m[1]!.toLowerCase() !== "host") continue;
    const list = m[3]!.trim().split(/\s+/).filter((a) => a !== "");
    if (list.includes(host)) { start = i; aliases = list; break; }
  }
  if (start < 0) return { text, removed: null };
  // A marca no fim: o "sincronizar ssh" não traz este host de volta do modelo.
  const marcado = (t: string): string => (skippedAliases(t).includes(host) ? t : `${t.replace(/\n*$/, "\n")}${skipLine(host)}\n`);
  if (aliases.length > 1) {
    const m = isHeader(lines[start]!)!;
    const indent = /^\s*/.exec(lines[start]!)![0];
    lines[start] = `${indent}${m[1]} ${aliases.filter((a) => a !== host).join(" ")}`;
    return { text: marcado(lines.join("\n")), removed: "alias" };
  }
  let end = start + 1;
  while (end < lines.length && isHeader(lines[end]!) === null) end++;
  // As marcas ficam no fim do arquivo, textualmente dentro do último bloco: ao tirar esse bloco elas ficam.
  const marcas = lines.slice(start, end).filter((l) => SKIP_RE.test(l));
  const out = [...lines.slice(0, start), ...marcas, ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n");
  return { text: marcado(out), removed: "block" };
}

/**
 * Texto dos arquivos que um ~/.ssh/config inclui, até 3 níveis, sem repetir arquivo (ciclo) e pulando o que não
 * dá para ler. `expand` resolve o padrão do Include em caminhos; `read` devolve null quando não lê.
 */
export function includedTexts(text: string, expand: (pattern: string) => string[], read: (file: string) => string | null, depth = 0, seen = new Set<string>()): string[] {
  if (depth > 3) return [];
  const out: string[] = [];
  for (const pat of parseSshConfig(text).includes) {
    for (const f of expand(pat)) {
      if (seen.has(f)) continue;
      seen.add(f);
      const t = read(f);
      if (t === null) continue;
      out.push(t, ...includedTexts(t, expand, read, depth + 1, seen));
    }
  }
  return out;
}
