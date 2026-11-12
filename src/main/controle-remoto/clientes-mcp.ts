/**
 * Controle externo (MCP): o botão Instalar. Registra este app no cliente MCP deste Mac sem a pessoa colar nada no
 * terminal (o desenho do "Install" do Perssua, lido com o REA): no Claude Code roda o próprio CLI
 * (`claude mcp add-json --scope user`), que é o dono do `~/.claude.json`; no Cursor abre o deeplink de instalação e a
 * pessoa confirma lá (o app nunca escreve o mcp.json do Cursor). O estado de cada cliente vem da leitura das configs
 * (`estadoCliente`, puro): trocar a chave ou a porta aparece como "desatualizado". O comando para copiar continua
 * como plano B quando o `claude` não está neste Mac.
 */
import { shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ControleRemotoView } from "../../shared/ipc";
import { run } from "../app/proc";
import { findClaude } from "../maquina/localBackend";
import { type ClienteMcp, deeplinkCursor, entradaMcp, estadoClaudeCode as estadoClaudeCodeCore, estadoCliente } from "./controle-remoto-core";

const HOME = os.homedir();
const CONFIG_CLAUDE_CODE = path.join(HOME, ".claude.json");
const CONFIG_CURSOR = path.join(HOME, ".cursor", "mcp.json");
const PRAZO_CLI_MS = 30_000;

const lerSeExiste = (f: string): string | null => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };

/**
 * O `claude` deste Mac. O `findClaude` pode cair num zsh de login (até 8 s), e o estado é lido a cada repintura:
 * guarda o achado; o "não achei" vale 1 min (a pessoa pode instalar o Claude Code com o app aberto).
 */
let claudeCache: { caminho: string | null; em: number } | null = null;
function claude(): string | null {
  if (claudeCache !== null && (claudeCache.caminho !== null || Date.now() - claudeCache.em < 60_000)) return claudeCache.caminho;
  claudeCache = { caminho: findClaude(), em: Date.now() };
  return claudeCache.caminho;
}

export function estadoClientes(nome: string, porta: number, token: string): ControleRemotoView["clientes"] {
  return {
    claudeCode: { estado: estadoClaudeCode(nome, porta, token).estado, cli: claude() !== null },
    cursor: { estado: estadoCliente(lerSeExiste(CONFIG_CURSOR), nome, porta, token, "cursor") },
  };
}

/** O `claude` instalado pelo npm é um script `#!/usr/bin/env node`: o PATH do app de GUI não acha o node sozinho. `cwd`: a pasta de uma entrada local. */
function rodarClaude(cli: string, args: string[], cwd?: string): Promise<unknown> {
  const PATH = [path.dirname(cli), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env["PATH"] ?? ""].join(":");
  return run(cli, args, { timeoutMs: PRAZO_CLI_MS, env: { ...process.env, PATH }, ...(cwd === undefined ? {} : { cwd }) });
}

const pastaExiste = (p: string): boolean => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const estadoClaudeCode = (nome: string, porta: number, token: string) => estadoClaudeCodeCore(lerSeExiste(CONFIG_CLAUDE_CODE), nome, porta, token, pastaExiste);
const SEM_CLAUDE = "não achei o Claude Code (comando claude) neste Mac; instale-o ou use \"Copiar comando\" e cole no terminal";
/** Tira a entrada local deste app de cada pasta (o `claude` só a tira rodando dentro dela). */
async function removerLocais(cli: string, nome: string, pastas: string[]): Promise<void> {
  for (const pasta of pastas) await rodarClaude(cli, ["mcp", "remove", "--scope", "local", nome], pasta);
}

/**
 * Instala ou atualiza no escopo user e tira as entradas locais velhas (do comando antigo, sem `--scope`), que
 * venceriam a user na pasta delas. Erros sobem com o motivo (a última linha do stderr do `claude`), nunca engolidos.
 */
export async function instalarCliente(cliente: ClienteMcp, nome: string, porta: number, token: string): Promise<void> {
  if (token === "") throw new Error("ligue o controle externo primeiro: a chave nasce ao ligar");
  if (cliente === "cursor") { await shell.openExternal(deeplinkCursor(nome, porta, token)); return; }
  const cli = claude();
  if (cli === null) throw new Error(SEM_CLAUDE);
  const antes = estadoClaudeCode(nome, porta, token);
  if (antes.estado === "instalado") return;
  if (antes.estado === "ilegivel") throw new Error(`o ${CONFIG_CLAUDE_CODE} não é um JSON válido; não mexi nele`);
  await removerLocais(cli, nome, antes.locais.filter((l) => !l.atual).map((l) => l.pasta));
  if (antes.user !== "instalado") {
    // add-json recusa um nome que já existe: a versão velha (outra porta ou chave) sai antes.
    if (antes.user === "desatualizado") await rodarClaude(cli, ["mcp", "remove", "--scope", "user", nome]);
    await rodarClaude(cli, ["mcp", "add-json", "--scope", "user", nome, JSON.stringify(entradaMcp(porta, token, "claude-code"))]);
  }
  const depois = estadoClaudeCode(nome, porta, token);
  if (depois.estado !== "instalado") throw new Error(`o claude terminou, mas o ${CONFIG_CLAUDE_CODE} ficou "${depois.estado}"`);
}

/** Tira do Claude Code no escopo user e em toda pasta. No Cursor, quem tira é o próprio Cursor (o app não escreve o mcp.json dele). */
export async function removerCliente(cliente: ClienteMcp, nome: string, porta: number, token: string): Promise<void> {
  if (cliente !== "claude-code") throw new Error("no Cursor, remova o servidor nas configurações de MCP dele");
  const cli = claude();
  if (cli === null) throw new Error(SEM_CLAUDE);
  const antes = estadoClaudeCode(nome, porta, token);
  if (antes.estado === "ilegivel") throw new Error(`o ${CONFIG_CLAUDE_CODE} não é um JSON válido; não mexi nele`);
  await removerLocais(cli, nome, antes.locais.map((l) => l.pasta));
  if (antes.user !== "ausente") await rodarClaude(cli, ["mcp", "remove", "--scope", "user", nome]);
  const depois = estadoClaudeCode(nome, porta, token);
  if (depois.user !== "ausente" || depois.locais.length > 0) throw new Error(`o claude terminou, mas o servidor "${nome}" continua no ${CONFIG_CLAUDE_CODE}`);
}
