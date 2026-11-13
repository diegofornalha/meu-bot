// Notarização na Apple de um .dmg ou de um .app assinado com Developer ID (scripts/assinatura.mjs), com o perfil
// "meu-bot" do notarytool (scripts/developer-id.mjs --credenciais). Sem Xcode: notarytool e stapler vêm nas
// Command Line Tools.
//
//   node scripts/notarizar.mjs <arquivo.dmg | App.app>
//
// 1. submit --wait (o .app vai zipado com ditto, como a Apple pede; o .dmg vai como está);
// 2. stapler staple no próprio .dmg/.app, para o Gatekeeper aceitar sem internet;
// 3. spctl -a -vv -t install confirma "source=Notarized Developer ID".
// Sem Developer ID no chaveiro, avisa e sai 0: a release local (meu-bot local / ad-hoc) segue como antes.
//   import { notarizar } from "./notarizar.mjs"  → mesma coisa, para o dmg.mjs e o release.mjs.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { identidadeDeveloperId } from "./assinatura.mjs";

export const PERFIL = "meu-bot";

/** Notariza e grampeia; devolve true quando o spctl confirmou. Lança erro com o motivo da Apple quando ela recusa. */
export function notarizar(arquivo, { perfil = PERFIL } = {}) {
  if (!existsSync(arquivo)) throw new Error(`não achei ${arquivo}`);
  if (identidadeDeveloperId() === null) { console.log(`(sem Developer ID no chaveiro: ${basename(arquivo)} não foi notarizado)`); return false; }
  const ehApp = arquivo.endsWith(".app");
  // .dmg sem assinatura: a Apple aceita, mas o spctl não reconhece a notarização. Recusa antes de gastar o envio.
  if (!ehApp && spawnSync("codesign", ["-v", arquivo]).status !== 0) throw new Error(`${basename(arquivo)} não está assinado: assine com o Developer ID antes de notarizar (o dmg.mjs faz isso)`);
  const tmp = mkdtempSync(join(tmpdir(), "meu-bot-notarizar-"));
  try {
    let envio = arquivo;
    if (ehApp) { envio = join(tmp, `${basename(arquivo, ".app")}.zip`); execFileSync("ditto", ["-c", "-k", "--keepParent", arquivo, envio]); }
    console.log(`▸ notarytool submit ${basename(envio)} (perfil ${perfil}, esperando a Apple)…`);
    const r = spawnSync("xcrun", ["notarytool", "submit", envio, "--keychain-profile", perfil, "--wait", "--output-format", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    let resposta = {};
    try { resposta = JSON.parse(r.stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop() ?? "{}"); } catch { /* texto inesperado: cai no status abaixo */ }
    if (r.status !== 0 || resposta.status !== "Accepted") {
      const id = resposta.id;
      let motivo = r.stdout.trim();
      if (id) { const log = spawnSync("xcrun", ["notarytool", "log", id, "--keychain-profile", perfil], { encoding: "utf8" }); motivo = (log.stdout || motivo).trim(); }
      throw new Error(`a Apple não aceitou (${resposta.status ?? `saída ${r.status}`}):\n${motivo}`);
    }
    console.log(`✓ aceito pela Apple (id ${resposta.id})`);
    execFileSync("xcrun", ["stapler", "staple", arquivo], { stdio: "inherit" });
    const spctl = spawnSync("spctl", ["-a", "-vv", "-t", ehApp ? "exec" : "install", arquivo], { encoding: "utf8" });
    const saida = `${spctl.stdout}${spctl.stderr}`.trim();
    console.log(saida);
    if (spctl.status !== 0 || !/source=Notarized Developer ID/.test(saida)) throw new Error(`o spctl não confirmou "source=Notarized Developer ID" em ${basename(arquivo)}`);
    return true;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] && process.argv[1].endsWith("notarizar.mjs")) {
  const alvo = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!alvo) { console.error("uso: node scripts/notarizar.mjs <arquivo.dmg | App.app>"); process.exit(64); }
  try { notarizar(alvo); } catch (err) { console.error(`✗ ${err instanceof Error ? err.message : String(err)}`); process.exit(1); }
}
