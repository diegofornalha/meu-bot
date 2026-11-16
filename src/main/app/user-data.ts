/**
 * Pasta de userData própria por produto. O Electron nomeia a pasta pelo productName do package.json, que é
 * "meu-bot" em todos os apps (o empacotador troca nome, bundle id e ícone, não o package.json), então sem isto
 * o meu-bot-admin ou o meu-bot-crm dividiriam com o meu-bot normal configurações, conversas e a trava de
 * instância única: abrir um com o outro aberto fechava o segundo calado. Tem de rodar antes de qualquer uso
 * do userData e do requestSingleInstanceLock.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { carimboDe, carimboFusao, COPIAR_SE_FALTAR, deveHerdar, entradaHerdavel, settingsHerdados, fundirConversas, fundirGoogleWhatsapp, fundirMemoria, fundirSettings, POR_MAQUINA } from "./user-data-core";

/** `migrate(dir, appData)` roda uma vez depois de apontar o userData (ex.: o admin traz o pessoas.json). */
export function useVariantUserData(name: string, migrate?: (dir: string, appData: string) => void): void {
  const appData = app.getPath("appData");
  const dir = path.join(appData, name);
  app.setName(name);
  // Um --user-data-dir explícito (testes de fumaça ao lado do app instalado) continua valendo.
  if (app.commandLine.hasSwitch("user-data-dir")) return;
  app.setPath("userData", dir);
  if (migrate) migrate(dir, appData);
}

/**
 * Um app da pessoa (meu-bot-crm, um staging, meu-bot-fit…) nasce como cópia do app de origem dela (Produto.herdaDe):
 * tutoriais feitos, conversas, memória, favoritos e espaços de trabalho vêm juntos, em vez de começar do zero. Só na
 * primeira vez (carimbo por origem) e só enquanto o app novo não tem conversas próprias; depois cada app segue
 * sozinho. Caches, logs, o backend local e o que o chaveiro cifra com o nome do app ficam de fora (user-data-core.ts):
 * logins do Google Contatos e, em geral, do Navegador precisam ser refeitos no app novo.
 */
export const herdarDe = (nomeOrigem: string, paginaPropria = false) => (dir: string, appData: string): void => {
  const origem = path.join(appData, nomeOrigem);
  const carimbo = path.join(dir, carimboDe(nomeOrigem));
  if (!fs.existsSync(path.join(origem, "settings.json"))) return;
  let conversas: string | null = null;
  try { conversas = fs.readFileSync(path.join(dir, "conversations.json"), "utf8"); } catch { conversas = null; }
  if (!deveHerdar(fs.existsSync(carimbo), conversas)) return;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let n = 0;
  for (const nome of fs.readdirSync(origem)) {
    if (!entradaHerdavel(nome)) continue;
    const de = path.join(origem, nome); const para = path.join(dir, nome);
    try { fs.rmSync(para, { recursive: true, force: true }); fs.cpSync(de, para, { recursive: true }); n++; }
    catch { /* uma entrada que não copiou não impede as outras */ }
  }
  // Produto com página própria: a aba fixada do app de origem não vale aqui (user-data-core.ts, settingsHerdados).
  if (paginaPropria) { const f = path.join(dir, "settings.json"); try { fs.writeFileSync(f, settingsHerdados(fs.readFileSync(f, "utf8")), { mode: 0o600 }); } catch { /* sem settings herdado */ } }
  fs.writeFileSync(carimbo, `${new Date().toISOString()} ${n} entradas de ${origem}\n`);
};

/** O que a última fusão trouxe (para o aviso único na janela); null = não houve fusão nesta abertura. */
export let relatorioFusao: { origem: string; conversas: number } | null = null;

const gravar = (f: string, texto: string): void => { fs.writeFileSync(`${f}.tmp`, texto, { mode: 0o600 }); fs.renameSync(`${f}.tmp`, f); };
const ler = (f: string): string | null => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };

/**
 * O meu-bot adota a pasta do antigo meu-bot-crm (Produto.fundeDe): união, uma vez só (carimbo), sem apagar nem alterar a
 * origem (ela é o backup). Conversas unem por id; settings, memória e o estado do Google seguem as regras puras de
 * user-data-core.ts; o resto só entra quando falta. O que o chaveiro cifrou com o nome do outro app (Google, Tailscale,
 * cookies) não é legível aqui: a pessoa refaz esses logins uma vez.
 */
export const fundirDe = (nomeOrigem: string) => (dir: string, appData: string): void => {
  const origem = path.join(appData, nomeOrigem);
  if (!fs.existsSync(path.join(origem, "settings.json")) && !fs.existsSync(path.join(origem, "conversations.json"))) return;
  const carimbo = path.join(dir, carimboFusao(nomeOrigem));
  if (fs.existsSync(carimbo)) return;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const feito: string[] = [];
  let conversas = 0;
  try {
    const r = fundirConversas(ler(path.join(dir, "conversations.json")), ler(path.join(origem, "conversations.json")));
    if (r !== null) {
      gravar(path.join(dir, "conversations.json"), r.json); conversas = r.vindas.length;
      fs.mkdirSync(path.join(dir, "transcripts"), { recursive: true, mode: 0o700 });
      for (const id of r.vindas) { const t = path.join(origem, "transcripts", `${id}.json`); if (fs.existsSync(t)) fs.copyFileSync(t, path.join(dir, "transcripts", `${id}.json`)); }
      feito.push(`conversas: ${conversas} trazidas`);
    }
  } catch (e) { feito.push(`conversas: falhou (${e instanceof Error ? e.message : String(e)})`); }
  for (const [nome, fundir] of [["settings.json", fundirSettings], ["memory.json", fundirMemoria], ["google-whatsapp.json", fundirGoogleWhatsapp]] as const) {
    try { const j = fundir(ler(path.join(dir, nome)), ler(path.join(origem, nome))); if (j !== null) { gravar(path.join(dir, nome), j); feito.push(nome); } }
    catch (e) { feito.push(`${nome}: falhou (${e instanceof Error ? e.message : String(e)})`); }
  }
  for (const nome of COPIAR_SE_FALTAR) {
    const de = path.join(origem, nome), para = path.join(dir, nome);
    if (!fs.existsSync(de) || fs.existsSync(para)) continue;
    try { fs.cpSync(de, para, { recursive: true }); feito.push(nome); } catch { /* uma entrada que não copiou não impede as outras */ }
  }
  for (const pasta of POR_MAQUINA) {
    const de = path.join(origem, pasta); if (!fs.existsSync(de)) continue;
    fs.mkdirSync(path.join(dir, pasta), { recursive: true });
    for (const maquina of fs.readdirSync(de)) {
      const para = path.join(dir, pasta, maquina);
      if (fs.existsSync(para)) continue;
      try { fs.cpSync(path.join(de, maquina), para, { recursive: true }); feito.push(`${pasta}/${maquina}`); } catch { /* idem */ }
    }
  }
  fs.writeFileSync(carimbo, `${new Date().toISOString()} de ${origem}\n${feito.join("\n")}\n`);
  relatorioFusao = { origem: nomeOrigem, conversas };
};
