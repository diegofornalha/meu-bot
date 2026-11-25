/** Modo de depuração, parte pura: o resumo de uma ação por rota, o detalhe sem payload pesado, as sondas agrupadas e a poda do anel. */
export type Corpo = Record<string, unknown>;
const str = (v: unknown, n = 80): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v)).slice(0, n);
const num = (v: unknown): string => (typeof v === "number" ? String(v) : "");
const texto = (v: unknown): number => (typeof v === "string" ? v.length : 0);

/** Uma linha curta que diz o que a ação fez, a partir do pedido e da resposta (ou do erro). */
export function resumoAcao(origem: string, rota: string, corpo: Corpo, resultado: unknown, erro: string | null): string {
  // A linha da faixa já marca o erro com ✗ depois da rota: aqui vai só a mensagem.
  if (erro !== null) return erro.slice(0, 160);
  const r = (resultado ?? {}) as Corpo;
  if (origem === "navegador") {
    switch (rota) {
      case "/abas": return `${Array.isArray(r["abas"]) ? (r["abas"] as unknown[]).length : "?"} aba(s)`;
      case "/abrir": return `${str(corpo["url"], 100)} → aba ${num(r["aba"])}${corpo["nova"] === true ? " (nova)" : ""}`;
      case "/fechar": { const rec = Array.isArray(r["recarregadas"]) ? (r["recarregadas"] as unknown[]) : []; return `fechou a aba ${num(r["fechada"])}${rec.length > 0 ? ` → recarregou [${rec.join(", ")}]` : ""}`; }
      case "/ler": return `aba ${num(r["aba"])}: ${str(r["title"], 60)}${Array.isArray(r["elements"]) ? ` · ${(r["elements"] as unknown[]).length} elementos` : ""}`;
      case "/clicar": return `clicou ${corpo["n"] !== undefined ? `no ${num(corpo["n"])}` : corpo["texto"] !== undefined ? `em "${str(corpo["texto"], 40)}"` : `em ${str(corpo["seletor"], 40)}`}`;
      case "/digitar": return `digitou ${texto(corpo["texto"])} caracteres${corpo["n"] !== undefined ? ` no ${num(corpo["n"])}` : ""}${corpo["enter"] === true ? " + Enter" : ""}`;
      case "/tecla": return `tecla ${str(corpo["tecla"], 20)}`;
      case "/print": return `print da aba ${num(r["aba"]) || "atual"}`;
      case "/js": return `js: ${texto(corpo["codigo"])} caracteres`;
      case "/recarregar": case "/voltar": case "/avancar": return `aba ${num(r["aba"])}: ${str(r["url"], 80)}`;
      default: break;
    }
  }
  if (origem === "gmail") {
    switch (rota) {
      case "/status": return r["conectada"] === true ? `conectada${typeof r["conta"] === "string" ? ` (${r["conta"]})` : ""}` : "sem conta";
      case "/listar": return `${corpo["busca"] !== undefined && corpo["busca"] !== "" ? `busca "${str(corpo["busca"], 40)}"` : "caixa de entrada"} → ${Array.isArray(r["mensagens"]) ? (r["mensagens"] as unknown[]).length : "?"} mensagens`;
      case "/ler": return `leu ${str(corpo["id"], 24)}: ${str(r["assunto"], 60)}`;
      case "/apagar": return `lixeira: ${str(r["assunto"], 60) || str(corpo["id"], 24)}`;
      case "/restaurar": return `restaurou ${str(corpo["id"], 24)}`;
      default: break;
    }
  }
  if (origem === "terminal") {
    switch (rota) {
      case "/terminais": return `${Array.isArray(r["terminais"]) ? (r["terminais"] as unknown[]).length : "?"} terminal(is)`;
      case "/abrir": return `terminal ${num(r["terminal"])} em ${str(r["maquina"], 40)}`;
      case "/ler": return `leu o terminal ${str(corpo["id"], 24)}`;
      case "/digitar": return corpo["tecla"] !== undefined ? `tecla ${str(corpo["tecla"], 20)} no ${str(corpo["id"], 24)}` : `digitou ${texto(corpo["texto"])} caracteres no ${str(corpo["id"], 24)}${corpo["enter"] === true ? " + Enter" : ""}`;
      case "/dividir": return `dividiu: ${str(r["direita"], 40)}`;
      case "/juntar": return "juntou";
      case "/nota": return str(corpo["texto"], 200);
      case "/depuracao": return `modo ${r["ligado"] === true ? "ligado" : "desligado"}`;
      // A interface do app: o texto digitado nunca vai ao log (pode ser uma senha), só o tamanho.
      case "/ui/ler": return `leu a interface${Array.isArray(r["elements"]) ? ` · ${(r["elements"] as unknown[]).length} elementos` : ""}`;
      case "/ui/clicar": return `clicou na interface ${corpo["n"] !== undefined ? `no ${num(corpo["n"])}` : corpo["texto"] !== undefined ? `em "${str(corpo["texto"], 40)}"` : `em ${str(corpo["seletor"], 40)}`}`;
      case "/ui/digitar": return `digitou ${texto(corpo["texto"])} caracteres na interface${corpo["n"] !== undefined ? ` no ${num(corpo["n"])}` : ""}${corpo["enter"] === true ? " + Enter" : ""}`;
      case "/ui/tecla": return `tecla ${str(corpo["tecla"], 20)} na interface`;
      case "/comandos": return `listou os comandos${Array.isArray(r["comandos"]) ? ` · ${(r["comandos"] as unknown[]).length}` : ""}`;
      case "/comando": return `rodou o comando ${str(corpo["id"], 40)}`;
      case "/conversa/enviar": return `mandou ${texto(corpo["texto"])} caracteres na conversa`;
      case "/erros": return `leu os erros da interface${Array.isArray(r["erros"]) ? ` · ${(r["erros"] as unknown[]).length}` : ""}`;
      case "/log": return `leu o log${Array.isArray(r["linhas"]) ? ` · ${(r["linhas"] as unknown[]).length} linha(s)` : ""}${corpo["filtro"] !== undefined ? ` com "${str(corpo["filtro"], 40)}"` : ""}`;
      default: break;
    }
  }
  const chaves = Object.keys(corpo).filter((k) => corpo[k] !== undefined);
  return chaves.length > 0 ? chaves.map((k) => `${k}=${str(corpo[k], 40)}`).join(" ") : "ok";
}
/**
 * O ponto real da ação (o Navegador o devolve no resultado do /clicar e do /digitar), conferido: números finitos, dentro
 * da área visível da página. Qualquer coisa fora disso → null (sem ponto, a janela usa o alvo de sempre).
 */
export function pontoDoResultado(resultado: unknown): { aba: number; x: number; y: number; vw: number; vh: number } | null {
  const p = (resultado !== null && typeof resultado === "object" ? (resultado as Corpo)["ponto"] : null) as Corpo | null | undefined;
  if (p === null || p === undefined || typeof p !== "object") return null;
  const n = (k: string): number | null => (typeof p[k] === "number" && Number.isFinite(p[k]) ? (p[k] as number) : null);
  const aba = n("aba"), x = n("x"), y = n("y"), vw = n("vw"), vh = n("vh");
  if (aba === null || x === null || y === null || vw === null || vh === null || !Number.isInteger(aba) || vw <= 0 || vh <= 0) return null;
  if (x < 0 || y < 0 || x > vw || y > vh) return null;
  return { aba, x: Math.round(x), y: Math.round(y), vw: Math.round(vw), vh: Math.round(vh) };
}
/**
 * A aba do Navegador em que a ação aconteceu (id do webContents): a da resposta (as rotas devolvem `aba`), a do ponto
 * ou das marcas, ou a pedida. Sem nenhuma → null (a janela não sabe qual foi).
 */
export function abaDaAcao(corpo: Corpo, resultado: unknown): number | null {
  const r = (resultado !== null && typeof resultado === "object" ? resultado : {}) as Corpo;
  const de = (v: unknown): unknown => (v !== null && typeof v === "object" ? (v as Corpo)["aba"] : undefined);
  for (const v of [r["aba"], de(r["ponto"]), de(r["marcas"]), corpo["aba"]]) if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  return null;
}
/**
 * As marcas de uma leitura (o Navegador as devolve no resultado do /ler): onde está, na área visível da página, cada
 * elemento numerado. Conferidas como o ponto; item torto ou fora da área sai; no máximo MARCAS_MAX. Sem nenhuma → null.
 */
export const MARCAS_MAX = 60;
export function marcasDoResultado(resultado: unknown): { aba: number; vw: number; vh: number; itens: { n: number; x: number; y: number; rotulo: string }[] } | null {
  const m = (resultado !== null && typeof resultado === "object" ? (resultado as Corpo)["marcas"] : null) as Corpo | null | undefined;
  if (m === null || m === undefined || typeof m !== "object" || !Array.isArray(m["itens"])) return null;
  const fin = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const aba = fin(m["aba"]), vw = fin(m["vw"]), vh = fin(m["vh"]);
  if (aba === null || vw === null || vh === null || !Number.isInteger(aba) || vw <= 0 || vh <= 0) return null;
  const itens: { n: number; x: number; y: number; rotulo: string }[] = [];
  for (const i of m["itens"] as unknown[]) {
    if (itens.length >= MARCAS_MAX) break;
    if (i === null || typeof i !== "object") continue;
    const r = i as Corpo; const n = fin(r["n"]), x = fin(r["x"]), y = fin(r["y"]);
    if (n === null || x === null || y === null || !Number.isInteger(n) || n < 1 || x < 0 || y < 0 || x > vw || y > vh) continue;
    itens.push({ n, x: Math.round(x), y: Math.round(y), rotulo: str(r["rotulo"], 40).replace(/\s+/g, " ").trim() });
  }
  return itens.length === 0 ? null : { aba, vw: Math.round(vw), vh: Math.round(vh), itens };
}
/** O pedido, para o JSON da faixa: textos longos cortados; as rotas que carregam a página inteira ficam sem payload. */
export function detalheSeguro(rota: string, corpo: Corpo): Corpo | null {
  if (rota === "/ler" || rota === "/print") return null;
  const d: Corpo = {};
  for (const [k, v] of Object.entries(corpo)) {
    if (v === undefined) continue;
    d[k] = typeof v === "string" && v.length > 200 ? `${v.slice(0, 200)}… (${v.length} caracteres)` : v;
  }
  return d;
}
/** As sondas (o agente perguntando "que abas há?", a máquina conferindo o /status) viriam a cada poucos segundos: uma por rota a cada 30 s basta. */
export const SONDAS = new Set(["/abas", "/terminais", "/status", "/diag"]);
export function deveEmitirSonda(ultimaEm: number | null, agora: number, intervaloMs = 30_000): boolean {
  return ultimaEm === null || agora - ultimaEm >= intervaloMs;
}
/** Anel: no máximo `max` eventos e nada mais velho que `janelaMs`. Muta e devolve a lista. */
export function podar<T extends { em: number }>(eventos: T[], agora: number, max = 300, janelaMs = 15 * 60_000): T[] {
  const limite = agora - janelaMs;
  while (eventos.length > 0 && (eventos.length > max || (eventos[0]?.em ?? 0) < limite)) eventos.shift();
  return eventos;
}
