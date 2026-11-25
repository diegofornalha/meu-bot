/**
 * Os trechos de JavaScript e de teclado que leem e mexem numa página: saíram do nav-api.ts (25 nov) para o Navegador
 * (webviews, nav-api.ts) e a interface do próprio app (janela principal, term-api.ts, rotas /ui/…) usarem a mesma cópia.
 * Tudo aqui roda no processo principal, por `webContents.executeJavaScript` / `sendInputEvent`.
 */
import type { WebContents } from "electron";
import { literalJs } from "./nav-donos-core";

/** Texto e elementos interativos da página, numerados; o número é o que o agente usa em clicar/digitar. */
export const readScript = (ignorar = ""): string => `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && (!e.checkVisibility || e.checkVisibility()); };
  const items = []; const marcas = []; window.__meuBotEls = [];
  const sel = "a[href], button, input, textarea, select, [role=button], [role=link], [role=tab], [role=menuitem], [role=textbox], [contenteditable=true], summary";
  for (const e of document.querySelectorAll(sel)) {
    if (!vis(e) || items.length >= 400) continue;${ignorar === "" ? "" : `\n    if (e.closest(${literalJs(ignorar)})) continue;`}
    const tag = e.tagName.toLowerCase();
    const type = e.getAttribute("type") || "";
    const label = (e.getAttribute("aria-label") || e.getAttribute("placeholder") || e.getAttribute("title") || e.getAttribute("alt") || (e.labels && e.labels[0] && e.labels[0].innerText) || e.innerText || e.value || "").replace(/\\s+/g, " ").trim().slice(0, 80);
    const kind = tag === "a" ? "link" : tag === "input" ? (type === "checkbox" || type === "radio" ? type : type === "submit" || type === "button" ? "botão" : "campo") : tag === "textarea" || e.getAttribute("contenteditable") === "true" || e.getAttribute("role") === "textbox" ? "campo" : tag === "select" ? "seleção" : "botão";
    const n = window.__meuBotEls.push(e);
    const r = e.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (marcas.length < 60 && cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight) marcas.push({ n, x: cx, y: cy, rotulo: label.slice(0, 40) });
    items.push(n + ". [" + kind + "] " + label + (tag === "a" && e.href ? "  → " + e.href.slice(0, 100) : "") + (kind === "campo" && e.value ? "  (valor: " + String(e.value).slice(0, 40) + ")" : ""));
  }
  const text = (document.body ? document.body.innerText : "").replace(/\\n{3,}/g, "\\n\\n").trim();
  return { title: document.title, url: location.href, text: text.slice(0, 12000), truncated: text.length > 12000, elements: items, marcas: { vw: innerWidth, vh: innerHeight, itens: marcas } };
})()`;
/** A leitura do Navegador: a página inteira. */
export const READ_SCRIPT = readScript();
/**
 * `/print` com `marcas`: desenha por um instante, na própria página, o número de cada elemento da última leitura que
 * está à vista (o mesmo número do clicar/digitar), para ele sair na imagem. Shadow DOM fechado e sem eventos: a página
 * não o estiliza nem o recebe em clique. Devolve quantos desenhou; DESMARCAR tira.
 */
export const MARCAR_SCRIPT = `(() => {
  const velho = document.getElementById("__meu-bot-marcas"); if (velho) velho.remove();
  const host = document.createElement("div"); host.id = "__meu-bot-marcas"; host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const sombra = host.attachShadow({ mode: "closed" }); let k = 0;
  (window.__meuBotEls || []).forEach((e, i) => {
    if (!e.isConnected) return;
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return;
    const m = document.createElement("span"); m.textContent = String(i + 1);
    m.style.cssText = "position:absolute;left:" + Math.max(0, r.left) + "px;top:" + Math.max(0, r.top) + "px;font:700 11px/1.2 -apple-system,system-ui,sans-serif;padding:1px 4px;border-radius:4px;color:#fff;outline:1px solid #fff;background:hsl(" + Math.round(((i + 1) * 137.508) % 360) + " 85% 38%)";
    sombra.append(m); k++;
  });
  // Um <dialog> modal fica na camada de cima do navegador, acima de qualquer z-index: com um aberto, as marcas vão dentro dele.
  (document.querySelector("dialog[open]") || document.documentElement).append(host);
  return k;
})()`;
export const DESMARCAR_SCRIPT = `(() => { const m = document.getElementById("__meu-bot-marcas"); if (m) m.remove(); })()`;
export const pick = (n: number): string => `(() => { const e = (window.__meuBotEls || [])[${n - 1}]; if (!e) throw new Error("elemento ${n} não existe: use 'ler' de novo"); return e; })()`;

/** O elemento pedido: pelo número da última leitura, por seletor CSS ou pelo texto do botão/link. */
export function alvoDeClique(b: { n?: unknown; seletor?: unknown; texto?: unknown }): string {
  const target = typeof b.n === "number" ? pick(b.n)
    : typeof b.seletor === "string" ? `(() => { const e = document.querySelector(${literalJs(b.seletor)}); if (!e) throw new Error("nada com o seletor"); return e; })()`
      : typeof b.texto === "string" ? `(() => { const q = ${literalJs(b.texto)}.toLowerCase(); const all = [...document.querySelectorAll("a, button, [role=button], [role=link], [role=tab], [role=menuitem], input[type=submit], input[type=button], summary, label")]; const e = all.find((x) => (x.innerText || x.value || x.getAttribute("aria-label") || "").toLowerCase().trim() === q) || all.find((x) => (x.innerText || x.value || x.getAttribute("aria-label") || "").toLowerCase().includes(q)); if (!e) throw new Error("nenhum botão/link com esse texto"); return e; })()`
        : null;
  if (target === null) throw new Error("diga n (número do 'ler'), texto ou seletor");
  return target;
}
/** Clique direito: o evento `contextmenu` no centro do elemento, que é o que abre os menus da aba e do WhatsApp. */
export const cliqueDireitoScript = (target: string): string => `(() => { const e = ${target}; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); e.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); return true; })()`;
/** Rola até o elemento, mede o ponto (para a faixa de depuração), foca e clica. */
export const clicarScript = (target: string): string => `(() => { const e = ${target}; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); const ponto = { x: r.left + r.width / 2, y: r.top + r.height / 2, vw: innerWidth, vh: innerHeight }; e.focus && e.focus(); e.click(); return ponto; })()`;
/** O campo onde digitar: pelo número, por seletor, ou o que já está com o foco. */
export const alvoDeDigitacao = (b: { n?: unknown; seletor?: unknown }): string => (typeof b.n === "number" ? pick(b.n) : typeof b.seletor === "string" ? `(() => { const e = document.querySelector(${literalJs(b.seletor)}); if (!e) throw new Error("nada com o seletor"); return e; })()` : "document.activeElement");
/** Foca o campo e seleciona o que há nele, para o texto novo entrar por cima. */
export const focarScript = (target: string): string => `(() => { const e = ${target}; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); const ponto = { x: r.left + r.width / 2, y: r.top + r.height / 2, vw: innerWidth, vh: innerHeight }; e.focus(); if ("value" in e && typeof e.value === "string") { e.select && e.select(); } else if (e.isContentEditable) { const r = document.createRange(); r.selectNodeContents(e); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } return ponto; })()`;
/**
 * Digitar num campo da interface do app: o valor entra direto e o campo avisa com `input` e `change`, como se a pessoa
 * tivesse digitado. Na janela do app o `insertText` só funciona com a janela em foco (com o Terminal na frente, não
 * entrava nada); a interface é DOM puro, então isto basta. Devolve false se o alvo não é um campo de valor (área
 * editável): aí quem chamou usa o `insertText`.
 */
export const digitarValorScript = (target: string, texto: string): string => `(() => { const e = ${target}; e.scrollIntoView({ block: "center" }); e.focus(); if (!("value" in e) || typeof e.value !== "string") return false; e.value = ${literalJs(texto)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`;
/**
 * O `executeJavaScript` troca qualquer erro lançado na página por "Script failed to execute…", e a mensagem certa
 * ("comando desconhecido", "nada com o seletor") se perdia. Este invólucro a traz de volta como valor; `valorOuErro`
 * a relança no processo principal.
 */
export const comErro = (script: string): string => `(() => { try { return { v: ${script} }; } catch (e) { return { erro: String((e && e.message) || e) }; } })()`;
export function valorOuErro(r: unknown): unknown {
  const o = (r !== null && typeof r === "object" ? r : {}) as { v?: unknown; erro?: unknown };
  if (typeof o.erro === "string") throw new Error(o.erro);
  return o.v;
}

const TECLAS: Record<string, string> = { enter: "Return", tab: "Tab", esc: "Escape", escape: "Escape", backspace: "Backspace", space: "Space", up: "Up", down: "Down", left: "Left", right: "Right", pagedown: "PageDown", pageup: "PageUp" };
/** O nome da tecla pedido → o keyCode do Electron; recusa o que não conhece. */
export function codigoDaTecla(tecla: unknown): string {
  const k = typeof tecla === "string" ? tecla : "";
  const code = TECLAS[k.toLowerCase()] ?? (k.length === 1 ? k : null);
  if (code === null) throw new Error("tecla: enter, tab, esc, backspace, space, up, down, left, right, pageup, pagedown ou um caractere");
  return code;
}
/** Aperta e solta a tecla (com o `char` no meio para caractere e Enter, que é o que os campos esperam). */
export function apertar(wc: WebContents, code: string): void {
  wc.sendInputEvent({ type: "keyDown", keyCode: code }); if (code.length === 1 || code === "Return") wc.sendInputEvent({ type: "char", keyCode: code }); wc.sendInputEvent({ type: "keyUp", keyCode: code });
}
