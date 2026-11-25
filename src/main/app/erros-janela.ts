/**
 * Erros da interface de cada janela e o log do app, para o controle externo (rotas /erros e /log do term.sock): achar um
 * erro deixa de exigir o app aberto com --remote-debugging-port. O anel fica em memória, por máquina; some ao fechar o app.
 */
import fs from "node:fs";
import path from "node:path";
import { app, type BrowserWindow } from "electron";
import { criarAnel, filtrarLog, type ErroDaJanela } from "./erros-janela-core";

const aneis = new Map<string, ReturnType<typeof criarAnel>>();
const anelDe = (host: string): ReturnType<typeof criarAnel> => { let a = aneis.get(host); if (a === undefined) { a = criarAnel(); aneis.set(host, a); } return a; };

/** Liga nos eventos da janela: erros e avisos do console da interface, queda do processo da página e travamento. */
export function observarErros(win: BrowserWindow, host: string): void {
  const anel = anelDe(host); const wc = win.webContents;
  wc.on("console-message", (e) => {
    if (e.level !== "error" && e.level !== "warning") return;
    anel.por({ em: Date.now(), nivel: e.level === "error" ? "erro" : "aviso", texto: e.message, origem: `${path.posix.basename(e.sourceId)}:${e.lineNumber}` });
  });
  wc.on("render-process-gone", (_e, d) => { anel.por({ em: Date.now(), nivel: "queda", texto: `o processo da página caiu (${d.reason}, código ${d.exitCode})`, origem: "janela" }); });
  wc.on("preload-error", (_e, preload, erro) => { anel.por({ em: Date.now(), nivel: "erro", texto: `preload: ${erro.message}`, origem: path.basename(preload) }); });
  win.on("unresponsive", () => { anel.por({ em: Date.now(), nivel: "travou", texto: "a janela parou de responder", origem: "janela" }); });
}

export const errosDaJanela = (host: string, desde: unknown, limite: unknown): ErroDaJanela[] => anelDe(host).desde(desde, limite);

/** Só o meu-bot.log deste app, e só o fim dele (512 KB bastam para horas de uso): o caminho nunca vem de fora. */
export function lerLog(o: { linhas?: unknown; filtro?: unknown; desde?: unknown }): { linhas: string[]; total: number } {
  const arq = path.join(app.getPath("userData"), "meu-bot.log");
  let texto = "";
  try {
    const { size } = fs.statSync(arq); const teto = 512 * 1024; const ini = Math.max(0, size - teto);
    const fd = fs.openSync(arq, "r");
    try { const buf = Buffer.alloc(size - ini); fs.readSync(fd, buf, 0, buf.length, ini); texto = buf.toString("utf8"); } finally { fs.closeSync(fd); }
    if (ini > 0) texto = texto.slice(texto.indexOf("\n") + 1); // a primeira linha veio cortada
  } catch { /* sem log ainda: lista vazia */ }
  return filtrarLog(texto, o);
}
