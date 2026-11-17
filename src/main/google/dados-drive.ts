/**
 * Cópia diária dos dados da máquina no Drive do dono (CRM e financeiro), para ninguém ficar preso a uma VM.
 *
 * A VM já guarda 7 cópias diárias locais de cada conjunto (`db/backup/<data>`, em crm-store.js e finance-store.js):
 * aquilo resolve "o dado estragou". Esta cópia resolve "a máquina morreu", e por isso mora fora dela. Quem envia é
 * o Mac, com o token de Contatos do CRM e escopo `drive.file` (o app só enxerga o que ele mesmo criou): a VM não
 * ganha credencial nenhuma, o que importa porque é lá que o agente atende terceiros pelo WhatsApp.
 *
 * Retenção de uma cópia só por conjunto, escolha do dono. Cada conjunto tem pasta e prefixo próprios no Drive, para
 * zerar o financeiro não encostar no CRM. A ordem é sempre **subir e só então apagar o anterior**: com uma cópia
 * só, apagar primeiro deixaria o dono sem nada se o upload falhasse.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { CONJUNTOS_DADOS, ERRO_DRIVE_DESCONECTADA, ERRO_DRIVE_PERMISSAO, achaSegredoNoTar, caminhoDadosNoDrive, comandoPacoteSh, marcaBackupSh, consultaFilhos, corpoUploadBinario, erroDriveAindaVale, pacoteDadosRe, pacotesDadosAApagar, slugMaquina, type ConjuntoDados } from "./google-core";
import { CONFERIR_RESTAURO_SH, comandoRestaurarSh, copiasDeBackup, decisaoRestauroDados, homeAntigoDoTar, linhaSshRestaurar, parseConferirRestauro, type ArquivoDrive, type ArquivoLocal, type CopiaConjunto } from "./restauro-core";
import { sessaoDriveCom, type SessaoDrive } from "./google";
import { acessoValido, contaStatus } from "./conta-google";
import { lerSenhaBackup, temSenhaBackup } from "./senha-backup";
import { cifrarPacote, decifrarPacote } from "./backup-cifra";
import { runSsh } from "../whatsapp/whatsapp-ssh";
import { gravar } from "./comum";
import { registrar } from "../auditoria/auditoria";
import { log } from "../maquina/tunnel";
import { sendToHost } from "../app/windows";
import { eventoHook } from "../app/depuracao";
import type { BackupCopiasView, BackupDadosEtapa, BackupDadosProgresso, BackupRestauroEtapa, BackupRestauroPedido, BackupRestauroProgresso, BackupRestauroResultado } from "../../shared/ipc";

const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=30", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=8", "-o", "ControlMaster=no", "-o", "ControlPath=none"];
const INTERVALO = 24 * 60 * 60_000;
/** Teto do pacote. O maior conjunto medido (transcripts do agente) dá ~37 MB; muito acima disso é erro. */
const PACOTE_MAX = 512 * 1024 * 1024;


export interface EnvioDados { conjunto: string; caminho: string; bytes: number; apagados: number; local: string }

/**
 * Pasta da cópia local, uma por máquina, em Documentos (alcançável pela pessoa, ao contrário do userData).
 * A cópia local é gravada **antes** do envio: se o Drive falhar, ainda sobra um pacote fora da VM.
 */
export const pastaBackupDados = (host: string): string => path.join(app.getPath("documents"), "meu-bot", "backup", host.replace(/[^\w.-]/g, "_"));
/** Grava o pacote e apaga os anteriores do mesmo conjunto: a mesma retenção de uma cópia só do Drive. */
function gravarLocal(host: string, c: ConjuntoDados, arquivo: string, pacote: Buffer): string {
  const dir = pastaBackupDados(host);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const destino = path.join(dir, arquivo);
  gravar(destino, pacote);
  const re = pacoteDadosRe(c.prefixo, host);
  for (const f of fs.readdirSync(dir)) { if (f !== arquivo && re.test(f)) { try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* fica para a próxima */ } } }
  return destino;
}

/**
 * Empacota um conjunto na VM e traz pelo stdout do ssh. O que fica de fora está em `c.excluir`; os anexos do CRM e
 * os comprovantes do financeiro entram, porque são justamente o que se perde junto com a máquina.
 *
 * Os padrões do `--exclude` são relativos ao membro que o tar gera (`db/...`, sem `./`): com `./` na frente eles
 * não casam e o backup local entra no pacote em silêncio.
 */
/** Sai com 3 quando nenhuma pasta do conjunto existe na máquina (ver `comandoPacoteSh`): não há o que copiar, não é falha. */
const SEM_NADA = 3;
async function empacotar(host: string, c: ConjuntoDados): Promise<Buffer | null> {
  // O comando é puro e testado (google-core.ts): lista só o que existe e tolera o tar 1 ("file changed as we read it").
  const filho = spawn("ssh", [...SSH_OPTS, "--", host, comandoPacoteSh(c)], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const partes: Buffer[] = [];
  let bytes = 0; let estourou = false;
  filho.stdout.on("data", (d: Buffer) => {
    bytes += d.length;
    if (bytes > PACOTE_MAX) { estourou = true; filho.kill(); return; }
    partes.push(d);
  });
  let erro = "";
  filho.stderr.on("data", (d: Buffer) => { erro += d.toString("utf8"); });
  const code = await new Promise<number | null>((res) => filho.on("close", res));
  if (estourou) throw new Error(`o pacote de ${c.id} passou de ${Math.round(PACOTE_MAX / 1024 / 1024)} MB`);
  if (code === SEM_NADA) { log(`[dados-drive] ${host}: ${c.id}: nada desse conjunto nesta máquina; pulado`); return null; }
  if (code !== 0) throw new Error(`a máquina não empacotou ${c.id}: ${erro.trim().split("\n").pop() ?? `código ${code}`}`);
  if (/aviso: .*tar 1/.test(erro)) log(`[dados-drive] ${host}: ${c.id}: arquivos mudaram durante o empacotamento (a máquina estava gravando); o pacote saiu inteiro`);
  const pacote = Buffer.concat(partes);
  if (pacote.length === 0) throw new Error(`a máquina devolveu um pacote vazio de ${c.id}`);
  return pacote;
}

/**
 * Sobe um conjunto e apaga os pacotes anteriores daquela pasta. `"sem-senha"` = pulado de propósito (conjunto cifrado
 * sem senha definida): nunca cai no caminho de subir em texto claro, nem "só desta vez". `"ausente"` = a máquina não
 * tem esse conjunto (ex.: Financeiro numa máquina sem o financeiro); não é erro e a tela não precisa falar dele.
 */
async function enviarConjunto(s: SessaoDrive, host: string, c: ConjuntoDados): Promise<EnvioDados | "sem-senha" | "ausente"> {
  const senha = c.cifrar === true ? lerSenhaBackup() : null;
  if (c.cifrar === true && senha === null) return "sem-senha";
  const cru = await empacotar(host, c);
  if (cru === null) return "ausente";
  // O que sobe sem cifra passa por varredura antes: achou cara de segredo, não sobe e a tela diz o porquê.
  if (c.cifrar !== true) {
    const achado = achaSegredoNoTar(gunzipSync(cru));
    if (achado !== null) throw new Error(`encontrei o que parece um ${achado.tipo}${achado.arquivo !== null ? ` em ${achado.arquivo}` : ""} no pacote; não sobe sem cifra. Confira esse arquivo (apague a linha, ou tire-o do conjunto) ou mova o conjunto para cifrado`);
  }
  const pacote = senha === null ? cru : await cifrarPacote(cru, senha);
  const { pastas, arquivo } = caminhoDadosNoDrive(host, c, Date.now());
  const local = gravarLocal(host, c, arquivo, pacote);
  const pai = await s.pasta(pastas);
  const fronteira = `meu-bot-${Date.now().toString(36)}`;
  const up = await s.api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${fronteira}` },
    body: corpoUploadBinario({ name: arquivo, parents: [pai], mimeType: "application/gzip" }, pacote, fronteira, "application/gzip"),
  });
  const idNovo = typeof up["id"] === "string" ? up["id"] : "";
  // Só agora o anterior sai: com uma cópia só, apagar antes de ter a nova no ar deixaria o dono sem nada.
  let apagados = 0;
  if (idNovo !== "") {
    const lista = await s.api(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q: consultaFilhos(pai), fields: "files(id,name)", spaces: "drive", pageSize: "100" })}`);
    for (const id of pacotesDadosAApagar(Array.isArray(lista["files"]) ? (lista["files"] as { id?: unknown; name?: unknown }[]) : [], idNovo, c.prefixo, host)) {
      try { await s.api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, { method: "DELETE" }); apagados += 1; }
      catch (e) { log(`[dados-drive] não consegui apagar um pacote antigo de ${c.id}: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }
  const caminho = [...pastas, arquivo].join(" / ");
  log(`[dados-drive] ${c.id} de ${host} no Drive: ${caminho} (${pacote.length} bytes; ${apagados} antigo(s) apagado(s); cópia local em ${local})`);
  // O registro na conta: o agente dela lê e responde "o backup de hoje entrou" (5 nov: ele dizia que não achava backup nenhum). Falhar aqui não desfaz o envio.
  try {
    const r = await runSsh(host, `${marcaBackupSh({ conjunto: c.id, nome: c.nome, arquivo, bytes: pacote.length, quando: new Date().toISOString(), caminho })}\n`, 30_000);
    if (!/^MARCA=ok$/m.test(r.stdout)) log(`[dados-drive] ${host}: registro do backup não gravado na conta: ${(r.stderr.trim() || r.stdout.trim()).split("\n").pop() ?? "sem resposta"}`);
  } catch (e) { log(`[dados-drive] ${host}: registro do backup não gravado na conta: ${e instanceof Error ? e.message : String(e)}`); }
  return { conjunto: c.id, caminho, bytes: pacote.length, apagados, local };
}

/**
 * Última cópia de cada máquina, para a aba Conta Google mostrar sem precisar falar com o Drive. `tentativaEm` é quando
 * a última tentativa rodou (com ou sem sucesso), para o erro vir datado em vez de parecer o estado de agora.
 */
export interface EstadoDadosDrive { ultimaEm: string | null; tentativaEm: string | null; conta: string | null; enviados: EnvioDados[]; erro: string | null }
const ARQ_ESTADO = (): string => path.join(app.getPath("userData"), "dados-drive.json");
const VAZIO: EstadoDadosDrive = { ultimaEm: null, tentativaEm: null, conta: null, enviados: [], erro: null };
const lerEstadoTodos = (): Record<string, Partial<EstadoDadosDrive>> => { try { return JSON.parse(fs.readFileSync(ARQ_ESTADO(), "utf8")) as Record<string, Partial<EstadoDadosDrive>>; } catch { return {}; } };
/** O estado gravado, já sem o erro de conta que a conta de agora desmente (reconectou depois da última tentativa). */
export function estadoDadosDrive(host: string): EstadoDadosDrive {
  const e: EstadoDadosDrive = { ...VAZIO, ...lerEstadoTodos()[host] };
  return { ...e, erro: erroDriveAindaVale(e.erro, contaStatus(host)) };
}
function gravarEstado(host: string, e: EstadoDadosDrive): void {
  try { gravar(ARQ_ESTADO(), JSON.stringify({ ...lerEstadoTodos(), [host]: e }, null, 1)); } catch { /* o estado é só para a tela */ }
}

/**
 * Envia todos os conjuntos de uma máquina para o Drive da Conta Google do dono. Um conjunto que falhe não impede o
 * outro: são cópias independentes, e meia cópia é melhor que nenhuma. Guarda o resultado para a tela mostrar.
 */
export async function enviarDadosAoDrive(host: string): Promise<EstadoDadosDrive> {
  const st = contaStatus(host);
  const agora = new Date().toISOString();
  // Sem conta, a última cópia boa continua valendo na tela: só o erro e a hora da tentativa mudam.
  const anterior = { ...VAZIO, ...lerEstadoTodos()[host] };
  if (!st.conectado) { const e = { ...anterior, tentativaEm: agora, erro: ERRO_DRIVE_DESCONECTADA }; gravarEstado(host, e); return e; }
  if (st.precisaReconectar) {
    const e = { ...anterior, tentativaEm: agora, conta: st.perfil?.email ?? null, erro: ERRO_DRIVE_PERMISSAO };
    gravarEstado(host, e); return e;
  }
  const s = sessaoDriveCom(await acessoValido(host));
  const enviados: EnvioDados[] = []; const erros: string[] = [];
  const pulados: string[] = [];
  // Cada etapa vai para as janelas da máquina (a página Conta Google mostra o andamento) e para a faixa de depuração.
  const total = CONJUNTOS_DADOS.length;
  const avisar = (c: ConjuntoDados, indice: number, etapa: BackupDadosEtapa, bytes: number | null, detalhe: string | null): void => {
    const p: BackupDadosProgresso = { conjunto: c.id, nome: c.nome, etapa, indice, total, bytes, detalhe };
    sendToHost(host, "backup-dados:progress", p);
    eventoHook("backup-dados:progress", `${host}: ${c.nome} (${indice}/${total}) ${etapa}${bytes !== null ? ` ${bytes} bytes` : ""}${detalhe !== null ? `: ${detalhe}` : ""}`);
  };
  for (const [i, c] of CONJUNTOS_DADOS.entries()) {
    avisar(c, i + 1, "enviando", null, null);
    try {
      const r = await enviarConjunto(s, host, c);
      if (r === "sem-senha") { pulados.push(c.nome); avisar(c, i + 1, "pulado", null, "sem senha de backup"); }
      else if (r === "ausente") avisar(c, i + 1, "ausente", null, null);
      else { enviados.push(r); avisar(c, i + 1, "enviado", r.bytes, null); }
    } catch (e) { const m = e instanceof Error ? e.message : String(e); erros.push(`${c.id}: ${m}`); avisar(c, i + 1, "erro", null, m); }
  }
  if (pulados.length > 0) erros.push(`${pulados.join(" e ")}: sem senha de backup definida, não subiu (credencial nunca vai sem cifra)`);
  const estado: EstadoDadosDrive = { ultimaEm: enviados.length > 0 ? agora : anterior.ultimaEm, tentativaEm: agora, conta: st.perfil?.email ?? null, enviados: enviados.length > 0 ? enviados : anterior.enviados, erro: erros.length > 0 ? erros.join("; ") : null };
  gravarEstado(host, estado);
  // A pessoa vê no registro da máquina dela que uma cópia saiu, e para onde.
  if (enviados.length > 0) void registrar(host, "backup.dados-drive", enviados.map((e) => e.conjunto).join(", "));
  return estado;
}

const agendados = new Map<string, { timer: ReturnType<typeof setInterval>; rodar: () => void }>();
/** Uma vez por máquina (quando a extensão do CRM sobe): 2 min depois e a cada 24 h. */
export function agendarDadosAoDrive(host: string, ligado: () => boolean): void {
  if (agendados.has(host)) return;
  const rodar = (): void => {
    if (!ligado()) return;
    void enviarDadosAoDrive(host).then(
      ({ erro }) => { if (erro !== null) log(`[dados-drive] ${host}: ${erro}`); },
      // Máquina inacessível ou token recusado: registra e espera o próximo ciclo, sem repetir em laço.
      (e: unknown) => { log(`[dados-drive] ${host} falhou: ${e instanceof Error ? e.message : String(e)}`); },
    );
  };
  setTimeout(rodar, 2 * 60_000).unref();
  const timer = setInterval(rodar, INTERVALO); timer.unref(); agendados.set(host, { timer, rodar });
}
export function pararDadosAoDrive(host: string): void { const a = agendados.get(host); if (a) clearInterval(a.timer); agendados.delete(host); }
/** A Conta Google acabou de (re)conectar: a cópia das máquinas agendadas sai agora, em vez de esperar o próximo ciclo com um erro velho na tela. */
export function dispararDadosAoDrive(): void { for (const a of agendados.values()) a.rodar(); }

// ---- Restaurar uma cópia nesta máquina (de qualquer máquina): a parte pura está em restauro-core.ts -----------------

/** Um nível do Drive: as filhas de `pai` (pastas ou arquivos), com o bastante para listar cópias. */
async function filhosNoDrive(s: SessaoDrive, pai: string): Promise<{ id: string; name: string; size: number; pasta: boolean }[]> {
  const r = await s.api(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q: consultaFilhos(pai), fields: "files(id,name,size,mimeType)", spaces: "drive", pageSize: "200" })}`);
  const lista = Array.isArray(r["files"]) ? (r["files"] as Record<string, unknown>[]) : [];
  return lista.flatMap((f) => (typeof f["id"] === "string" && typeof f["name"] === "string" ? [{ id: f["id"], name: f["name"], size: Number.parseInt(String(f["size"] ?? "0"), 10) || 0, pasta: f["mimeType"] === "application/vnd.google-apps.folder" }] : []));
}
/** As cópias locais de todas as máquinas (`Documents/meu-bot/backup/<máquina>/`). */
function copiasLocais(): ArquivoLocal[] {
  const raiz = path.join(app.getPath("documents"), "meu-bot", "backup");
  const out: ArquivoLocal[] = [];
  let maquinas: string[] = [];
  try { maquinas = fs.readdirSync(raiz); } catch { return out; }
  for (const m of maquinas) {
    const dir = path.join(raiz, m);
    let nomes: string[] = [];
    try { nomes = fs.readdirSync(dir); } catch { continue; }
    for (const f of nomes) { try { const st = fs.statSync(path.join(dir, f)); if (st.isFile()) out.push({ name: f, bytes: st.size, caminho: path.join(dir, f) }); } catch { /* sumiu no meio */ } }
  }
  return out;
}
/** As cópias no Drive desta conta: `meu-bot/<máquina>/<Conjunto>/*` (o escopo `drive.file` só mostra o que este app subiu). */
async function copiasNoDrive(s: SessaoDrive): Promise<ArquivoDrive[]> {
  const raiz = await s.acharPasta(["meu-bot"]);
  if (raiz === null) return [];
  const maquinas = (await filhosNoDrive(s, raiz)).filter((f) => f.pasta);
  const porMaquina = await Promise.all(maquinas.map(async (m) => {
    const conjuntos = (await filhosNoDrive(s, m.id)).filter((f) => f.pasta);
    const arquivos = await Promise.all(conjuntos.map((c) => filhosNoDrive(s, c.id)));
    return arquivos.flat().filter((f) => !f.pasta).map((f) => ({ id: f.id, name: f.name, size: f.size }));
  }));
  return porMaquina.flat();
}
/** Fonte dos pacotes (com os caminhos que a tela não precisa ver). */
let ultimasCopias = new Map<string, CopiaConjunto>();
/**
 * O que dá para restaurar nesta máquina: Drive (se a conta está conectada) + Mac, fundidos por nome. Sem Drive a
 * lista continua valendo com o que há no Mac, e `driveErro` diz por quê.
 */
export async function listarCopias(host: string): Promise<BackupCopiasView> {
  const st = contaStatus(host);
  let drive: ArquivoDrive[] = []; let driveErro: string | null = null;
  if (!st.conectado) driveErro = ERRO_DRIVE_DESCONECTADA;
  else if (st.precisaReconectar) driveErro = ERRO_DRIVE_PERMISSAO;
  else { try { drive = await copiasNoDrive(sessaoDriveCom(await acessoValido(host))); } catch (e) { driveErro = e instanceof Error ? e.message : String(e); } }
  const maquinas = copiasDeBackup(drive, copiasLocais(), host);
  ultimasCopias = new Map(maquinas.flatMap((m) => m.conjuntos.map((c) => [`${m.maquina}/${c.conjunto}`, c] as const)));
  return { atual: slugMaquina(host), temSenha: temSenhaBackup(), driveErro, maquinas: maquinas.map((m) => ({ maquina: m.maquina, conjuntos: m.conjuntos.map(({ conjunto, nome, arquivo, bytes, data, cifrado, origem }) => ({ conjunto, nome, arquivo, bytes, data, cifrado, origem })) })) };
}

/** Manda o pacote claro pelo stdin do ssh para o script de restauração; exige `RESTAURADO=ok`. */
function enviarParaRestaurar(host: string, linha: string, pacote: Buffer): Promise<string> {
  return new Promise((res, rej) => {
    const filho = spawn("ssh", [...SSH_OPTS, "--", host, linha], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    filho.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    filho.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    filho.stdin.on("error", () => { /* o remoto recusou e fechou: o motivo vem no stderr */ });
    filho.on("error", rej);
    filho.on("close", (code) => {
      if (code === 0 && /RESTAURADO=ok/.test(stdout)) res(stdout);
      else rej(new Error(stderr.trim().split("\n").filter((l) => l !== "").pop() ?? `a máquina devolveu código ${code}`));
    });
    filho.stdin.end(pacote);
  });
}
const emRestauro = new Set<string>();
/**
 * Restaura os conjuntos escolhidos de uma cópia nesta máquina, um por vez, na ordem de `CONJUNTOS_DADOS`; um que
 * falhe não impede o seguinte. Pré-voo antes de encostar em qualquer coisa (espaço, WhatsApp vivo). O pacote vem
 * do Mac quando há cópia local igual; senão desce do Drive. O cifrado abre com a senha do Keychain ou com a do
 * pedido (que não é guardada). Cada etapa vai para as janelas da máquina.
 */
export async function restaurarDoDrive(host: string, p: BackupRestauroPedido): Promise<BackupRestauroResultado> {
  if (emRestauro.has(host)) throw new Error("já há uma restauração em andamento nesta máquina");
  emRestauro.add(host);
  try {
    const copias = await listarCopias(host);
    const maq = copias.maquinas.find((m) => m.maquina === p.maquina);
    if (maq === undefined) throw new Error(`não achei cópias da máquina ${p.maquina}`);
    const escolhidos = CONJUNTOS_DADOS.filter((c) => p.conjuntos.includes(c.id)).map((c) => { const copia = ultimasCopias.get(`${maq.maquina}/${c.id}`); if (copia === undefined) throw new Error(`não há cópia de ${c.nome} da máquina ${maq.maquina}`); return { c, copia }; });
    if (escolhidos.length === 0) throw new Error("escolha pelo menos um conjunto");
    const conf = parseConferirRestauro((await runSsh(host, `${CONFERIR_RESTAURO_SH}\n`, 60_000)).stdout);
    const decisao = decisaoRestauroDados(conf, p.conjuntos, escolhidos.reduce((n, e) => n + e.copia.bytes, 0), p.substituirWhatsapp, maq.maquina === copias.atual);
    if (decisao.bloqueios.length > 0) throw new Error(decisao.bloqueios.join("; "));
    const senhas = [p.senha ?? "", lerSenhaBackup() ?? ""].filter((x) => x.trim() !== "");
    let sessao: SessaoDrive | null = null;
    const restaurados: string[] = []; const erros: string[] = []; let antes: string | null = null;
    const total = escolhidos.length;
    for (const [i, { c, copia }] of escolhidos.entries()) {
      const avisar = (etapa: BackupRestauroEtapa, detalhe: string | null = null): void => {
        const ev: BackupRestauroProgresso = { conjunto: c.id, nome: c.nome, etapa, indice: i + 1, total, detalhe };
        sendToHost(host, "backup-dados:restauro", ev);
        eventoHook("backup-dados:restauro", `${host}: ${c.nome} (${i + 1}/${total}) ${etapa}${detalhe !== null ? `: ${detalhe}` : ""}`);
      };
      try {
        let bruto: Buffer;
        if (copia.local !== null && fs.existsSync(copia.local)) bruto = fs.readFileSync(copia.local);
        else if (copia.driveId !== null) { avisar("baixando"); sessao ??= sessaoDriveCom(await acessoValido(host)); bruto = await sessao.baixar(copia.driveId, PACOTE_MAX); }
        else throw new Error("a cópia não está nem no Drive nem no Mac");
        let claro = bruto;
        if (copia.cifrado) {
          avisar("decifrando");
          if (senhas.length === 0) throw new Error("o pacote é cifrado e não há senha: informe a senha do backup");
          let abriu = false;
          for (const senha of senhas) { try { claro = await decifrarPacote(bruto, senha); abriu = true; break; } catch { /* tenta a próxima */ } }
          if (!abriu) throw new Error("a senha não abre este pacote (foi cifrado com outra?)");
        }
        avisar("restaurando");
        // Só os conjuntos que podem carregar o home antigo por extenso; CRM e financeiro são dados puros.
        const homeAntigo = c.id === "crm" || c.id === "financeiro" ? null : homeAntigoDoTar(gunzipSync(claro));
        const saida = await enviarParaRestaurar(host, linhaSshRestaurar(comandoRestaurarSh({ conjunto: c, motor: conf.motor, homeAntigo, substituirWhatsapp: p.substituirWhatsapp })), claro);
        antes = /ANTES=(\S+)/.exec(saida)?.[1] ?? antes;
        const n = (k: string): string => new RegExp(`^${k}=(\\d+)$`, "m").exec(saida)?.[1] ?? "0";
        const detalhe = [`${n("GUARDADOS")} guardado(s)`, n("MESCLADOS") !== "0" ? `${n("MESCLADOS")} projeto(s) do agente juntado(s)` : "", n("TROCADOS") !== "0" ? `caminho trocado em ${n("TROCADOS")} arquivo(s)` : "", n("BLOCOS") !== "0" ? `blocos do meu-bot mantidos em ${n("BLOCOS")} arquivo(s)` : ""].filter((x) => x !== "").join(", ");
        restaurados.push(c.id); avisar("restaurado", detalhe);
        log(`[dados-drive] ${host}: ${c.id} restaurado da cópia de ${maq.maquina} (${copia.arquivo}; ${detalhe})`);
      } catch (e) { const m = e instanceof Error ? e.message : String(e); erros.push(`${c.nome}: ${m}`); avisar("erro", m); log(`[dados-drive] ${host}: ${c.id} não restaurado: ${m}`); }
    }
    if (restaurados.length > 0) void registrar(host, "backup.restaurar-dados", `${maq.maquina}: ${restaurados.join(", ")}`);
    return { restaurados, erros, antes, avisos: decisao.avisos };
  } finally { emRestauro.delete(host); }
}
