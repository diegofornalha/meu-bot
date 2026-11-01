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
import { CONJUNTOS_DADOS, ERRO_DRIVE_DESCONECTADA, ERRO_DRIVE_PERMISSAO, achaSegredoNoTar, caminhoDadosNoDrive, comandoPacoteSh, consultaFilhos, corpoUploadBinario, erroDriveAindaVale, pacoteDadosRe, pacotesDadosAApagar, type ConjuntoDados } from "./google-core";
import { sessaoDriveCom, type SessaoDrive } from "./google";
import { acessoValido, contaStatus } from "./conta-google";
import { lerSenhaBackup } from "./senha-backup";
import { cifrarPacote } from "./backup-cifra";
import { gravar } from "./comum";
import { registrar } from "../auditoria/auditoria";
import { log } from "../maquina/tunnel";
import { sendToHost } from "../app/windows";
import { eventoHook } from "../app/depuracao";
import type { BackupDadosEtapa, BackupDadosProgresso } from "../../shared/ipc";

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
  const filho = spawn("ssh", [...SSH_OPTS, "--", host, comandoPacoteSh(c)], { stdio: ["ignore", "pipe", "pipe"] });
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
