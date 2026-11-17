// O instalador Windows: o nome do arquivo (o que a release publica e o atualizador vai procurar), a instalação por
// usuário sem tocar no .exe já empacotado, e o .ico montado pelo scripts/icon.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { PRODUTOS } = createRequire(import.meta.url)("../../dist/main/app/variant-core.js");
const { configDoInstalador, nomeDoInstalador } = await import("../instalador-win.mjs");
const { montarIco } = await import("../icon.mjs");
const staging = PRODUTOS.find((p) => p.variant === "client-staging");

test("instalador: nome com app, versão e arquitetura, o mesmo que o atualizador do Windows procura", () => {
  assert.equal(nomeDoInstalador("meu-bot-staging", "0.84.0-staging.3"), "meu-bot-staging-0.84.0-staging.3-x64-setup.exe");
  const { assetName } = createRequire(import.meta.url)("../../dist/main/atualizacao/updater-core.js");
  for (const [app, v] of [["meu-bot-staging", "0.84.0-staging.3"], ["meu-bot", "1.2.3"]]) assert.equal(nomeDoInstalador(app, v), assetName(app, v, "x64", "win32"));
});

test("instalador: por usuário, x64, com a versão pedida e sem regravar o executável", () => {
  const c = configDoInstalador(staging, "0.84.0-staging.3", "out/x");
  assert.equal(c.appId, staging.bundleId);
  assert.equal(c.extraMetadata.version, "0.84.0-staging.3");
  assert.equal(c.nsis.perMachine, false);
  assert.equal(c.nsis.oneClick, true);
  assert.equal(c.nsis.deleteAppDataOnUninstall, false);
  assert.equal(c.nsis.artifactName, nomeDoInstalador(staging.nome, "0.84.0-staging.3"));
  assert.equal(c.win.signAndEditExecutable, false, "o .exe já leva os fuses e a integridade do asar");
  assert.deepEqual(c.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.equal(c.win.icon, "assets/icon-staging.ico");
});

test("ico: cabeçalho, uma entrada por imagem e os PNGs nos offsets declarados", () => {
  const imagens = [{ tamanho: 16, png: Buffer.from("pequeno") }, { tamanho: 256, png: Buffer.from("o-maior-de-todos") }];
  const ico = montarIco(imagens);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 2);
  assert.equal(ico.readUInt8(6), 16);
  assert.equal(ico.readUInt8(6 + 16), 0, "256 px grava 0 na largura");
  for (const [i, img] of imagens.entries()) {
    const e = 6 + 16 * i;
    const tamanho = ico.readUInt32LE(e + 8), offset = ico.readUInt32LE(e + 12);
    assert.deepEqual(ico.subarray(offset, offset + tamanho), img.png);
  }
});
