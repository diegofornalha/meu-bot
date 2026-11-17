/**
 * Tutorial 17 (Salvy no seu Claude Code): a fonte "conexoes" do guia e o corpo do passo "Conectar". O estado vem da
 * visão das Conexões (configuracoes/conexoes.ts, a dona); o botão usa o mesmo Conectar de lá. Os passos de login e da
 * primeira pergunta acontecem no Claude Code e são marcados à mão (o app não vê o token nem a resposta).
 */
import { el } from "../lib/dom.js";
import { carregando } from "../lib/carregando.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { ctx } from "../app/ctx.js";
import { registrarFonte } from "../tutoriais/fontes.js";
import { registrarPassos } from "../tutoriais/passos.js";
import { abrirConfiguracoesEm } from "./configuracoes.js";
import { aoMudarConexoes, conectarConexao, conexoesAtual, textoDaLinha } from "./conexoes.js";

const SALVY = "salvy";
let ocupado = false;
let recado: { text: string; bad: boolean } | null = null;

function renderSalvyConectar(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  const v = conexoesAtual();
  const c = v?.itens.find((i) => i.id === SALVY);
  if (v === null || c === undefined) { box.append(carregando("Lendo o Claude Code deste Mac…", "guia-salvy")); container.append(box); return; }
  const t = textoDaLinha(c);
  const row = el("div", "audio-row");
  row.append(el("span", c.estado === "registrado" ? "audio-ok" : "hint", c.estado === "registrado" ? "✓ conectado no Claude Code" : t.estado));
  if (t.botao !== null && v.cli) {
    const b = el("button", "btn btn-primary btn-small", ocupado ? "Conectando…" : t.botao); b.type = "button"; b.disabled = ocupado;
    b.addEventListener("click", () => {
      ocupado = true; recado = null; ctx.paintGuide();
      void conectarConexao(SALVY)
        .then(() => { recado = { text: "Pronto. Agora entre com a conta do Salvy no Claude Code (próximo passo).", bad: false }; })
        .catch((err: unknown) => { recado = { text: ipcErrorText(err), bad: true }; })
        .finally(() => { ocupado = false; ctx.paintGuide(); });
    });
    row.append(b);
  }
  const abrir = el("button", "btn btn-ghost btn-small", "Abrir Conexões"); abrir.type = "button";
  abrir.addEventListener("click", () => { abrirConfiguracoesEm("conexoes"); });
  row.append(abrir);
  box.append(row);
  if (!v.cli) box.append(el("p", "hint guide-pair-note", `Não achei o comando claude neste Mac. Instale o Claude Code ou, no terminal: claude mcp add --scope user --transport http ${c.id} ${c.url}`));
  if (recado !== null) box.append(el("p", `hint ${recado.bad ? "guide-pair-note" : "audio-ok"}`, recado.text));
  container.append(box);
}

/** Liga a fonte e o passo ao guia; o renderer.ts chama uma vez. */
export function ligarConexoesGuia(): void {
  registrarFonte("conexoes", () => {
    const v = conexoesAtual();
    return { known: v !== null, dados: { conexoes: { cli: v?.cli ?? null, salvy: v?.itens.find((i) => i.id === SALVY)?.estado ?? null } } };
  });
  registrarPassos({ "salvy-conectar": (txt) => renderSalvyConectar(txt) });
  aoMudarConexoes(() => ctx.paintGuide());
}
