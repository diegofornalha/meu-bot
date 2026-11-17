/**
 * Qual produto é este app: meu-bot (de cada pessoa), meu-bot-admin (suporte) ou meu-bot-crm (meu-bot + CRM
 * próprio). Mesmo código; o empacotamento grava Resources/variant.json (`scripts/package.mjs --variant <x>`).
 * Em dev: MEU_BOT_VARIANT=admin|crm|client-staging|crm-staging. A decisão em si é pura (variant-core.ts); aqui só a leitura e o cache.
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { Compilacao } from "../../shared/ipc";
import { capsFor, produtoDe, resolveVariant, titleFor, userDataNameFor, type AppVariant, type Capabilities, type Produto } from "./variant-core";

export type { AppVariant, Capabilities };
let cached: AppVariant | null = null;

function readVariantJson(): unknown {
  try { return JSON.parse(fs.readFileSync(path.join(process.resourcesPath, "variant.json"), "utf8")); } catch { return undefined; }
}

export function appVariant(): AppVariant {
  if (cached !== null) return cached;
  cached = resolveVariant({ packaged: app.isPackaged, env: process.env.MEU_BOT_VARIANT, variantJson: app.isPackaged ? readVariantJson() : undefined });
  return cached;
}

export const appTitle = (): string => titleFor(appVariant());
export const userDataName = (): string | null => userDataNameFor(appVariant());
export const caps = (): Capabilities => capsFor(appVariant(), app.getVersion(), process.platform);
export const produto = (): Produto => produtoDe(appVariant());

/** Commit e branch de onde este build saiu (`scripts/package.mjs` grava Resources/build.json); em dev, "dev". */
let compilacaoCache: Compilacao | null = null;
export function compilacao(): Compilacao {
  if (compilacaoCache !== null) return compilacaoCache;
  let c: Compilacao = app.isPackaged ? { commit: "", branch: "", em: "", origem: "release" } : { commit: "dev", branch: "dev", em: "", origem: "local" };
  if (app.isPackaged) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, "build.json"), "utf8")) as Partial<Compilacao>;
      c = { commit: typeof j.commit === "string" ? j.commit : "", branch: typeof j.branch === "string" ? j.branch : "", em: typeof j.em === "string" ? j.em : "", origem: j.origem === "local" ? "local" : "release" };
    } catch { /* build sem o arquivo (empacotado antes de 31 out): fica vazio; sem `origem` (antes de 10 nov) conta como release */ }
  }
  compilacaoCache = c;
  return c;
}
