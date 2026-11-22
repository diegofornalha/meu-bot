// Confere o relatório do modo de fumaça do app (MEU_BOT_FUMACA, src/main/app/fumaca-core.ts): versão esperada,
// plataforma, janela carregada, nenhum erro, e as capacidades iguais ao que capsFor(variante, versão, plataforma)
// promete. É o contrato do Windows: religar uma capacidade muda a tabela (variant-core.ts) e a prova no mesmo PR;
// capacidade ligada sem prova não passa. Sai 1 com uma frase por coisa que não bateu.
//   node scripts/fumaca-conferir.mjs <relatorio.json> --versao 1.3.0 --plataforma win32 [--variante client-staging]
//        [--dist <pasta dist do código que gerou o app>]   (padrão: o dist/ deste checkout; rode `npm run build:main`)
//        [--wsl]   (a fumaça rodou com MEU_BOT_FUMACA_WSL=1: o "Preparar este Windows" tem de ter chegado a "pronto")
// Com GITHUB_STEP_SUMMARY no ambiente (workflow "Windows"), escreve lá o resumo legível.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const mostra = (v) => (v === undefined ? "(ausente)" : JSON.stringify(v));

/**
 * Frases do que não bateu (vazio = passou). `esperado`: { versao, plataforma, variante?, wsl? } e `capsFor`, a função
 * do código que gerou o app. Pura: o teste chama com relatórios montados à mão.
 */
export function conferirFumaca(relatorio, esperado, capsFor) {
  const p = [];
  if (relatorio === null || typeof relatorio !== "object") return ["o relatório não é um objeto JSON"];
  const r = relatorio;
  if (r.versao !== esperado.versao) p.push(`versão: o app diz ${mostra(r.versao)}, esperava "${esperado.versao}"`);
  if (r.plataforma !== esperado.plataforma) p.push(`plataforma: o app diz ${mostra(r.plataforma)}, esperava "${esperado.plataforma}"`);
  if (esperado.variante !== undefined && r.variante !== esperado.variante) p.push(`variante: o app diz ${mostra(r.variante)}, esperava "${esperado.variante}"`);
  if (r.empacotado !== true) p.push("o relatório não veio de um app empacotado");
  if (r.janela?.carregou !== true) p.push(`a janela não carregou${r.janela?.arquivo ? ` (${r.janela.arquivo})` : ""}`);
  const erros = Array.isArray(r.erros) ? r.erros : ["o relatório não traz a lista de erros"];
  for (const e of erros) p.push(`erro no app: ${String(e).split("\n")[0]}`);
  // "Este Windows" (MEU_BOT_FUMACA_WSL): o app só conta como provado se o preparo chegou ao fim e o alias respondeu.
  if (esperado.wsl === true) {
    if (r.wsl === null || typeof r.wsl !== "object") p.push("o relatório não traz o preparo do este Windows (a fumaça rodou sem MEU_BOT_FUMACA_WSL=1, ou o app é anterior a ele)");
    else if (r.wsl.ok !== true || r.wsl.estado !== "pronto") p.push(`este Windows: o preparo parou em ${mostra(r.wsl.estado)}${r.wsl.erro ? `: ${r.wsl.erro}` : ""}`);
  }
  if (r.ok !== true && p.length === 0) p.push("o app marcou a fumaça como falha (ok: false)");
  // O contrato das capacidades: o que o app calculou × o que a tabela promete para esta variante, versão e plataforma.
  let prometido = null;
  try { prometido = capsFor(r.variante, r.versao, r.plataforma); } catch (e) { p.push(`capsFor não conhece a variante ${mostra(r.variante)}: ${e instanceof Error ? e.message : String(e)}`); }
  if (prometido !== null) {
    const doApp = r.caps !== null && typeof r.caps === "object" ? r.caps : {};
    for (const k of [...new Set([...Object.keys(prometido), ...Object.keys(doApp)])].sort()) {
      if (!igual(doApp[k], prometido[k])) p.push(`capacidade "${k}": o app diz ${mostra(doApp[k])}, o contrato (capsFor) diz ${mostra(prometido[k])}`);
    }
  }
  return p;
}

/** Resumo em Markdown para o GITHUB_STEP_SUMMARY: o que o app disse de si e o que não bateu. */
export function resumoDaFumaca(relatorio, problemas, capsDePlataforma = []) {
  const r = relatorio ?? {};
  const caps = r.caps ?? {};
  const l = [`### Fumaça do app: ${problemas.length === 0 ? "passou" : "FALHOU"}`, ""];
  l.push("| | |", "|---|---|");
  l.push(`| Versão | \`${r.versao ?? "?"}\` |`, `| Plataforma | \`${r.plataforma ?? "?"}\` (${r.arch ?? "?"}) |`, `| Variante | \`${r.variante ?? "?"}\` (${caps.nome ?? "?"}) |`);
  l.push(`| Janela | ${r.janela?.carregou === true ? "carregou" : "NÃO carregou"}: \`${r.janela?.arquivo ?? ""}\`, título "${r.janela?.titulo ?? ""}" |`);
  l.push(`| Tempo até o relatório | ${typeof r.duracaoMs === "number" ? `${(r.duracaoMs / 1000).toFixed(1)} s` : "?"} |`);
  if (capsDePlataforma.length > 0) {
    const liga = capsDePlataforma.filter((k) => caps[k] === true); const desl = capsDePlataforma.filter((k) => caps[k] !== true);
    l.push(`| Capacidades de plataforma ligadas | ${liga.length > 0 ? liga.map((k) => `\`${k}\``).join(", ") : "nenhuma"} |`);
    l.push(`| Capacidades de plataforma desligadas | ${desl.length > 0 ? desl.map((k) => `\`${k}\``).join(", ") : "nenhuma"} |`);
  }
  if (r.wsl !== undefined && r.wsl !== null && typeof r.wsl === "object") {
    l.push(`| Este Windows | ${r.wsl.ok === true ? "pronto" : `parou em \`${r.wsl.estado ?? "?"}\``}: alias \`${r.wsl.alias ?? "?"}\`, ${typeof r.wsl.ms === "number" ? `${Math.round(r.wsl.ms / 1000)} s` : "?"} |`);
  }
  if (problemas.length > 0) l.push("", "**O que não bateu:**", "", ...problemas.map((x) => `- ${x}`));
  if (r.wsl !== undefined && r.wsl !== null && Array.isArray(r.wsl.log) && r.wsl.log.length > 0) l.push("", "<details><summary>Progresso do preparo do este Windows</summary>", "", "```", ...r.wsl.log.map((x) => String(x)), "```", "", "</details>");
  const avisos = Array.isArray(r.avisos) ? r.avisos : [];
  if (avisos.length > 0) l.push("", "<details><summary>Erros do console das páginas (não reprovam)</summary>", "", ...avisos.map((a) => `- \`${String(a).split("\n")[0]}\``), "", "</details>");
  return `${l.join("\n")}\n`;
}

if (import.meta.filename === resolve(process.argv[1] ?? "")) {
  const arg = (nome) => { const i = process.argv.indexOf(nome); return i >= 0 ? process.argv[i + 1] : undefined; };
  const arquivo = process.argv[2];
  const versao = arg("--versao"); const plataforma = arg("--plataforma");
  if (arquivo === undefined || arquivo.startsWith("--") || versao === undefined || plataforma === undefined) {
    console.error("uso: node scripts/fumaca-conferir.mjs <relatorio.json> --versao <x> --plataforma <win32|darwin> [--variante <id>] [--dist <pasta>]");
    process.exit(64);
  }
  const nucleo = join(resolve(arg("--dist") ?? join(import.meta.dirname, "..", "dist")), "main", "app", "variant-core.js");
  if (!existsSync(nucleo)) { console.error(`✗ falta ${nucleo}: rode \`npm run build:main\` antes`); process.exit(1); }
  const { capsFor, CAPS_DE_PLATAFORMA, CAPS_SO_WINDOWS = [] } = createRequire(import.meta.url)(nucleo);
  let relatorio = null; let problemas;
  if (!existsSync(arquivo)) problemas = [`o app não gravou o relatório em ${arquivo} (não abriu, travou antes do prazo ou é anterior ao modo de fumaça)`];
  else {
    try { relatorio = JSON.parse(readFileSync(arquivo, "utf8")); problemas = conferirFumaca(relatorio, { versao, plataforma, variante: arg("--variante"), wsl: process.argv.includes("--wsl") }, capsFor); }
    catch (e) { problemas = [`o relatório em ${arquivo} não é JSON: ${e instanceof Error ? e.message : String(e)}`]; }
  }
  const resumo = resumoDaFumaca(relatorio, problemas, [...CAPS_DE_PLATAFORMA, ...CAPS_SO_WINDOWS]);
  if (process.env.GITHUB_STEP_SUMMARY) { try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${resumo}\n`); } catch { /* o resumo é cortesia */ } }
  console.log(resumo);
  if (problemas.length > 0) { for (const x of problemas) console.error(`✗ ${x}`); process.exit(1); }
  console.log(`✓ fumaça ok: ${relatorio.caps?.nome ?? relatorio.variante} ${relatorio.versao} em ${relatorio.plataforma}, janela ${relatorio.janela.arquivo} carregada, capacidades no contrato`);
}
