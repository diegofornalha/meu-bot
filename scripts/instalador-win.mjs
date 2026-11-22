// Gera o instalador Windows (`out/<nome>-<versão>-x64-setup.exe`) da pasta que o package.mjs e o fuses.mjs deixaram
// em out/<nome>-win32-x64. Uso: node scripts/instalador-win.mjs --variant client-staging [--versao 0.2.0-staging.3]
//
// O instalador é NSIS, feito pelo electron-builder só nesta etapa (`prepackaged`: ele não reempacota nem toca no .exe,
// que já leva os fuses e a integridade do asar). Instala por usuário em %LOCALAPPDATA%\Programs\meu-bot (o nome do
// pacote, não o do produto: conferido no runner Windows, .github/workflows/windows.yml), sem pedir
// administrador; `/S` instala em silêncio e `--updated --force-run` reabre o app depois (o caminho da atualização).
// Roda neste Mac: o conjunto NSIS "1.2.1" do electron-builder é nativo em arm64 (o antigo é x86_64 e pede Rosetta).
// Sem assinatura Authenticode: o SmartScreen avisa na instalação. A atualização é conferida pela assinatura Ed25519.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { Arch, Platform, build } from "electron-builder";
import { empacotado, exigeWindows, icoOf, produtoFromArgv, versaoFromArgv } from "./produtos.mjs";

/** Nome do instalador de um app numa versão: o mesmo que a release publica e o atualizador procura. */
export const nomeDoInstalador = (nome, versao) => `${nome}-${versao}-x64-setup.exe`;

/** Configuração do electron-builder para o instalador de um produto; pura, para o teste conferir. */
export function configDoInstalador(produto, versao, saida) {
  const ico = icoOf(produto);
  return {
    appId: produto.bundleId,
    productName: produto.nome,
    extraMetadata: { version: versao },
    directories: { output: saida },
    toolsets: { nsis: "1.2.1" },
    publish: null,
    win: { icon: ico, signAndEditExecutable: false, target: [{ target: "nsis", arch: ["x64"] }] },
    nsis: {
      oneClick: true,
      perMachine: false,
      artifactName: nomeDoInstalador(produto.nome, versao),
      installerIcon: ico,
      uninstallerIcon: ico,
      shortcutName: produto.nome,
      uninstallDisplayName: produto.nome,
      runAfterFinish: true,
      // Desinstalar não apaga conversas nem configurações (%APPDATA%\<pasta de dados>).
      deleteAppDataOnUninstall: false,
      // Sem o .blockmap da atualização diferencial do electron-updater: o atualizador é o nosso.
      differentialPackage: false,
    },
  };
}

if (import.meta.filename === resolve(process.argv[1] ?? "")) {
  const produto = produtoFromArgv();
  exigeWindows(produto, "win32");
  const versao = versaoFromArgv() ?? JSON.parse(readFileSync("package.json", "utf8")).version;
  const { pasta, app } = empacotado(produto, "win32");
  if (!existsSync(app)) { console.error(`✗ falta ${app}: rode scripts/package.mjs e scripts/fuses.mjs com --plataforma win32 antes`); process.exit(1); }
  const destino = join("out", nomeDoInstalador(produto.nome, versao));
  // Pasta de trabalho própria do produto: o electron-builder deixa nela o .7z intermediário e o builder-debug.yml.
  const saida = join("out", `${produto.nome}-instalador-win`);
  rmSync(saida, { recursive: true, force: true });
  rmSync(destino, { force: true });
  mkdirSync(saida, { recursive: true });
  try {
    await build({ targets: Platform.WINDOWS.createTarget("nsis", Arch.x64), prepackaged: pasta, publish: "never", config: configDoInstalador(produto, versao, saida) });
  } catch (e) {
    console.error(`✗ o electron-builder não gerou o instalador: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  renameSync(join(saida, nomeDoInstalador(produto.nome, versao)), destino);
  rmSync(saida, { recursive: true, force: true });
  console.log("Instalador Windows:", destino);
}
