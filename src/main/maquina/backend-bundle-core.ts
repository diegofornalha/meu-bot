/**
 * O que vai para a máquina da pessoa, por componente (parte pura): os arquivos que cada instalador copia de
 * backend-colima/ e onde mora a versão de cada um. O hostProbe.ts instala com estas listas; o release
 * (scripts/release.mjs) as usa para recusar publicar um componente que mudou sem subir a versão, senão as
 * máquinas nunca recebem a mudança (o seletor só atualiza para cima).
 */

/**
 * O que precisa estar ao lado do server.js na pasta do backend (os `require('./x')` dele e dos módulos que ele puxa,
 * mais o que ele abre por __dirname). Esta é a ÚNICA lista: o install.sh não tem a sua (copia tudo que chegou no stage,
 * depois de conferir os requires), o backend local deste Mac copia daqui (localBackend.ts) e o teste
 * backend-bundle.test.mjs prova que ela cobre o fecho dos requires. Em 1/11 as três listas de antes desviaram
 * (gmail.js e pontes.js só no install.sh): o scp mandou o pacote sem eles, o cp copiou o server.js novo e parou no que
 * faltava, e as quatro VMs caíram em MODULE_NOT_FOUND no reinício seguinte.
 */
export const BACKEND_RUNTIME_FILES = [
  "server.js", "session-map.js", "nivel-ferramentas.js", "modulos.js", "providers.js", "providers.json", "account-status.js", "contas-claude.js", "tool-events.js", "navegador.js", "gmail.js", "pontes.js", "licenca.js", "crm-modelo.js", "crm-store.js", "crm-api.js", "finance-modelo.js", "finance-store.js", "finance-api.js", "finance-crm-sync.js", "crm-finance-vendas.js", "autenticador.js", "saude-maquina.js", "cota.js", "faxina.js", "auditoria.py",
  // Porteiro do claude (rodízio de contas para o OpenClaw/WhatsApp e o Terminal): mora na pasta do backend e puxa contas-claude.js.
  "claude-porteiro.js",
];
/** O resto do pacote: instalador, unidade, versão e os scripts que o install.sh encadeia no fim (VERSION ele grava por último). */
export const BUNDLE_EXTRAS = [
  "fala-texto.py", "meu-bot-backend.service", "install.sh", "VERSION",
  "statusline.sh", "install-statusline.sh", "uninstall-statusline.sh",
  "claude-porteiro.sh", "install-porteiro.sh", "uninstall-porteiro.sh",
  // wa-enviar: o agente da máquina manda mensagem no WhatsApp do Hermes registrando na conversa (install-porteiro.sh o grava em bin/ e põe a regra no CLAUDE.md).
  "wa-enviar",
];
/** Tudo que o hostProbe.ts manda por scp para o stage da máquina antes de rodar o install.sh. */
export const BUNDLE_FILES = [...BACKEND_RUNTIME_FILES, ...BUNDLE_EXTRAS];

/**
 * Os arquivos locais que um fonte do backend exige: `require('./x')`, `require("./x")`,
 * `require(path.join(__dirname, 'x.js'))` e `path.join(__dirname, 'x.py')` (o auditoria.py do server.js).
 * Devolve nomes de arquivo (`x.js`, `x.py`), sem repetição, na ordem em que aparecem.
 */
export function requiresLocais(src: string): string[] {
  const achados: string[] = [];
  const add = (nome: string): void => { if (!achados.includes(nome)) achados.push(nome); };
  for (const m of src.matchAll(/require\(\s*['"]\.\/([A-Za-z0-9_-]+)(\.js)?['"]\s*\)/g)) add(`${m[1]}.js`);
  for (const m of src.matchAll(/path\.join\(\s*__dirname\s*,\s*['"]([A-Za-z0-9_-]+\.(?:js|py))['"]\s*\)/g)) add(m[1]!);
  return achados;
}
/** Fecho transitivo dos requires a partir das entradas; `ler` devolve o fonte de um `.js` (null se não existe). */
export function fechoDeRequires(entradas: readonly string[], ler: (nome: string) => string | null): string[] {
  const vistos: string[] = [];
  const fila = [...entradas];
  while (fila.length > 0) {
    const nome = fila.shift()!;
    if (vistos.includes(nome)) continue;
    vistos.push(nome);
    if (!nome.endsWith(".js")) continue;
    const src = ler(nome);
    if (src !== null) for (const dep of requiresLocais(src)) if (!vistos.includes(dep)) fila.push(dep);
  }
  return vistos;
}
/** As últimas `n` linhas úteis do instalador numa frase, para o log dizer o erro de verdade (não só "código 1"). */
export function resumoDoInstalador(linhas: readonly string[], n = 5): string {
  const uteis = linhas.map((l) => l.trim()).filter((l) => l !== "");
  return uteis.length === 0 ? "?" : uteis.slice(-n).join(" | ");
}
/** Claude Code Global: o intermediário do root, o que ele lê e o instalador (rodado como root pelo admin). */
export const CLAUDE_GLOBAL_FILES = ["claude-global.js", "contas-claude.js", "account-status.js", "install-claude-global.sh"];
/** Guarda do WhatsApp: o plugin (pasta guarda/) e os dois scripts. */
export const GUARDA_FILES = ["install-guarda.sh", "uninstall-guarda.sh"];
export const GUARDA_PLUGIN_FILES = ["index.js", "regras.mjs", "memoria.mjs", "package.json", "openclaw.plugin.json", "vigia-gateway.sh"];
/** Tela do bot (painel Computador): o instalador e a pasta tela/. Instalada sob pedido pelo painel, sem atualização automática. */
export const TELA_FILES = ["install-tela.sh"];
export const TELA_PLUGIN_FILES = ["tela.sh", "tela-agente.sh"];
export const TELA_SKILL_FILES = ["SKILL.md"];
export const CRM_FILES = ["install-crm.sh", "uninstall-crm.sh", "skill-streak-crm-api.md", "skill-crm-api.md"];
export const CRM_PLUGIN_FILES = ["index.js", "regras.mjs", "licenca-crm.mjs", "crm-job.mjs", "backend.mjs", "crm.mjs", "streak.mjs", "importar-streak.mjs", "package.json", "openclaw.plugin.json"];
export const FINANCE_FILES = ["install-finance.sh", "skill-finance-api.md"];
export const FINANCE_PLUGIN_FILES = ["index.js", "regras.mjs", "backend.mjs", "finance.mjs", "package.json", "openclaw.plugin.json"];
/** Plugin de pausa por contato do Hermes (hermes-plugins/meu-bot-pausa/): vai inline por SSH, a versão é a do plugin.yaml. */
export const HERMES_PAUSA_FILES = ["__init__.py", "plugin.yaml"];

export interface ComponenteVersionado {
  nome: string;
  /** Caminhos no repositório que, se mudarem, exigem subir a versão. */
  arquivos: string[];
  /** Arquivo da versão: VERSION (texto), package.json (campo version) ou plugin.yaml (linha version). */
  versao: string;
}
const B = (f: string): string => `backend-colima/${f}`;
/** Os componentes que o seletor atualiza sozinho nas máquinas (picker.ts › ensure*), cada um com a sua versão. */
export const COMPONENTES: readonly ComponenteVersionado[] = [
  { nome: "backend", arquivos: BUNDLE_FILES.filter((f) => f !== "VERSION").map(B), versao: B("VERSION") },
  { nome: "financeiro", arquivos: [...FINANCE_FILES.map(B), ...FINANCE_PLUGIN_FILES.map((f) => B(`finance/${f}`))], versao: B("finance/package.json") },
  { nome: "crm", arquivos: [...CRM_FILES.map(B), ...CRM_PLUGIN_FILES.map((f) => B(`crm/${f}`))], versao: B("crm/package.json") },
  { nome: "guarda", arquivos: [...GUARDA_FILES.map(B), ...GUARDA_PLUGIN_FILES.map((f) => B(`guarda/${f}`))], versao: B("guarda/package.json") },
  { nome: "hermes-pausa", arquivos: HERMES_PAUSA_FILES.map((f) => B(`hermes-plugins/meu-bot-pausa/${f}`)), versao: B("hermes-plugins/meu-bot-pausa/plugin.yaml") },
];
