// Paridade de configuração: o staging só prova a produção se os dois ambientes do wrangler.toml forem iguais em tudo
// o que não é, por natureza, de cada um. O que pode diferir está escrito aqui, com o motivo; o resto tem de ser igual.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { varsDoWrangler } from "../../scripts/release-core.mjs";

/** Chaves que diferem por natureza entre os ambientes, e por quê. Qualquer outra tem de ter o mesmo valor nos dois. */
const DIFERENTES = {
  CANAL: "é o nome do ambiente (producao | staging)",
  API_ORIGIN: "endereço da API de cada ambiente (conta. | conta-staging.)",
  AUTH_ORIGIN: "endereço da página de login de cada ambiente (auth. | auth-staging.)",
  CONSOLE_ORIGIN: "endereço do console de cada ambiente (console. | console-staging.)",
  SITE_ORIGIN: "endereço do site de cada ambiente (agentesgrok.com | site-staging.)",
  FIREBASE_AUTH_DOMAIN: "o handler do Firebase é servido no host de login de cada ambiente",
  GA_ID: "medição: uma propriedade do Google Analytics por ambiente, para o staging não sujar os números da produção",
  ABACATEPAY_PRODUTO: "produto do Pro: a loja de produção e o Modo Teste da AbacatePay têm ids próprios",
};
/** ABACATEPAY_ADDONS é JSON: os nomes dos add-ons e estes campos têm de ser iguais; só `produto` (id da AbacatePay) difere. */
const ADDONS = "ABACATEPAY_ADDONS";
const CAMPOS_IGUAIS_DO_ADDON = ["centavos", "rotulo"];

/**
 * Diferenças aceitas por um tempo, com validade: até `ate` (AAAA-MM-DD, inclusive) o teste aceita; depois FALHA e a
 * mensagem diz o que decidir. `addon` = add-on que existe só no ambiente `so`; `chave` = var preenchida só no
 * ambiente `so` (no outro, vazia). Cada uma só vale na forma descrita: outra diferença na mesma chave reprova.
 */
const TEMPORARIAS = [
  { addon: "meu-bot-diego", so: "staging", ate: "2026-12-15", motivo: "o produto de produção dos Módulos do Diego ainda não foi criado na AbacatePay", decidir: "crie o produto de produção e ponha o add-on em [vars], tire-o do staging, ou renove a validade aqui com o motivo" },
  { chave: "PROMO_CUPOM", so: "staging", ate: "2026-12-15", motivo: "a promoção do primeiro mês fica desligada (vazia) em produção até o dono ligar, depois do teste no staging", decidir: "ligue a promoção em produção (mesmo cupom em [vars]), desligue no staging, ou renove a validade aqui com o motivo" },
];

const OUTRO = { staging: "producao", producao: "staging" };
const vencida = (t, hoje) => hoje > t.ate;
const textoDaVencida = (t, oQue) => `${oQue}: a exceção temporária venceu em ${t.ate} (${t.motivo}). Decida: ${t.decidir}`;
const lerAddons = (bruto, ambiente, erros) => {
  if (bruto === undefined) return {};
  try { const o = JSON.parse(bruto); if (o !== null && typeof o === "object" && !Array.isArray(o)) return o; } catch { /* cai no erro */ }
  erros.push(`${ADDONS} de ${ambiente} não é um objeto JSON`);
  return {};
};

/** As diferenças entre os ambientes que ninguém justificou (lista vazia = paridade). `hoje` = "AAAA-MM-DD". */
function divergencias(vars, hoje) {
  const erros = [];
  const { producao, staging } = vars;
  const tempDaChave = (k) => TEMPORARIAS.find((t) => t.chave === k) ?? null;
  for (const k of new Set([...Object.keys(producao), ...Object.keys(staging)])) {
    const p = producao[k], s = staging[k];
    if (p === undefined || s === undefined) { erros.push(`${k} só existe em ${p === undefined ? "staging" : "produção"}: os dois ambientes declaram as mesmas chaves`); continue; }
    if (k === ADDONS || k in DIFERENTES || p === s) continue;
    const t = tempDaChave(k);
    const naForma = t !== null && vars[t.so][k] !== "" && vars[OUTRO[t.so]][k] === "";
    if (naForma && !vencida(t, hoje)) continue;
    erros.push(naForma ? textoDaVencida(t, `${k} preenchida só em ${t.so}`) : `${k} difere: produção "${p}", staging "${s}". Iguale, ou diga o motivo em DIFERENTES (ou em TEMPORARIAS, com validade)`);
  }
  const ap = lerAddons(producao[ADDONS], "produção", erros), as = lerAddons(staging[ADDONS], "staging", erros);
  for (const nome of new Set([...Object.keys(ap), ...Object.keys(as)])) {
    const so = ap[nome] === undefined ? "staging" : as[nome] === undefined ? "producao" : null;
    if (so !== null) {
      const t = TEMPORARIAS.find((x) => x.addon === nome && x.so === so) ?? null;
      if (t === null) erros.push(`add-on ${nome} só existe em ${so}: os dois ambientes vendem os mesmos add-ons`);
      else if (vencida(t, hoje)) erros.push(textoDaVencida(t, `add-on ${nome} só em ${so}`));
      continue;
    }
    for (const campo of CAMPOS_IGUAIS_DO_ADDON) if (ap[nome][campo] !== as[nome][campo]) erros.push(`add-on ${nome}: ${campo} difere (produção ${JSON.stringify(ap[nome][campo])}, staging ${JSON.stringify(as[nome][campo])}); só o produto pode diferir`);
    for (const campo of new Set([...Object.keys(ap[nome]), ...Object.keys(as[nome])])) if (campo !== "produto" && !CAMPOS_IGUAIS_DO_ADDON.includes(campo) && JSON.stringify(ap[nome][campo]) !== JSON.stringify(as[nome][campo])) erros.push(`add-on ${nome}: ${campo} difere entre os ambientes; só o produto pode diferir`);
  }
  return erros;
}

const TOML = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const hojeEmSaoPaulo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
/** O toml de verdade com uma var de um ambiente trocada (ou acrescentada): para provar que o teste pega a divergência. */
const com = (ambiente, chave, valor) => { const v = varsDoWrangler(TOML); return { ...v, [ambiente]: { ...v[ambiente], [chave]: valor } }; };
const sem = (ambiente, chave) => { const v = varsDoWrangler(TOML); const { [chave]: _, ...resto } = v[ambiente]; return { ...v, [ambiente]: resto }; };

test("paridade: produção e staging do wrangler.toml só diferem no que está justificado", () => {
  const vars = varsDoWrangler(TOML);
  assert.ok(Object.keys(vars.producao).length >= 10 && Object.keys(vars.staging).length >= 10, "li as vars dos dois ambientes");
  assert.deepEqual(divergencias(vars, hojeEmSaoPaulo()), []);
});

test("paridade: as chaves de DIFERENTES diferem mesmo (uma que ficou igual não precisa mais estar na lista)", () => {
  const vars = varsDoWrangler(TOML);
  for (const k of Object.keys(DIFERENTES)) assert.notEqual(vars.producao[k], vars.staging[k], `${k} está igual nos dois ambientes: tire-a de DIFERENTES`);
});

test("paridade: valor diferente, chave num ambiente só e add-on desigual reprovam", () => {
  const dia = "2026-11-18";
  assert.match(divergencias(com("staging", "TRIAL_DIAS", "14"), dia).join("\n"), /TRIAL_DIAS difere: produção "3", staging "14"/);
  assert.match(divergencias(com("producao", "ABACATEPAY_PRECO_CENTAVOS", "100"), dia).join("\n"), /ABACATEPAY_PRECO_CENTAVOS difere/);
  assert.match(divergencias(com("staging", "NOVA", "x"), dia).join("\n"), /NOVA só existe em staging/);
  assert.match(divergencias(sem("staging", "ABACATEPAY_METODOS"), dia).join("\n"), /ABACATEPAY_METODOS só existe em produção/);
  assert.deepEqual(divergencias(com("staging", "GA_ID", "G-OUTRA00000"), dia), [], "medição pode diferir");
  const addons = (o) => com("staging", ADDONS, JSON.stringify(o));
  const finance = JSON.parse(varsDoWrangler(TOML).staging[ADDONS])["meu-bot-finance"];
  assert.match(divergencias(addons({ "meu-bot-finance": { ...finance, centavos: 100 } }), dia).join("\n"), /meu-bot-finance: centavos difere/);
  assert.match(divergencias(addons({ "meu-bot-finance": { ...finance, rotulo: "Outro" } }), dia).join("\n"), /meu-bot-finance: rotulo difere/);
  assert.deepEqual(divergencias(addons({ "meu-bot-finance": { ...finance, produto: "prod_qualquer" } }), dia), [], "o id do produto pode diferir");
  assert.match(divergencias(addons({ "meu-bot-finance": finance, "meu-bot-novo": finance }), dia).join("\n"), /add-on meu-bot-novo só existe em staging/);
  assert.match(divergencias(addons({}), dia).join("\n"), /add-on meu-bot-finance só existe em producao/);
  assert.match(divergencias(com("staging", ADDONS, "lixo"), dia).join("\n"), /não é um objeto JSON/);
});

test("paridade: exceção temporária vale até a data e falha depois, dizendo o que decidir", () => {
  const vars = varsDoWrangler(TOML);
  assert.deepEqual(divergencias(vars, "2026-12-15"), [], "o último dia ainda vale");
  const depois = divergencias(vars, "2026-12-16").join("\n");
  assert.match(depois, /add-on meu-bot-diego só em staging: a exceção temporária venceu em 2026-12-15/);
  assert.match(depois, /Decida: crie o produto de produção/);
  assert.match(depois, /PROMO_CUPOM preenchida só em staging: a exceção temporária venceu em 2026-12-15/);
});

test("paridade: PROMO_CUPOM só vale preenchido no staging e vazio em produção, até a data", () => {
  // Montado à parte do valor de hoje no toml: a regra vale com a promoção ligada, desligada ou a chave ainda ausente.
  const promo = (p, s) => { const v = varsDoWrangler(TOML); const por = (amb, x) => { const { PROMO_CUPOM: _, ...resto } = v[amb]; return x === undefined ? resto : { ...resto, PROMO_CUPOM: x }; }; return { producao: por("producao", p), staging: por("staging", s) }; };
  const erros = (v, dia) => divergencias(v, dia).filter((e) => e.includes("PROMO_CUPOM"));
  assert.deepEqual(erros(promo("", "PRIMEIROMES1"), "2026-11-18"), []);
  assert.deepEqual(erros(promo(undefined, undefined), "2027-01-01"), [], "chave que não existe não é exceção nem erro");
  assert.deepEqual(erros(promo("PRIMEIROMES1", "PRIMEIROMES1"), "2027-01-01"), [], "ligada igual nos dois: não é mais exceção");
  assert.match(erros(promo("", "PRIMEIROMES1"), "2026-12-16")[0], /venceu em 2026-12-15.*Decida: ligue a promoção em produção/);
  assert.match(erros(promo("PRIMEIROMES1", ""), "2026-11-18")[0], /PROMO_CUPOM difere/, "o contrário (só produção) não é a exceção combinada");
  assert.match(erros(promo("OUTRO", "PRIMEIROMES1"), "2026-11-18")[0], /PROMO_CUPOM difere/);
  assert.match(erros(promo(undefined, "PRIMEIROMES1"), "2026-11-18")[0], /PROMO_CUPOM só existe em staging/, "a chave tem de estar declarada nos dois");
});
