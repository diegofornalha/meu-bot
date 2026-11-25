/**
 * Liga numa caixa de texto o "arrastar do Finder escreve o endereço": o arquivo ou a pasta solto vira o endereço dele
 * no texto, onde o cursor está, como no terminal. A conta do texto é pura (soltar-caminho-core.ts); o endereço de cada
 * item vem de `caminhoDe` (no app, window.meuBot.caminhoDoArquivo, que só o preload sabe responder).
 */
import { inserirNoCursor, textoDosCaminhos } from "./soltar-caminho-core.js";

export function ligarSoltarCaminho(caixa: HTMLTextAreaElement, caminhoDe: (arquivo: File) => string): void {
  const trazArquivos = (ev: DragEvent): boolean => ev.dataTransfer?.types.includes("Files") === true;
  caixa.addEventListener("dragover", (ev) => {
    if (!trazArquivos(ev) || ev.dataTransfer === null) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "copy";
  });
  caixa.addEventListener("drop", (ev) => {
    if (!trazArquivos(ev) || ev.dataTransfer === null) return;
    ev.preventDefault();
    const texto = textoDosCaminhos(Array.from(ev.dataTransfer.files, caminhoDe));
    if (texto === "") return;
    const r = inserirNoCursor(caixa.value, caixa.selectionStart, caixa.selectionEnd, texto);
    caixa.value = r.valor;
    caixa.setSelectionRange(r.cursor, r.cursor);
    caixa.focus();
    // Quem ouve a caixa (o brilho do Enviar, o envio automático) fica sabendo como se a pessoa tivesse digitado.
    caixa.dispatchEvent(new Event("input"));
  });
}
