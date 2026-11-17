// Atualização no Windows: o asset é o instalador x64, com o .sig ao lado como no macOS; a troca é rodá-lo em silêncio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
const { escolherRelease, listarReleases, assetName, argsDoInstalador, esperarInstaladorAbrir, parsePreparada, parsePendente, decideRollback, decideReaproveitar, UPDATE_REPO } = createRequire(import.meta.url)("../../dist/main/atualizacao/updater-core.js");

const url = (n) => `https://github.com/${UPDATE_REPO}/releases/download/x/${n}`;
const comSig = (n) => [{ name: n, browser_download_url: url(n), size: 123 }, { name: `${n}.sig`, browser_download_url: url(`${n}.sig`), size: 88 }];
const ZIP = "meu-bot-staging-0.85.0-staging.2-arm64.zip", EXE = "meu-bot-staging-0.85.0-staging.2-x64-setup.exe";
const staging = (assets) => [{ tag_name: "v0.85.0-staging.2", draft: false, prerelease: true, assets }];
const want = (plataforma, arch) => ({ app: "meu-bot-staging", arch, current: "0.85.0-staging.1", canal: "staging", plataforma });

test("assetName: o macOS não muda (com ou sem a plataforma); o Windows é o instalador, sempre x64", () => {
  assert.equal(assetName("meu-bot", "0.2.0", "arm64"), "meu-bot-0.2.0-arm64.zip");
  assert.equal(assetName("meu-bot", "0.2.0", "arm64", "darwin"), "meu-bot-0.2.0-arm64.zip");
  assert.equal(assetName("meu-bot", "0.2.0", "x64", "win32"), "meu-bot-0.2.0-x64-setup.exe");
  assert.equal(assetName("meu-bot", "0.2.0", "arm64", "win32"), "meu-bot-0.2.0-x64-setup.exe");
});

test("escolherRelease: cada plataforma pega só o asset dela na mesma release", () => {
  const raw = staging([...comSig(ZIP), ...comSig(EXE)]);
  const win = escolherRelease(raw, want("win32", "x64"));
  assert.equal(win.tipo, "candidata");
  assert.equal(win.candidata.asset.name, EXE);
  assert.equal(win.candidata.sig.name, `${EXE}.sig`);
  const mac = escolherRelease(raw, want("darwin", "arm64"));
  assert.equal(mac.candidata.asset.name, ZIP);
});

test("escolherRelease: release só com o .zip do Mac não é atualização para o Windows; instalador sem .sig não entra", () => {
  assert.equal(escolherRelease(staging(comSig(ZIP)), want("win32", "x64")).tipo, "nada-novo");
  const semSig = escolherRelease(staging([comSig(EXE)[0]]), want("win32", "x64"));
  assert.equal(semSig.tipo, "inutilizavel");
  assert.equal(semSig.motivo, "sem-assinatura");
});

test("listarReleases: a lista do super admin no Windows traz o instalador", () => {
  const itens = listarReleases(staging([...comSig(ZIP), ...comSig(EXE)]), { ...want("win32", "x64"), minima: null });
  assert.equal(itens.length, 1);
  assert.equal(itens[0].candidata.asset.name, EXE);
});

test("argsDoInstalador: sempre em silêncio e como atualização; só reabre o app fora da saída", () => {
  assert.deepEqual(argsDoInstalador("clique"), ["--updated", "/S", "--force-run"]);
  assert.deepEqual(argsDoInstalador("ocioso"), ["--updated", "/S", "--force-run"]);
  assert.deepEqual(argsDoInstalador("saida"), ["--updated", "/S"]);
});

test("parsePreparada: aceita o instalador do Windows, não um .exe qualquer", () => {
  const base = { versao: 1, para: "0.85.0-staging.2", sha256: "a".repeat(64), em: "2026-11-17T00:00:00.000Z" };
  const exe = `C:\\Users\\x\\AppData\\Roaming\\meu-bot-staging\\update\\${EXE}`;
  assert.equal(parsePreparada({ ...base, bundle: exe }).bundle, exe);
  assert.equal(parsePreparada({ ...base, bundle: "C:\\Windows\\System32\\cmd.exe" }), null);
  assert.equal(parsePreparada({ ...base, bundle: "/x/update/app/meu-bot-staging.app" }).bundle, "/x/update/app/meu-bot-staging.app");
});

test("depois do instalador: abriu na nova = confirmada; na de antes = não pegou; a preparada segue oferecida", () => {
  const pend = parsePendente({ de: "0.85.0-staging.1", para: "0.85.0-staging.2", antigos: [], tentativas: 0, gatilho: "clique", pedidoEm: "2026-11-17T00:00:00.000Z", fase: "trocada" });
  assert.deepEqual(pend.antigos, []);
  assert.equal(decideRollback(pend, "0.85.0-staging.2"), "aguardar");
  assert.equal(decideRollback(pend, "0.85.0-staging.1"), "nao-pegou");
  assert.equal(decideRollback(pend, "0.86.0-staging.1"), "descartar");
  const prep = { versao: 1, para: "0.85.0-staging.2", bundle: `C:\\u\\${EXE}`, sha256: "a".repeat(64), em: "2026-11-17T00:00:00.000Z" };
  assert.equal(decideReaproveitar(prep, "0.85.0-staging.1", () => true).tipo, "usar");
  assert.equal(decideReaproveitar(prep, "0.85.0-staging.2", () => true).tipo, "descartar");
});

test("esperarInstaladorAbrir: segue quando o processo abre; quando o Windows não deixa, a frase leva o motivo", async () => {
  const abriu = new EventEmitter();
  const p1 = esperarInstaladorAbrir(abriu);
  abriu.emit("spawn");
  await p1;
  const barrado = new EventEmitter();
  const p2 = esperarInstaladorAbrir(barrado);
  barrado.emit("error", new Error("spawn EACCES"));
  await assert.rejects(p2, /Não consegui abrir o instalador da atualização \(spawn EACCES\)/);
});
