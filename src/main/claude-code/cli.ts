/**
 * Claude Code deste Mac, IO: achar o `claude` e rodá-lo. O CLI é o único dono do `~/.claude.json` (o app só o lê, com
 * claude-code/config-core.ts). Usado pelo botão Instalar do controle externo e pelas Conexões.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../app/proc";
import { findClaude } from "../maquina/localBackend";

export const CONFIG_CLAUDE_CODE = path.join(os.homedir(), ".claude.json");
const PRAZO_CLI_MS = 30_000;
export const SEM_CLAUDE = "não achei o Claude Code (comando claude) neste Mac; instale-o ou use \"Copiar comando\" e cole no terminal";

export const lerSeExiste = (f: string): string | null => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };
export const lerConfigClaudeCode = (): string | null => lerSeExiste(CONFIG_CLAUDE_CODE);
export const pastaExiste = (p: string): boolean => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/**
 * O `claude` deste Mac. O `findClaude` pode cair num zsh de login (até 8 s), e o estado é lido a cada repintura:
 * guarda o achado; o "não achei" vale 1 min (a pessoa pode instalar o Claude Code com o app aberto).
 */
let claudeCache: { caminho: string | null; em: number } | null = null;
export function claude(): string | null {
  if (claudeCache !== null && (claudeCache.caminho !== null || Date.now() - claudeCache.em < 60_000)) return claudeCache.caminho;
  claudeCache = { caminho: findClaude(), em: Date.now() };
  return claudeCache.caminho;
}

/** O `claude` instalado pelo npm é um script `#!/usr/bin/env node`: o PATH do app de GUI não acha o node sozinho. `cwd`: a pasta de uma entrada local. */
export function rodarClaude(cli: string, args: string[], cwd?: string): Promise<unknown> {
  const PATH = [path.dirname(cli), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env["PATH"] ?? ""].join(":");
  return run(cli, args, { timeoutMs: PRAZO_CLI_MS, env: { ...process.env, PATH }, ...(cwd === undefined ? {} : { cwd }) });
}

/** Tira a entrada local de `nome` de cada pasta (o `claude` só a tira rodando dentro dela). */
export async function removerLocais(cli: string, nome: string, pastas: string[]): Promise<void> {
  for (const pasta of pastas) await rodarClaude(cli, ["mcp", "remove", "--scope", "local", nome], pasta);
}
