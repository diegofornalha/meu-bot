import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isValidHost } from "../app/settings";

const MAX_DEPTH = 3;

/** Expande um padrão de Include do ssh: ~, relativo a ~/.ssh, e um único * no nome do arquivo. */
function expandInclude(pattern: string): string[] {
  const home = os.homedir();
  let p = pattern.startsWith("~") ? path.join(home, pattern.slice(1)) : pattern;
  if (!path.isAbsolute(p)) p = path.join(home, ".ssh", p);
  const dir = path.dirname(p);
  const base = path.basename(p);
  if (!base.includes("*")) return [p];
  try {
    const re = new RegExp(`^${base.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    return fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f)).sort();
  } catch {
    return [];
  }
}

/** Um alias do ~/.ssh/config com o que importa para saber "é a mesma máquina?": HostName e User (null quando o bloco não diz). */
export interface SshHostInfo { host: string; hostName: string | null; user: string | null }

/**
 * Os blocos `Host` de um texto de config (puro, testável): cada alias sem curinga com o HostName e o User do seu bloco
 * (o primeiro bloco que cita o alias vale, como no ssh). Linhas `Include` voltam em `includes` para quem lê arquivos.
 */
export function parseSshConfigText(text: string): { hosts: SshHostInfo[]; includes: string[] } {
  const hosts: SshHostInfo[] = []; const includes: string[] = [];
  let atuais: SshHostInfo[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^(\S+)\s*(?:=|\s)\s*(.*)$/.exec(line);
    if (m === null) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "include") { includes.push(...value.split(/\s+/)); continue; }
    if (key === "host") {
      atuais = [];
      for (const alias of value.split(/\s+/)) {
        if (/[*?!]/.test(alias) || !isValidHost(alias) || hosts.some((h) => h.host === alias)) continue;
        const info: SshHostInfo = { host: alias, hostName: null, user: null };
        hosts.push(info); atuais.push(info);
      }
      continue;
    }
    if (key === "hostname") for (const h of atuais) if (h.hostName === null) h.hostName = value;
    if (key === "user") for (const h of atuais) if (h.user === null) h.user = value;
  }
  return { hosts, includes };
}

function collect(file: string, depth: number, seen: Set<string>, out: SshHostInfo[]): void {
  if (depth > MAX_DEPTH || seen.has(file)) return;
  seen.add(file);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const { hosts, includes } = parseSshConfigText(text);
  for (const h of hosts) if (!out.some((x) => x.host === h.host)) out.push(h);
  for (const pat of includes) for (const f of expandInclude(pat)) collect(f, depth + 1, seen, out);
}

/** Hosts do ~/.ssh/config que podem ser usados como alias, sem curingas, com HostName e User. */
export function listSshHostInfos(): SshHostInfo[] {
  const out: SshHostInfo[] = [];
  collect(path.join(os.homedir(), ".ssh", "config"), 0, new Set(), out);
  return out.sort((a, b) => a.host.localeCompare(b.host));
}
/** Só os nomes. */
export function listSshHosts(): string[] {
  return listSshHostInfos().map((h) => h.host);
}
