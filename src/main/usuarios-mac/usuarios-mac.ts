/**
 * meu-bot-admin-mac: as contas deste Mac (I/O). A lista é lida como o usuário que abriu o app; criar, apagar e mudar o
 * apelido rodam como root uma vez cada, pela janela de senha de administrador do próprio macOS (osascript "with
 * administrator privileges"): o script vai num arquivo 0700 temporário, apagado logo depois. O núcleo puro é o
 * usuarios-mac-core.ts. Registro local (auditoria-mac.jsonl na pasta do app), nunca com a senha.
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import type { UsuarioMacCriado, UsuariosMacVisao } from "../../shared/ipc";
import { LISTAR_MAC_SH, OAUTH_GOOGLE, apagarNoTerminalCmd, apelidoMacSh, criarMacSh, type OauthGoogle, lerUsuariosMac, nomeNovoInvalido, saidaMac, senhaDe, senhaEscolhidaInvalida } from "./usuarios-mac-core";
import { parseClienteOAuth } from "../google/google-core";

function rodar(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err === null ? 0 : typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/**
 * Roda `script` como root pela janela de senha do macOS. Cancelar a janela vira o erro "cancelado". O arquivo (com o
 * que houver de sensível, como a senha nova) fica 0700 numa pasta 0700 deste usuário e some no fim, dê certo ou não.
 */
async function comoAdministrador(script: string, motivo: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meu-bot-admin-mac-"));
  const arq = path.join(dir, "acao.sh");
  try {
    fs.writeFileSync(arq, `${script}\n`, { mode: 0o700 });
    if (!/^[A-Za-z0-9/._-]+$/.test(arq)) throw new Error("caminho temporário inesperado");
    const r = await rodar("osascript", ["-e", `do shell script "/bin/bash ${arq}" with prompt "O meu-bot-admin-mac quer ${motivo}." with administrator privileges`], 5 * 60_000);
    if (r.code !== 0 && /-128|cancel/i.test(r.stderr)) throw new Error("cancelado: a senha de administrador não foi informada");
    // Script que sai com erro: o osascript devolve a saída dele no stderr ("0:225: execution error: ERRO=… (1)").
    // Só a frase do ERRO= vai para a tela.
    const erro = /ERRO=(.*?)(?:\s*\(\d+\))?\s*$/m.exec(r.code === 0 ? r.stdout : `${r.stdout}\n${r.stderr}`)?.[1];
    if (erro !== undefined) throw new Error(erro.trim());
    if (r.code !== 0) throw new Error("o macOS recusou a ação");
    return r.stdout;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** O binário do Claude Code de quem administra (o link ~/.local/bin/claude do instalador nativo); null = não instalado assim. */
function claudeDesteUsuario(): string | null {
  try { const real = fs.realpathSync(path.join(os.homedir(), ".local", "bin", "claude")); return /\/\.local\/share\/claude\/versions\/[\w.-]+$/.test(real) && real.startsWith("/Users/") ? real : null; } catch { return null; }
}

/**
 * Os clients do Google de quem administra, para levar à conta nova: o checkout em ~/Desktop/meu-bot/config, senão a
 * pasta de dados do meu-bot. Só vai o que é um client OAuth válido (nada de .bak nem arquivo quebrado).
 */
function oauthDesteUsuario(): { nome: OauthGoogle; base64: string }[] {
  const out: { nome: OauthGoogle; base64: string }[] = [];
  for (const nome of OAUTH_GOOGLE) {
    for (const dir of [path.join(os.homedir(), "Desktop", "meu-bot", "config"), path.join(os.homedir(), "Library", "Application Support", "meu-bot")]) {
      try {
        const bruto = fs.readFileSync(path.join(dir, nome));
        if (parseClienteOAuth(JSON.parse(bruto.toString("utf8"))) === null) continue;
        out.push({ nome, base64: bruto.toString("base64") });
        break;
      } catch { /* próximo lugar */ }
    }
  }
  return out;
}

function registrar(acao: string, alvo: string): void {
  try { fs.appendFileSync(path.join(app.getPath("userData"), "auditoria-mac.jsonl"), `${JSON.stringify({ em: new Date().toISOString(), quem: os.userInfo().username, acao, alvo })}\n`, { mode: 0o600 }); } catch { /* registro é cortesia */ }
}

export async function listarUsuariosMac(): Promise<UsuariosMacVisao> {
  const r = await rodar("bash", ["-c", LISTAR_MAC_SH], 30_000);
  if (r.code !== 0) throw new Error(`não consegui ler as contas deste Mac: ${r.stderr.trim().split("\n").pop() ?? "?"}`);
  return lerUsuariosMac(r.stdout);
}

/** Todas as contas (inclusive as de sistema), para o nome novo não colidir. O UID fica com o macOS. */
async function nomesDasContas(): Promise<string[]> {
  const r = await rodar("dscl", [".", "-list", "/Users"], 20_000);
  return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Cria a conta. `senha` vazia/ausente = o app gera uma forte; preenchida = a que a pessoa escolheu (validada). */
export async function criarUsuarioMac(nome: unknown, senhaPedida: unknown): Promise<UsuarioMacCriado> {
  const erro = nomeNovoInvalido(nome, await nomesDasContas());
  if (erro !== null) throw new Error(erro);
  const n = nome as string;
  const escolhida = typeof senhaPedida === "string" && senhaPedida !== "" ? senhaPedida : null;
  if (escolhida !== null) { const e = senhaEscolhidaInvalida(escolhida); if (e !== null) throw new Error(e); }
  const senha = escolhida ?? senhaDe(crypto.randomBytes(32));
  const out = await comoAdministrador(criarMacSh({ nome: n, senha, claude: claudeDesteUsuario(), oauth: oauthDesteUsuario() }), `criar a conta ${n} (com o meu-bot na mesa)`);
  saidaMac(out, new RegExp(`^CRIADO=${n}$`, "m"), "o macOS não confirmou a conta nova");
  const repo = (/^REPO=(ok|falhou|sem-git)$/m.exec(out)?.[1] ?? "falhou") as UsuarioMacCriado["repo"];
  const oauth = /^OAUTH=ok$/m.test(out) ? "ok" : "sem-origem";
  registrar("conta.criar", `${n} (meu-bot na mesa: ${repo}; Google: ${oauth})`);
  return { nome: n, senha: escolhida === null ? senha : null, repo, oauth, visao: await listarUsuariosMac() };
}

export async function apagarUsuarioMac(nome: unknown): Promise<UsuariosMacVisao> {
  const v = await listarUsuariosMac();
  const u = v.usuarios.find((x) => x.nome === nome);
  if (u === undefined) throw new Error("conta não encontrada");
  if (u.protegida !== null) throw new Error(`a conta ${u.nome} não pode ser apagada daqui: ${u.protegida}`);
  // No Terminal (ver apagarNoTerminalCmd): a pessoa digita a senha lá; aqui só se espera a conta sumir (até 5 min).
  const cmd = apagarNoTerminalCmd(u.nome);
  const ab = await rodar("osascript", ["-e", `tell application "Terminal"\nactivate\ndo script "${cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\nend tell`], 30_000);
  if (ab.code !== 0) throw new Error(`não consegui abrir o Terminal: ${ab.stderr.trim().split("\n").pop() ?? "?"}`);
  const fim = Date.now() + 5 * 60_000;
  while (Date.now() < fim) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await rodar("dscl", [".", "-read", `/Users/${u.nome}`, "UniqueID"], 10_000);
    if (r.code !== 0) { registrar("conta.apagar", u.nome); return listarUsuariosMac(); }
  }
  throw new Error(`a conta ${u.nome} continua: a senha não foi digitada no Terminal (ou o comando falhou lá). Tente de novo.`);
}

export async function apelidoUsuarioMac(nome: unknown, apelido: unknown): Promise<UsuariosMacVisao> {
  const v = await listarUsuariosMac();
  const u = v.usuarios.find((x) => x.nome === nome);
  if (u === undefined) throw new Error("conta não encontrada");
  const out = await comoAdministrador(apelidoMacSh(u.nome, String(apelido ?? "")), `mudar o nome completo da conta ${u.nome}`);
  saidaMac(out, /^APELIDO=ok$/m, "o macOS não confirmou o apelido");
  registrar("conta.apelido", u.nome);
  return listarUsuariosMac();
}
