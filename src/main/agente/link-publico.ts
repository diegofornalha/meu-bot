/**
 * Link público da pessoa na máquina da janela (tutorial 13): lê o que o admin ligou para ela
 * (~/.local/share/meu-bot/link-publico.json, gravado por ela), troca o nome do link (`link-publico-nome`, que renomeia
 * a pasta dela sem passar pelo root), vê o que está no ar, tira do ar e publica um arquivo deste Mac (scp para uma
 * pasta de passagem no home dela e o `publicar` dela, que renderiza .md). Tudo como ela, por SSH; o admin gere o
 * global em admin/link-publico-admin.ts.
 */
import { app, dialog, type BrowserWindow } from "electron";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LinkPublicoInfo, LinkPublicoItem, LinkPublicoLista, LinkPublicoPublicado, LinkPublicoStatus } from "../../shared/ipc";
import { runSsh, scpPara } from "../whatsapp/whatsapp";
import { LOCAL_HOST } from "../maquina/localBackend";
import { isValidHost } from "../app/settings";
import { registrar } from "../auditoria/auditoria";
import { ITEM_LINK_RE, LP_MAX_BYTES, NOME_LINK_RE, nomeNoLinkDe } from "../admin/link-publico-core";

const STATUS_SH = `[ "$(id -u)" = 0 ] && { echo "LINK=root"; exit 0; }
[ -x /usr/local/bin/publicar ] && echo "GLOBAL=1" || echo "GLOBAL=0"
F="$HOME/.local/share/meu-bot/link-publico.json"
[ -f "$F" ] && [ -L "$HOME/publico" ] && [ -d "$HOME/publico/" ] || { echo "LINK=0"; exit 0; }
N=$(ls -1A "$HOME/publico/" 2>/dev/null | grep -vc '^\\.')
echo "LINK=1 $N $USER"; cat "$F"`;

/** Os comandos do link ficam em /usr/local/bin, que um `bash -s` sem login pode não ter no PATH. */
const PATH_SH = `export PATH=/usr/local/bin:$PATH`;
/** O que está no ar, entre marcadores (a saída do STATUS_SH vem junto no mesmo SSH). */
const LISTA_SH = `echo LISTA-INICIO; publicar --lista 2>/dev/null; echo LISTA-FIM`;
/** Pasta de passagem no home dela (relativa ao home: é onde o scp cai); restos de mais de 2 h são varridos a cada uso. */
const TMP_DIR = ".local/share/meu-bot/publicar-tmp";

const remota = (host: string): boolean => host !== LOCAL_HOST && isValidHost(host);
const ultimaLinha = (s: string): string => s.trim().split("\n").pop() ?? "";
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const reUrlDela = (info: Pick<LinkPublicoInfo, "nome" | "dominio">, flags = ""): RegExp => new RegExp(`^https://${esc(info.nome)}\\.${esc(info.dominio)}/([A-Za-z0-9][A-Za-z0-9._-]{0,127})(/?)$`, flags);

/** Itens do `publicar --lista`: só URLs do link dela com nome seguro (outro host, `javascript:`, `..`, espaço e dotfile caem), sem repetir, em ordem. */
export function lerListaPublicar(out: string, info: Pick<LinkPublicoInfo, "nome" | "dominio">): LinkPublicoItem[] {
  const bloco = /LISTA-INICIO\n([\s\S]*?)LISTA-FIM/.exec(out)?.[1] ?? out;
  const re = reUrlDela(info);
  const vistos = new Map<string, LinkPublicoItem>();
  for (const linha of bloco.split("\n")) {
    const l = linha.trim(); const m = re.exec(l);
    if (m === null || vistos.has(m[1]!)) continue;
    vistos.set(m[1]!, { url: l, nome: m[1]!, pasta: m[2] === "/" });
  }
  return [...vistos.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

/** A URL que o `publicar` imprimiu (a última linha com cara de URL dela antes do `LINK=`); null se não publicou. */
export function lerUrlPublicada(out: string, info: Pick<LinkPublicoInfo, "nome" | "dominio">): string | null {
  const re = reUrlDela(info);
  const antes = out.split(/^LINK=/m)[0] ?? "";
  const linhas = antes.trim().split("\n");
  for (let i = linhas.length - 1; i >= 0; i--) { const l = linhas[i]!.trim(); if (re.test(l)) return l; }
  return null;
}

/**
 * O nome no link a passar ao `publicar`: o que a pessoa digitou (limpo) ou o nome do arquivo (sem acento). Um arquivo
 * comum com nome pedido sem extensão ganha a do arquivo (sem ela o nginx não sabe o tipo e o navegador baixa); um
 * .md não precisa (vira pasta/página).
 */
export function nomeNoLink(nomeLocal: string, pedido: string | undefined): string {
  const base = nomeNoLinkDe(nomeLocal) ?? "arquivo";
  const ext = /\.[a-z0-9]{1,10}$/.exec(base)?.[0] ?? "";
  if (pedido === undefined || pedido.trim() === "") return base;
  const p = nomeNoLinkDe(pedido) ?? base;
  if (/^\.(md|markdown)$/.test(ext)) return p;
  return /\.[a-z0-9]{1,10}$/.test(p) ? p : `${p}${ext}`;
}

/** Lê `LINK=1 <arquivos> <usuário>` + o json; null = desligado, máquina fora ou este Mac. */
export function lerLinkPublico(out: string): LinkPublicoInfo | null {
  const m = /^LINK=1 (\d+) (\S+)$/m.exec(out);
  if (m === null) return null;
  const j = /^\{.*\}$/m.exec(out);
  if (j === null) return null;
  try {
    const v = JSON.parse(j[0]) as { url?: unknown; nome?: unknown; dominio?: unknown };
    if (typeof v.url !== "string" || !/^https:\/\/[a-z0-9.-]+\/$/.test(v.url) || typeof v.nome !== "string" || !NOME_LINK_RE.test(v.nome) || typeof v.dominio !== "string") return null;
    return { url: v.url, nome: v.nome, dominio: v.dominio, arquivos: Number(m[1]), usuario: m[2]! };
  } catch { return null; }
}

/**
 * `LINK=root` = a janela é da conta root: o link público é das contas de usuário (o admin não liga para o root), então
 * o tutorial 13 some. `GLOBAL=1` = a máquina tem o Link Público Global (o `publicar` em /usr/local/bin): sem ele, o
 * passo diz que é o admin quem instala, não que "ainda não ligou" (5 nov: o "Conferir de novo" parecia quebrado).
 */
export function lerLinkPublicoStatus(out: string): LinkPublicoStatus {
  const info = lerLinkPublico(out);
  return { info, possivel: !/^LINK=root$/m.test(out), global: info !== null || /^GLOBAL=1$/m.test(out) };
}

export async function linkPublicoStatus(host: string): Promise<LinkPublicoStatus> {
  if (!remota(host)) return { info: null, possivel: true, global: false };
  const r = await runSsh(host, `${STATUS_SH}\n`, 30_000);
  return lerLinkPublicoStatus(r.stdout);
}

/** Troca o nome do link (o comando confere nome válido, reservado, de outro usuário ou em uso). */
export async function linkPublicoNome(host: string, nome: unknown): Promise<LinkPublicoInfo> {
  if (!remota(host)) throw new Error("o link público é da máquina por SSH");
  if (typeof nome !== "string" || !NOME_LINK_RE.test(nome.trim().toLowerCase())) throw new Error("nome inválido: só letras minúsculas, números e hífen (2 a 63 caracteres)");
  const n = nome.trim().toLowerCase();
  const r = await runSsh(host, `export PATH=/usr/local/bin:$PATH; link-publico-nome '${n}' 2>&1\n${STATUS_SH}\n`, 30_000);
  const erro = /^ERRO: (.*)$/m.exec(r.stdout)?.[1];
  if (erro !== undefined) throw new Error(erro);
  const info = lerLinkPublico(r.stdout);
  if (info === null || info.nome !== n) throw new Error(`não consegui trocar o nome do link: ${r.stdout.trim().split("\n").pop() ?? "sem resposta"}`);
  void registrar(host, "link-publico.nome", n);
  return info;
}

const listaDe = (out: string): LinkPublicoLista | null => {
  const info = lerLinkPublico(out);
  return info === null ? null : { info, itens: lerListaPublicar(out, info) };
};

/** O link dela e o que está no ar (um SSH só); null = desligado, máquina fora ou este Mac. */
export async function linkPublicoLista(host: string): Promise<LinkPublicoLista | null> {
  if (!remota(host)) return null;
  const r = await runSsh(host, `${PATH_SH}\n${STATUS_SH}\n${LISTA_SH}\n`, 30_000);
  return listaDe(r.stdout);
}

/** Tira um item do ar (`publicar --remover`, como ela) e devolve a lista nova. */
export async function linkPublicoRemover(host: string, nome: unknown): Promise<LinkPublicoLista> {
  if (!remota(host)) throw new Error("o link público é da máquina por SSH");
  if (typeof nome !== "string" || !ITEM_LINK_RE.test(nome)) throw new Error("nome de item inválido");
  const r = await runSsh(host, `${PATH_SH}; publicar --remover '${nome}' 2>&1\n${STATUS_SH}\n${LISTA_SH}\n`, 30_000);
  const erro = /^ERRO: (.*)$/m.exec(r.stdout)?.[1];
  if (erro !== undefined) throw new Error(erro);
  const lista = listaDe(r.stdout);
  if (lista === null) throw new Error("não consegui reler o seu link");
  void registrar(host, "link-publico.remover", nome);
  return lista;
}

let publicando = false;
/**
 * Escolhe um arquivo neste Mac (diálogo do main: o renderer nunca manda caminho) e publica no link dela: scp para a
 * pasta de passagem no home dela, `publicar` dela (um .md vira página), passagem apagada. null = cancelou o diálogo.
 */
export async function linkPublicoPublicar(host: string, win: BrowserWindow | null, pedido: unknown): Promise<LinkPublicoPublicado | null> {
  if (!remota(host)) throw new Error("o link público é da máquina por SSH");
  if (pedido !== undefined && typeof pedido !== "string") throw new Error("nome inválido");
  if (publicando) throw new Error("já estou publicando um arquivo; espere terminar");
  const opts: Electron.OpenDialogOptions = { title: "Publicar no seu link", buttonLabel: "Publicar", properties: ["openFile"], defaultPath: app.getPath("documents") };
  const escolha = win === null ? await dialog.showOpenDialog(opts) : await dialog.showOpenDialog(win, opts);
  const local = escolha.filePaths[0];
  if (escolha.canceled || local === undefined) return null;
  publicando = true;
  try {
    const st = await fs.promises.stat(local);
    if (st.isDirectory()) throw new Error("por enquanto publique um arquivo por vez; uma pasta inteira, peça ao agente (\"publica a pasta X\")");
    if (!st.isFile()) throw new Error("isso não é um arquivo");
    if (st.size > LP_MAX_BYTES) throw new Error("arquivo com mais de 100 MB: a Cloudflare não entrega arquivos maiores que isso pelo link");
    const seguro = nomeNoLinkDe(path.basename(local)) ?? "arquivo";
    const destino = nomeNoLink(path.basename(local), pedido);
    const id = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
    const T = `${TMP_DIR}/${id}`;
    const prep = await runSsh(host, `mkdir -p "$HOME/${T}" && find "$HOME/${TMP_DIR}" -mindepth 1 -maxdepth 1 -mmin +120 -exec rm -rf {} + 2>/dev/null; [ -d "$HOME/${T}" ] && echo TMP=ok\n`, 30_000);
    if (!/^TMP=ok$/m.test(prep.stdout)) throw new Error(`não consegui preparar a pasta de passagem na máquina: ${ultimaLinha(prep.stderr) || ultimaLinha(prep.stdout) || "sem resposta"}`);
    const up = await scpPara(host, local, `${T}/${seguro}`, 10 * 60_000);
    if (up.code !== 0) {
      void runSsh(host, `rm -rf "$HOME/${T}"\n`, 20_000).catch(() => undefined);
      throw new Error(`não consegui mandar o arquivo para a máquina: ${ultimaLinha(up.stderr) || "scp falhou"}`);
    }
    const r = await runSsh(host, `${PATH_SH}; publicar "$HOME/${T}/${seguro}" '${destino}' 2>&1; rm -rf "$HOME/${T}"\n${STATUS_SH}\n${LISTA_SH}\n`, 120_000);
    const erro = /^ERRO: (.*)$/m.exec(r.stdout)?.[1];
    if (erro !== undefined) throw new Error(erro);
    const lista = listaDe(r.stdout);
    if (lista === null) throw new Error("publiquei, mas não consegui reler o seu link");
    const url = lerUrlPublicada(r.stdout, lista.info);
    if (url === null) throw new Error(`não consegui publicar: ${ultimaLinha(r.stdout) || "sem resposta"}`);
    void registrar(host, "link-publico.publicar", destino);
    return { ...lista, url };
  } finally { publicando = false; }
}
