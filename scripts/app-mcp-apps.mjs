// Onde ficam os apps meu-bot instalados neste Mac, para as ferramentas `apps` e `app_abrir` do app-mcp.mjs.
// O build local (hook de rebuild, `npm run dist…`) vai para ~/Applications; o app vindo da release (instalador .dmg,
// atualizador) fica em /Applications. Antes só a primeira pasta era olhada: o meu-bot e o meu-bot-staging das pessoas
// não apareciam em `apps`, e o `app_abrir` respondia "não existe" (achado com o MCP Inspector em 15 nov 2026).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Pastas de apps, na ordem de preferência: a da conta primeiro (como o release-saude.mjs), depois a do Mac. */
export const pastasDeApps = (home = os.homedir()) => [path.join(home, 'Applications'), '/Applications'];

const listar = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };

/** Nomes dos apps meu-bot instalados (sem o .app), sem repetir, em ordem alfabética. */
export function appsInstalados(pastas = pastasDeApps(), ler = listar) {
  const nomes = new Set();
  for (const dir of pastas) for (const f of ler(dir)) if (/^meu-bot[\w-]*\.app$/.test(f)) nomes.add(f.slice(0, -4));
  return [...nomes].sort();
}

/** Caminho do .app de `app` na primeira pasta que o tem; null = não está instalado em nenhuma. */
export function bundleDoApp(app, pastas = pastasDeApps(), existe = fs.existsSync) {
  return pastas.map((dir) => path.join(dir, `${app}.app`)).find((b) => existe(b)) ?? null;
}
