/**
 * "Este Windows", a parte que executa (a decisão é pura, em wsl-core.ts): prepara a distro WSL própria do app e a
 * mantém de pé enquanto o app está aberto. Só roda com `caps().hostWsl` (Windows).
 *
 * O preparo é uma sequência refazível, do passo em que a máquina está: instalar o WSL (com elevação, UAC, só quando
 * falta; depois o Windows reinicia e o preparo retoma sozinho na abertura seguinte), baixar o Ubuntu e conferir o
 * SHA256 contra o SHA256SUMS publicado, importar como distro própria em %LOCALAPPDATA%\<app>\wsl, instalar os pacotes,
 * criar o usuário comum, ligar um sshd só em 127.0.0.1 na porta do produto, gerar a chave, gravar o alias num arquivo
 * próprio incluído no ~/.ssh/config e conferir `ssh <alias>`. Daí em diante o alias é uma máquina SSH comum.
 *
 * Nada aqui mexe numa distro que a pessoa já tenha: só na de nome igual ao do app.
 */
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { caps, produto } from "../app/variant";
import { log } from "./backend";
import { runSsh } from "../whatsapp/whatsapp-ssh";
import {
  MARCA_PREPARO, arquiteturaDoWindows, chaveDoHost, chavePublicaLimpa, confDoAlias, configComInclude, decidirEstadoWsl, knownHostsDoAlias,
  lerListaWsl, linhaInclude, nomesWsl, pedeVirtualizacao, rootfsDe, scriptManterDePe, scriptPacotes, scriptPreparo, sha256DoSums, textoDoEstadoWsl, textoDoWsl,
  wslInstalado, type EstadoWsl, type NomesWsl, type SaidaWsl, type SinaisWsl,
} from "./wsl-core";

export type { EstadoWsl };

/** O que o seletor recebe do "Este Windows". */
export interface EstadoWslView { alias: string; estado: EstadoWsl; texto: string; acao: boolean; preparando: boolean }
/** Fim de um preparo: o estado em que parou e, se falhou, o porquê. */
export interface ResultadoWsl { ok: boolean; estado: EstadoWsl; alias: string; erro: string | null; log: string[]; ms: number }

export const nomes = (): NomesWsl => nomesWsl(produto().nome, produto().portaWsl);
/** O alias do "Este Windows" neste app; null onde ele não existe (fora do Windows, ou no admin). */
export const aliasWsl = (): string | null => (caps().hostWsl ? nomes().alias : null);
export const ehHostWsl = (host: string): boolean => aliasWsl() === host;

const sshDir = (): string => path.join(os.homedir(), ".ssh");
const naSsh = (f: string): string => path.join(sshDir(), f);
/** %LOCALAPPDATA%\<app>\wsl: o rootfs baixado e o disco da distro. Fora do roaming (%APPDATA%): são gigas. */
function pastaWsl(): string {
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return path.join(local, produto().nome, "wsl");
}
const wslExe = (): string => path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "wsl.exe");

/** Marca do app (na pasta de dados): quando pediu a instalação do WSL e se há um preparo a retomar. */
interface Marca { instalacaoPedidaEm: number | null; retomar: boolean }
const arquivoMarca = (): string => path.join(app.getPath("userData"), "wsl.json");
function lerMarca(): Marca {
  try {
    const j = JSON.parse(fs.readFileSync(arquivoMarca(), "utf8")) as Partial<Marca>;
    return { instalacaoPedidaEm: typeof j.instalacaoPedidaEm === "number" ? j.instalacaoPedidaEm : null, retomar: j.retomar === true };
  } catch { return { instalacaoPedidaEm: null, retomar: false }; }
}
function gravarMarca(m: Partial<Marca>): void {
  try { fs.writeFileSync(arquivoMarca(), JSON.stringify({ ...lerMarca(), ...m }, null, 2)); } catch (e) { log(`[wsl] não gravei ${arquivoMarca()}: ${e instanceof Error ? e.message : String(e)}`); }
}

/**
 * Roda o wsl.exe e junta a saída (stdout e stderr). `entrada` vai pelo stdin (os scripts: `-e bash -s`, sem quoting
 * pelo caminho). `aoLer` recebe cada linha não vazia enquanto roda (progresso do apt).
 */
function rodarWsl(args: string[], o: { entrada?: string; prazoMs?: number; aoLer?: (linha: string) => void } = {}): Promise<SaidaWsl> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(wslExe(), args, { env: { ...process.env, WSL_UTF8: "1" }, windowsHide: true, stdio: [o.entrada === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    } catch (e) { resolve({ rc: null, texto: e instanceof Error ? e.message : String(e) }); return; }
    const partes: Buffer[] = [];
    let resto = "";
    let fim = false;
    const terminar = (r: SaidaWsl): void => { if (fim) return; fim = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => { child.kill(); terminar({ rc: -2, texto: `${textoJunto()}\n(o wsl.exe não terminou em ${Math.round((o.prazoMs ?? 60_000) / 1000)} s)` }); }, o.prazoMs ?? 60_000);
    const textoJunto = (): string => (partes.length === 0 ? "" : textoDoWsl(Buffer.concat(partes)));
    const ler = (d: Buffer): void => {
      partes.push(d);
      if (o.aoLer === undefined) return;
      const linhas = (resto + d.toString("utf8").replace(/\0/g, "")).split(/\r?\n/);
      resto = linhas.pop() ?? "";
      for (const l of linhas) if (l.trim() !== "") o.aoLer(l.trim());
    };
    child.stdout?.on("data", ler);
    child.stderr?.on("data", ler);
    child.on("error", (e) => terminar({ rc: null, texto: e.message }));
    child.on("close", (code) => { if (resto.trim() !== "" && o.aoLer !== undefined) o.aoLer(resto.trim()); terminar({ rc: code ?? -1, texto: textoJunto() }); });
    if (o.entrada !== undefined) { child.stdin?.on("error", () => { /* o wsl.exe saiu antes de ler */ }); child.stdin?.end(o.entrada); }
  });
}

/** Roda um script como root dentro da distro (bash -s pelo stdin). */
const comoRoot = (script: string, prazoMs: number, aoLer?: (l: string) => void): Promise<SaidaWsl> =>
  rodarWsl(["-d", nomes().distro, "-u", "root", "-e", "bash", "-s"], { entrada: script, prazoMs, ...(aoLer === undefined ? {} : { aoLer }) });

function arquivosLocaisNoLugar(n: NomesWsl): boolean {
  if (![n.chave, `${n.chave}.pub`, n.conf, n.knownHosts].every((f) => fs.existsSync(naSsh(f)))) return false;
  try { return configComInclude(fs.readFileSync(naSsh("config"), "utf8"), n) === null; } catch { return false; }
}

async function sinais(): Promise<SinaisWsl> {
  const n = nomes();
  const marca = lerMarca();
  const base = { arquitetura: arquiteturaDoWindows(process.env), instalacaoPedidaEm: marca.instalacaoPedidaEm, ligadoDesde: Date.now() - os.uptime() * 1000, nomes: n, arquivosLocais: arquivosLocaisNoLugar(n) };
  const status = await rodarWsl(["--status"], { prazoMs: 30_000 });
  if (!wslInstalado(status)) return { ...base, status, lista: { rc: null, texto: "" }, preparo: null };
  const lista = await rodarWsl(["-l", "-v"], { prazoMs: 30_000 });
  let preparo: number | null = null;
  if (lerListaWsl(lista.texto).some((d) => d.nome.toLowerCase() === n.distro.toLowerCase())) {
    const r = await rodarWsl(["-d", n.distro, "-u", "root", "-e", "cat", MARCA_PREPARO], { prazoMs: 60_000 });
    const v = Number.parseInt(r.texto.trim(), 10);
    preparo = r.rc === 0 && Number.isFinite(v) ? v : null;
  }
  return { ...base, status, lista, preparo };
}

export async function estadoAtual(): Promise<EstadoWsl> {
  const s = await sinais();
  const e = decidirEstadoWsl(s);
  if (e !== "pronto") log(`[wsl] ${nomes().distro}: ${e} (status rc=${s.status.rc}, preparo=${s.preparo ?? "-"}, arquivos=${s.arquivosLocais ? "ok" : "faltam"})`);
  return e;
}

/* ---------- Progresso para a tela ---------- */
const ouvintes = new Set<(linha: string) => void>();
/** O seletor ouve o progresso do preparo (o que começa na abertura também aparece nele). */
export function aoProgressoWsl(cb: (linha: string) => void): () => void { ouvintes.add(cb); return () => ouvintes.delete(cb); }

let emCurso: Promise<ResultadoWsl> | null = null;
export const preparando = (): boolean => emCurso !== null;

export async function estadoView(): Promise<EstadoWslView> {
  const alias = aliasWsl();
  if (alias === null) throw new Error("este recurso não existe neste computador");
  // Durante o preparo não sonda o wsl.exe de novo (o import segura a distro): diz só que está preparando.
  if (emCurso !== null) return { alias, estado: "sem-sshd", texto: "preparando este Windows…", acao: false, preparando: true };
  const estado = await estadoAtual();
  if (estado === "pronto") manterDePe();
  return { alias, estado, ...textoDoEstadoWsl(estado), preparando: false };
}

/** "Preparar este Windows": um preparo por vez; quem chama durante um em curso recebe o mesmo. */
export function prepararWsl(aoLer?: (linha: string) => void): Promise<ResultadoWsl> {
  if (aoLer !== undefined) ouvintes.add(aoLer);
  if (emCurso === null) emCurso = executar().finally(() => { emCurso = null; });
  const p = emCurso;
  if (aoLer !== undefined) void p.finally(() => ouvintes.delete(aoLer));
  return p;
}

async function executar(): Promise<ResultadoWsl> {
  const inicio = Date.now();
  const linhas: string[] = [];
  const diz = (l: string): void => { linhas.push(l); if (linhas.length > 200) linhas.shift(); log(`[wsl] ${l}`); for (const cb of ouvintes) { try { cb(l); } catch { /* ouvinte que caiu */ } } };
  const n = nomes();
  const fim = (estado: EstadoWsl, erro: string | null): ResultadoWsl => {
    if (erro !== null) diz(`✗ ${erro}`);
    if (estado === "pronto") gravarMarca({ retomar: false });
    return { ok: erro === null && estado === "pronto", estado, alias: n.alias, erro, log: linhas.slice(-40), ms: Date.now() - inicio };
  };
  gravarMarca({ retomar: true });
  try {
    let estado = await estadoAtual();
    diz(`este Windows: ${estado}`);
    if (estado === "sem-suporte") return fim(estado, "este Windows não é x64 nem ARM64");
    if (estado === "precisa-reiniciar") return fim(estado, "reinicie o Windows para terminar a instalação do WSL; o preparo continua sozinho na próxima abertura do app");
    if (estado === "sem-wsl") {
      const r = await instalarWsl(diz);
      if (r !== null) return fim("sem-wsl", r);
      estado = await estadoAtual();
      if (estado === "sem-wsl" || estado === "precisa-reiniciar") return fim("precisa-reiniciar", "o WSL foi instalado: reinicie o Windows; ao abrir o app de novo, o preparo continua sozinho");
    }
    if (estado === "sem-distro") {
      const r = await importarDistro(n, diz);
      if (r !== null) {
        // Logo depois de instalar o WSL, antes do reinício, o import cai por falta do componente: é o reinício que falta.
        const m = lerMarca();
        if (m.instalacaoPedidaEm !== null && m.instalacaoPedidaEm >= Date.now() - os.uptime() * 1000) return fim("precisa-reiniciar", `${r}. Reinicie o Windows: ao abrir o app de novo, o preparo continua`);
        return fim("sem-distro", r);
      }
    }
    const r = await prepararDentro(n, diz);
    if (r !== null) return fim("sem-sshd", r);
    manterDePe();
    // A prova: o mesmo ssh que o app usa para tudo (BatchMode, a chave e o known_hosts do alias).
    diz(`conferindo ssh ${n.alias}…`);
    let ultimo = "";
    for (let i = 0; i < 10; i++) {
      const t = await runSsh(n.alias, "echo meu-bot-wsl-ok\n", 30_000);
      if (t.code === 0 && t.stdout.includes("meu-bot-wsl-ok")) { diz(`✓ ${n.alias} responde por SSH`); return fim(await estadoAtual(), null); }
      ultimo = (t.stderr || t.stdout).trim().split("\n").slice(-2).join(" ");
      await new Promise((res) => setTimeout(res, 2000));
    }
    return fim("sem-sshd", `o sshd da distro não respondeu em 127.0.0.1:${n.porta}: ${ultimo || "sem detalhes"}`);
  } catch (e) {
    return fim(await estadoAtual().catch(() => "sem-sshd" as const), e instanceof Error ? e.message : String(e));
  }
}

/** Instala o WSL (sem distro) com elevação: o Windows mostra o UAC. null = ok; senão, o porquê. */
async function instalarWsl(diz: (l: string) => void): Promise<string | null> {
  diz("instalando o WSL: o Windows vai pedir permissão de administrador…");
  const ps = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const comando = "$ErrorActionPreference='Stop'; try { $p = Start-Process -FilePath 'wsl.exe' -ArgumentList '--install','--no-distribution' -Verb RunAs -Wait -PassThru; exit $p.ExitCode } catch { Write-Output $_.Exception.Message; exit 1223 }";
  const r = await new Promise<{ rc: number | null; texto: string }>((resolve) => {
    const c = spawn(ps, ["-NoProfile", "-NonInteractive", "-Command", comando], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let t = "";
    c.stdout.on("data", (d: Buffer) => { t += d.toString("utf8"); });
    c.stderr.on("data", (d: Buffer) => { t += d.toString("utf8"); });
    c.on("error", (e) => resolve({ rc: null, texto: e.message }));
    c.on("close", (code) => resolve({ rc: code, texto: t.trim() }));
  });
  if (r.rc === 1223) return `a instalação do WSL não foi autorizada (${r.texto || "o pedido de administrador foi recusado"})`;
  if (r.rc !== 0) return `a instalação do WSL falhou (código ${r.rc ?? "?"}): ${r.texto.split("\n").slice(-2).join(" ") || "sem detalhes"}`;
  gravarMarca({ instalacaoPedidaEm: Date.now(), retomar: true });
  diz("✓ WSL instalado");
  return null;
}

/** Baixa o Ubuntu (conferindo o SHA256) e importa como a distro do app. null = ok; senão, o porquê. */
async function importarDistro(n: NomesWsl, diz: (l: string) => void): Promise<string | null> {
  const arq = arquiteturaDoWindows(process.env);
  if (arq === null) return "arquitetura do Windows sem Ubuntu para WSL";
  const rf = rootfsDe(arq);
  const pasta = pastaWsl();
  fs.mkdirSync(pasta, { recursive: true });
  const tar = path.join(pasta, rf.arquivo);
  diz(`conferindo o Ubuntu 24.04 (${arq}) publicado…`);
  const sums = await fetch(rf.sums).then(async (r) => { if (!r.ok) throw new Error(`SHA256SUMS respondeu ${r.status}`); return r.text(); });
  const esperado = sha256DoSums(sums, rf.arquivo);
  if (esperado === null) return `o SHA256SUMS de ${rf.sums} não cita ${rf.arquivo}`;
  if (!fs.existsSync(tar) || (await sha256DoArquivo(tar)) !== esperado) {
    const erro = await baixar(rf.url, tar, esperado, diz);
    if (erro !== null) return erro;
  } else diz("o Ubuntu já estava baixado e confere");
  const disco = path.join(pasta, "distro");
  fs.mkdirSync(disco, { recursive: true });
  diz(`importando a distro ${n.distro} (WSL2)…`);
  let r = await rodarWsl(["--import", n.distro, disco, tar, "--version", "2"], { prazoMs: 15 * 60_000 });
  if (r.rc !== 0 && pedeVirtualizacao(r.texto)) {
    diz("o WSL2 não sobe neste Windows (sem virtualização): importando como WSL1…");
    await desregistrarSeExiste(n);
    r = await rodarWsl(["--import", n.distro, disco, tar, "--version", "1"], { prazoMs: 15 * 60_000 });
  }
  if (r.rc !== 0) return `o import da distro falhou: ${r.texto.trim().split("\n").slice(-3).join(" ") || `código ${r.rc ?? "?"}`}`;
  try { fs.rmSync(tar, { force: true }); } catch { /* fica para a próxima */ }
  diz(`✓ distro ${n.distro} importada`);
  return null;
}

async function desregistrarSeExiste(n: NomesWsl): Promise<void> {
  const l = await rodarWsl(["-l", "-v"], { prazoMs: 30_000 });
  if (lerListaWsl(l.texto).some((d) => d.nome.toLowerCase() === n.distro.toLowerCase())) await rodarWsl(["--unregister", n.distro], { prazoMs: 120_000 });
}

function sha256DoArquivo(f: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(f).on("data", (d) => h.update(d)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });
}

/** Baixa para `destino` conferindo o SHA256 no caminho; arquivo que não confere é apagado. */
async function baixar(url: string, destino: string, esperado: string, diz: (l: string) => void): Promise<string | null> {
  const parcial = `${destino}.baixando`;
  const r = await fetch(url);
  if (!r.ok || r.body === null) return `o download do Ubuntu respondeu ${r.status}`;
  const total = Number(r.headers.get("content-length") ?? "0");
  const h = crypto.createHash("sha256");
  const out = fs.createWriteStream(parcial);
  let feito = 0, ultimoPct = -1;
  diz(`baixando o Ubuntu (${total > 0 ? `${Math.round(total / 1048576)} MB` : "tamanho desconhecido"})…`);
  try {
    for await (const pedaco of r.body as unknown as AsyncIterable<Uint8Array>) {
      h.update(pedaco); feito += pedaco.length;
      if (!out.write(pedaco)) await new Promise<void>((res) => { out.once("drain", () => res()); });
      const pct = total > 0 ? Math.floor((feito / total) * 10) * 10 : -1;
      if (pct !== ultimoPct && pct > 0) { ultimoPct = pct; diz(`baixando o Ubuntu: ${pct}%`); }
    }
  } finally { await new Promise<void>((res) => { out.end(() => res()); }); }
  const obtido = h.digest("hex");
  if (obtido !== esperado) { fs.rmSync(parcial, { force: true }); return `o Ubuntu baixado não confere com o SHA256SUMS (veio ${obtido.slice(0, 12)}…, esperava ${esperado.slice(0, 12)}…)`; }
  fs.renameSync(parcial, destino);
  diz("✓ Ubuntu baixado e conferido (SHA256)");
  return null;
}

/** Pacotes, usuário, sshd, chave, known_hosts e alias. null = ok; senão, o porquê. */
async function prepararDentro(n: NomesWsl, diz: (l: string) => void): Promise<string | null> {
  diz("instalando openssh-server, python3 e curl na distro…");
  const p = await comoRoot(scriptPacotes(), 20 * 60_000, (l) => { if (!/^(Get|Hit|Ign|Reading|Building|Selecting|Preparing|Unpacking|Setting up|Processing)\b/.test(l)) diz(l); });
  if (p.rc !== 0 || !p.texto.includes("pacotes-ok")) return `os pacotes da distro não instalaram: ${p.texto.trim().split("\n").slice(-3).join(" ")}`;
  fs.mkdirSync(sshDir(), { recursive: true, mode: 0o700 });
  const chave = naSsh(n.chave);
  if (!fs.existsSync(chave) || !fs.existsSync(`${chave}.pub`)) {
    diz(`gerando a chave ~/.ssh/${n.chave}…`);
    fs.rmSync(chave, { force: true }); fs.rmSync(`${chave}.pub`, { force: true });
    const k = await new Promise<number | null>((resolve) => {
      const c = spawn("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", n.alias, "-f", chave], { windowsHide: true, stdio: "ignore" });
      c.on("error", () => resolve(null)); c.on("close", (code) => resolve(code));
    });
    if (k !== 0) return `o ssh-keygen do Windows não gerou a chave (código ${k ?? "não achei o ssh-keygen: o OpenSSH Client do Windows está instalado?"})`;
  }
  const pub = chavePublicaLimpa(fs.readFileSync(`${chave}.pub`, "utf8"), n.alias);
  if (pub === null) return `~/.ssh/${n.chave}.pub não é uma chave ed25519`;
  diz(`ligando o sshd em 127.0.0.1:${n.porta} (usuário meubot)…`);
  const s = await comoRoot(scriptPreparo(n.porta, pub), 120_000);
  if (s.rc !== 0 || !s.texto.includes("preparo-ok")) return `o sshd da distro não ficou pronto: ${s.texto.trim().split("\n").slice(-3).join(" ")}`;
  const hk = await rodarWsl(["-d", n.distro, "-u", "root", "-e", "cat", "/etc/ssh/ssh_host_ed25519_key.pub"], { prazoMs: 60_000 });
  const chaveHost = chaveDoHost(hk.texto);
  if (chaveHost === null) return "não consegui ler a chave do sshd da distro";
  fs.writeFileSync(naSsh(n.knownHosts), knownHostsDoAlias(n, chaveHost), { mode: 0o600 });
  fs.writeFileSync(naSsh(n.conf), confDoAlias(n), { mode: 0o600 });
  const cfg = naSsh("config");
  let atual = "";
  try { atual = fs.readFileSync(cfg, "utf8"); } catch { /* sem config ainda */ }
  const novo = configComInclude(atual, n);
  if (novo !== null) {
    if (atual !== "") fs.copyFileSync(cfg, `${cfg}.antes-do-${n.alias}`);
    fs.writeFileSync(cfg, novo, { mode: 0o600 });
    diz(`✓ ~/.ssh/config inclui ${linhaInclude(n).replace("Include ", "")}`);
  }
  return null;
}

/* ---------- A distro de pé enquanto o app está aberto ---------- */
let guardiao: ChildProcess | null = null;
/** Sobe o sshd e mantém um wsl.exe filho aberto (sem ele o WSL desliga a distro em segundos). Idempotente. */
export function manterDePe(): void {
  if (guardiao !== null || aliasWsl() === null) return;
  try {
    const c = spawn(wslExe(), ["-d", nomes().distro, "-u", "root", "-e", "bash", "-s"], { env: { ...process.env, WSL_UTF8: "1" }, windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
    guardiao = c;
    c.on("error", (e) => { log(`[wsl] não consegui manter a distro de pé: ${e.message}`); if (guardiao === c) guardiao = null; });
    c.on("exit", (code) => { if (guardiao === c) { guardiao = null; log(`[wsl] o wsl.exe que mantinha ${nomes().distro} de pé saiu (${code ?? "?"})`); } });
    c.stdin?.on("error", () => { /* saiu antes de ler */ });
    c.stdin?.end(`${scriptManterDePe()}\n`);
    log(`[wsl] ${nomes().distro} de pé (sshd em 127.0.0.1:${nomes().porta})`);
  } catch (e) { log(`[wsl] não consegui manter a distro de pé: ${e instanceof Error ? e.message : String(e)}`); }
}
/** Na saída do app: o wsl.exe filho sai, e a distro dorme quando nada mais a usa. */
export function pararWsl(): void {
  const c = guardiao; guardiao = null;
  if (c !== null && c.exitCode === null) { try { c.kill(); } catch { /* já saiu */ } }
}

let inicio: Promise<void> | null = null;
/**
 * Na abertura do app: pronto, sobe a distro e o sshd antes da primeira sondagem; com um preparo pela metade (o
 * Windows reiniciou depois de instalar o WSL, ou o app fechou no meio), retoma em segundo plano.
 */
export function iniciarWsl(): Promise<void> {
  if (aliasWsl() === null) return Promise.resolve();
  inicio ??= (async () => {
    try {
      const e = await estadoAtual();
      if (e === "pronto") { manterDePe(); return; }
      if (lerMarca().retomar && (e === "sem-distro" || e === "sem-sshd")) {
        log(`[wsl] retomando o preparo de ${nomes().distro} (${e})`);
        void prepararWsl();
      }
    } catch (err) { log(`[wsl] na abertura: ${err instanceof Error ? err.message : String(err)}`); }
  })();
  return inicio;
}
