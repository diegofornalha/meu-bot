import { assinar } from "./assinatura.mjs";
import { flipFuses, FuseVersion, FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";

import { empacotado, exigeWindows, plataformaFromArgv, produtoFromArgv } from "./produtos.mjs";

// `--variant <id>` / `--admin`: qual produto (ver scripts/package.mjs e src/main/app/variant-core.ts).
const produto = produtoFromArgv();
const name = produto.nome;
const bundleId = produto.bundleId;
// `--plataforma win32`: os mesmos fuses no .exe; sem assinatura (o Authenticode é de outra etapa) e sem instalar.
const plataforma = plataformaFromArgv();
exigeWindows(produto, plataforma);
const win = plataforma === "win32";
const { app, recursos } = empacotado(produto, plataforma);
if (!existsSync(app)) {
  console.error(`App não encontrado em ${app}. Rode npm run package primeiro.`);
  process.exit(1);
}
// Pacote de suporte (build/suporte, de scripts/suporte-setup.mjs) no meu-bot instalado: só no meu-bot normal e no
// meu-bot-staging (licença "meu-bot"), com MEU_BOT_SUPORTE=1 (o ./instalar.sh liga quando build/suporte existe).
// Antes da assinatura.
if (produto.licenca === "meu-bot" && produto.caps.supportClient && process.env.MEU_BOT_SUPORTE === "1" && existsSync("build/suporte/suporte.json")) {
  const cfg = path.join(recursos, "config");
  copyFileSync("build/suporte/suporte.json", path.join(cfg, "suporte.json"));
  copyFileSync("build/suporte/known_hosts", path.join(cfg, "suporte-known_hosts"));
  copyFileSync("build/suporte/entrega", path.join(cfg, "suporte-entrega"));
  chmodSync(path.join(cfg, "suporte-entrega"), 0o600);
  console.log("Pacote de suporte incluído");
}
await flipFuses(app, {
  version: FuseVersion.V1,
  resetAdHocDarwinSignature: !win,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
});
const wire = await getCurrentFuseWire(app);
const names = Object.fromEntries(Object.entries(FuseV1Options).map(([name, index]) => [String(index), name]));
console.log("Fuses gravados:");
for (const [index, value] of Object.entries(wire)) {
  if (index === "version") continue;
  console.log(`  ${(names[index] ?? index).padEnd(40)} ${value === 49 ? "enabled" : value === 48 ? "disabled" : "removed"}`);
}
// Developer ID (hardened runtime, scripts/assinatura.mjs) quando está no chaveiro; senão a identidade fixa
// "meu-bot local" (o chaveiro não pede a senha a cada build); senão ad-hoc.
if (win) process.exit(0);
const ident = await assinar(app);
console.log(ident === "-" ? "Assinatura ad-hoc aplicada em" : `Assinado com "${ident}":`, app);

// Instala em ~/Applications e garante o atalho na área de trabalho. `--no-install` (scripts/release.mjs) para aqui:
// só empacota e assina, sem tocar nos apps instalados neste Mac.
import { rmSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
if (process.argv.includes("--no-install")) process.exit(0);
const installed = path.join(homedir(), "Applications", `${name}.app`);
mkdirSync(path.dirname(installed), { recursive: true });
rmSync(installed, { recursive: true, force: true });
// ditto preserva symlinks dos frameworks, atributos e a assinatura; cpSync quebrava os helpers.
execFileSync("ditto", [app, installed]);
console.log("Instalado em", installed);
// Cópia do app na área de trabalho: o "botão". Só substitui um bundle nosso (mesmo bundle id); nunca toca em outra coisa.
const desktopApp = path.join(homedir(), "Desktop", `${name}.app`);
const plist = path.join(desktopApp, "Contents", "Info.plist");
if (existsSync(desktopApp)) {
  const id = existsSync(plist) ? execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", plist]).toString().trim() : "";
  if (id !== bundleId) throw new Error(`${desktopApp} existe e não é o ${name} (bundle id "${id}"); não vou sobrescrever.`);
  rmSync(desktopApp, { recursive: true, force: true });
}
execFileSync("ditto", [app, desktopApp]);
console.log("Botão na área de trabalho:", desktopApp);
