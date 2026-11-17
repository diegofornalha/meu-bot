/**
 * Conexões, IO: registrar e tirar MCPs do catálogo (conexoes-core.ts) no Claude Code deste Mac pelo próprio `claude`
 * CLI, no escopo user. O app nunca escreve o `~/.claude.json` e nunca vê o token do login: o OAuth acontece no
 * Claude Code, no primeiro `/mcp`. Depois de cada ação relê o arquivo para confirmar.
 */
import { shell } from "electron";
import type { ConexoesView } from "../../shared/ipc";
import { CONFIG_CLAUDE_CODE, SEM_CLAUDE, claude, lerConfigClaudeCode, pastaExiste, removerLocais, rodarClaude } from "../claude-code/cli";
import { CONEXOES, type Conexao, conexao, entradaConexao, estadoConexao } from "./conexoes-core";

const estado = (c: Conexao) => estadoConexao(lerConfigClaudeCode(), c, pastaExiste);

export function estadoConexoes(): ConexoesView {
  return { cli: claude() !== null, itens: CONEXOES.map((c) => ({ ...c, ...estado(c) })) };
}

function doCatalogo(id: unknown): Conexao {
  const c = conexao(id);
  if (c === undefined) throw new Error("Conexão desconhecida.");
  return c;
}
function cliOuErro(): string {
  const cli = claude();
  if (cli === null) throw new Error(SEM_CLAUDE);
  return cli;
}

/** Conectar (ou Substituir, quando há outra entrada com o mesmo nome): tira o que estiver lá e grava a do catálogo. */
export async function conectar(id: unknown): Promise<void> {
  const c = doCatalogo(id);
  const cli = cliOuErro();
  const antes = estado(c);
  if (antes.estado === "ilegivel") throw new Error(`o ${CONFIG_CLAUDE_CODE} não é um JSON válido; não mexi nele`);
  if (antes.estado === "registrado" && antes.locais.length === 0) return;
  if (antes.estado !== "ausente") {
    await removerLocais(cli, c.id, antes.locais);
    if (antes.estado === "outra-config" && antes.user) await rodarClaude(cli, ["mcp", "remove", "--scope", "user", c.id]);
  }
  const meio = estado(c);
  if (meio.estado !== "registrado") await rodarClaude(cli, ["mcp", "add-json", "--scope", "user", c.id, JSON.stringify(entradaConexao(c))]);
  const depois = estado(c);
  if (depois.estado !== "registrado" || depois.locais.length > 0) throw new Error(`o claude terminou, mas o ${c.nome} ficou "${depois.estado}" no ${CONFIG_CLAUDE_CODE}`);
}

/** Tira do Claude Code, no escopo user e em toda pasta. */
export async function desconectar(id: unknown): Promise<void> {
  const c = doCatalogo(id);
  const cli = cliOuErro();
  const antes = estado(c);
  if (antes.estado === "ilegivel") throw new Error(`o ${CONFIG_CLAUDE_CODE} não é um JSON válido; não mexi nele`);
  if (antes.estado === "ausente") return;
  await removerLocais(cli, c.id, antes.locais);
  try { await rodarClaude(cli, ["mcp", "remove", "--scope", "user", c.id]); } catch (e) { if (estado(c).estado !== "ausente") throw e; }
  const depois = estado(c);
  if (depois.estado !== "ausente") throw new Error(`o claude terminou, mas o ${c.nome} continua no ${CONFIG_CLAUDE_CODE}`);
}

/** Abre só a página de instruções do catálogo (nunca uma url vinda da tela). */
export async function abrirGuia(id: unknown): Promise<void> {
  await shell.openExternal(doCatalogo(id).guia);
}
