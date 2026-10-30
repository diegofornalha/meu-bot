// Client OAuth da Conta Google no empacotamento: config/google-conta-oauth.json fica fora do git (credencial), então
// quem empacota numa máquina sem o arquivo gerava um app sem Google em silêncio. Aqui só a decisão (testável);
// quem imprime e sai é o package.mjs.

/**
 * O que fazer com um build: "ok" (tem o arquivo, ou é admin, que não leva Google), "aviso" (sai sem Google,
 * barulhento), "falha" (release sem o arquivo) ou "permitido" (`--sem-google`, de propósito).
 * `release` é o build com `--versao` (o que vai para os usuários).
 */
export function decideGoogleConta({ admin, existe, semGoogle, release }) {
  if (admin || existe) return "ok";
  if (semGoogle) return "permitido";
  return release ? "falha" : "aviso";
}

export const avisoSemGoogle = (nome) => [
  "",
  "!".repeat(72),
  `! ${nome} vai ficar SEM Conta Google: falta config/google-conta-oauth.json`,
  "! Sem ele não há login Google, Gmail, Agenda, planilhas nem backup no Drive.",
  "! Onde conseguir o arquivo: docs/guia/google.md (\"Client OAuth da Conta Google\").",
  "! Para empacotar sem Google de propósito: --sem-google",
  "!".repeat(72),
  "",
].join("\n");
