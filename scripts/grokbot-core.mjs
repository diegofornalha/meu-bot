// Vigia do Grok Bot (parte pura): o meu-bot nasceu do Grok Bot e acompanha as versões dele. A cada versão nova do Grok
// Bot instalada neste Mac, o vigia tira uma "impressão" do pacote (nomes de arquivos, textos de tela e opções das
// Configurações), compara com a da versão anterior e escreve o que mudou. Aqui ficam as regras, sem tocar em disco.
// Nada do código do Grok Bot é guardado nem copiado: só nomes, textos visíveis e identificadores, para servir de pauta.

/** "1.2.3" → [1,2,3]; null se não for x.y.z. */
export function lerVersao(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? "").trim());
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}
/** -1, 0 ou 1; versão ilegível conta como a menor. */
export function compararVersao(a, b) {
  const x = lerVersao(a) ?? [-1, -1, -1], y = lerVersao(b) ?? [-1, -1, -1];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/**
 * O número da próxima estável do meu-bot: o do Grok Bot quando ele está à frente da nossa última estável; senão, a
 * nossa última com o patch seguinte (uma correção nossa não espera o Grok Bot, e o número nunca se repete nem anda
 * para trás). Sem a versão do Grok Bot (app não instalado), vale só a segunda regra.
 */
export function proximaEstavel(grokBot, ultimaNossa) {
  const n = lerVersao(ultimaNossa);
  const seguinte = n === null ? null : `${n[0]}.${n[1]}.${n[2] + 1}`;
  if (lerVersao(grokBot) === null) return seguinte;
  if (seguinte === null || compararVersao(grokBot, ultimaNossa) > 0) return String(grokBot).trim();
  return seguinte;
}

/** O nome do arquivo sem o hash do empacotador ("chunk-file-Ab3_x9Zq.js" → "chunk-file.js"): o hash muda a cada build. */
export const semHash = (caminho) => caminho.replace(/-[A-Za-z0-9_-]{8}(\.[a-z0-9]+)$/, "$1");

/** As opções das Configurações registradas no renderer (`"update-status":{label:{id:`…`): os ids, na ordem. */
export function opcoesDe(js) {
  const out = []; const visto = new Set();
  for (const m of js.matchAll(/(?:"([a-z0-9-]+)"|([A-Za-z][A-Za-z0-9]*)):\{label:\{id:`/g)) { const id = m[1] ?? m[2]; if (!visto.has(id)) { visto.add(id); out.push(id); } }
  return out;
}

const PALAVRA_INGLES = /\b(the|your|this|to|is|are|from|with|and|an|of|on|in|for|can|was|not|no|you|it)\b/;
/** Frases de tela em inglês (o catálogo traz dezenas de idiomas; o inglês basta para ver o que entrou e saiu). */
export function textosDe(js) {
  const out = new Set();
  for (const m of js.matchAll(/[`"]([A-Z][a-z]+(?: [A-Za-z0-9’',.&/-]+){2,16}[.?!]?)[`"]/g)) {
    const t = m[1];
    if (/^[\x20-\x7e’]+$/.test(t) && PALAVRA_INGLES.test(t.toLowerCase())) out.add(t);
  }
  return [...out];
}

/** O que há em `depois` e não em `antes`, e o contrário; ordenado. */
export function diferenca(antes, depois) {
  const a = new Set(antes), d = new Set(depois);
  return { novos: [...d].filter((x) => !a.has(x)).sort(), removidos: [...a].filter((x) => !d.has(x)).sort() };
}

/** Temas para agrupar os textos novos no relatório; a primeira regra que casa leva a frase. */
export const TEMAS = [
  ["Mensagens e telefone", /\b(imessage|messages|text(ing|s)?|phone|sms|call)\b/i],
  ["Conectores e login", /\b(connector|connect(ed)?|sso|sign(ed)? in|plugin|oauth|outlook|excel|onedrive|sharepoint|teams|slack)\b/i],
  ["Bots compartilhados", /\b(shared?|sharing|everyone with access|team|admin|owner)\b/i],
  ["Skills e arquivos", /\b(skill|file|sheet|diagram|vault)\b/i],
  ["Compras e pagamento", /\b(purchase|checkout|card|paid|pay|fare|price|billing|trial|plan)\b/i],
  ["Atualização", /\b(update|restart|version)\b/i],
];
export function agrupar(textos) {
  const grupos = new Map(TEMAS.map(([n]) => [n, []])); grupos.set("Outros", []);
  for (const t of textos) grupos.get(TEMAS.find(([, re]) => re.test(t))?.[0] ?? "Outros").push(t);
  return [...grupos].filter(([, l]) => l.length > 0);
}

/**
 * O relatório em Markdown, para virar issue e pauta. `i` = impressões `{ versao, arquivos, textos, opcoes }` das duas
 * versões. Listas longas são cortadas (o arquivo inteiro fica no disco).
 */
export function relatorio(antes, depois, { nossa = null, proxima = null } = {}) {
  const arq = diferenca(antes.arquivos.map(semHash), depois.arquivos.map(semHash));
  const txt = diferenca(antes.textos, depois.textos);
  const opc = diferenca(antes.opcoes, depois.opcoes);
  const lista = (l, n) => (l.length === 0 ? "- (nada)" : [...l.slice(0, n).map((x) => `- ${x}`), ...(l.length > n ? [`- … e mais ${l.length - n}`] : [])].join("\n"));
  const linhas = [
    `# Grok Bot ${depois.versao}: o que mudou desde a ${antes.versao}`,
    "",
    `Comparação automática das duas versões instaladas neste Mac (\`scripts/grokbot-vigia.mjs\`). É pauta, não cópia: só nomes de arquivos, textos de tela em inglês e identificadores.`,
    ...(nossa === null ? [] : ["", `**Numeração:** a última estável do meu-bot é a ${nossa}; pela regra de alinhamento, a próxima sai como **${proxima ?? "?"}**.`]),
    "", "## Configurações", "", `Opções novas (${opc.novos.length}):`, lista(opc.novos, 60), "", `Opções que saíram (${opc.removidos.length}):`, lista(opc.removidos, 60),
    "", `## Textos de tela novos (${txt.novos.length})`,
  ];
  for (const [tema, l] of agrupar(txt.novos)) linhas.push("", `### ${tema} (${l.length})`, lista(l, 40));
  linhas.push("", `## Textos que saíram (${txt.removidos.length})`, "", lista(txt.removidos, 40),
    "", `## Arquivos do pacote`, "", `Novos (${arq.novos.length}):`, lista(arq.novos, 50), "", `Removidos (${arq.removidos.length}):`, lista(arq.removidos, 50),
    "", "## O que fazer com isto", "", "Para cada grupo acima: (1) o meu-bot já tem? (2) faz sentido para quem usa o meu-bot? (3) se sim, abrir uma issue própria, pequena, com o comportamento esperado. Não abrir issue para o que é do produto do Grok Bot (planos, cobrança e marcas deles).", "");
  return linhas.join("\n");
}

/** Há algo a relatar entre as duas impressões? */
export function mudou(antes, depois) {
  const a = diferenca(antes.arquivos.map(semHash), depois.arquivos.map(semHash)), t = diferenca(antes.textos, depois.textos), o = diferenca(antes.opcoes, depois.opcoes);
  return a.novos.length + a.removidos.length + t.novos.length + t.removidos.length + o.novos.length + o.removidos.length > 0;
}
