// Home: o asset do app da pessoa na release mais nova (meu-bot-<v>-arm64.zip), nunca o admin nem o .sig.
import { test } from "node:test";
import assert from "node:assert/strict";
import { escolherAsset, escolherStaging, escolherWindows } from "../dist/release-github.js";

test("escolherAsset: pega meu-bot-<v>-arm64.zip e ignora admin, .sig e json", () => {
  const rel = { tag_name: "v0.78.4", published_at: "2026-11-05T01:05:09Z", assets: [
    { name: "google-oauth.json", browser_download_url: "u1", size: 335 },
    { name: "meu-bot-admin-0.78.4-arm64.zip", browser_download_url: "u2", size: 1 },
    { name: "meu-bot-0.78.4-arm64.zip.sig", browser_download_url: "u3", size: 89 },
    { name: "meu-bot-0.78.4-arm64.zip", browser_download_url: "https://github.com/x/meu-bot-0.78.4-arm64.zip", size: 133558683 },
  ] };
  assert.deepEqual(escolherAsset(rel), { versao: "0.78.4", url: "https://github.com/x/meu-bot-0.78.4-arm64.zip", tamanho: 133558683, publicadoEm: "2026-11-05T01:05:09Z", nome: "meu-bot-0.78.4-arm64.zip" });
  assert.equal(escolherAsset({ assets: [{ name: "meu-bot-admin-1.0.0-arm64.zip", browser_download_url: "u" }] }), null);
  assert.equal(escolherAsset(null), null);
  assert.equal(escolherAsset("x"), null);
});

test("escolherStaging: a pre-release de staging mais nova (app meu-bot-staging), pulando rascunho e release sem o asset", () => {
  const z = (name) => ({ name, browser_download_url: "https://github.com/x/" + name, size: 10 });
  const rels = [
    { draft: true, published_at: "d", assets: [z("meu-bot-staging-0.80.0-staging.1-arm64.zip")] },
    { tag_name: "v0.79.4", published_at: "a", assets: [z("meu-bot-0.79.4-arm64.zip")] },
    { tag_name: "v0.79.3-staging.1", published_at: "2026-11-09T16:31:22Z", assets: [z("meu-bot-finance-staging-0.79.3-staging.1-arm64.zip"), z("meu-bot-staging-0.79.3-staging.1-arm64.zip.sig"), z("meu-bot-staging-0.79.3-staging.1-arm64.zip")] },
  ];
  assert.deepEqual(escolherStaging(rels), { versao: "0.79.3-staging.1", url: "https://github.com/x/meu-bot-staging-0.79.3-staging.1-arm64.zip", tamanho: 10, publicadoEm: "2026-11-09T16:31:22Z", nome: "meu-bot-staging-0.79.3-staging.1-arm64.zip" });
  assert.equal(escolherStaging([{ assets: [z("meu-bot-0.78.4-arm64.zip")] }]), null);
  assert.equal(escolherStaging(null), null);
  // A estável continua ignorando o asset de staging.
  assert.equal(escolherAsset({ assets: [z("meu-bot-staging-0.79.3-staging.1-arm64.zip")] }), null);
});

test("escolherAsset: o instalador .dmg vem antes do .zip; sem .dmg, o .zip (releases antigas)", () => {
  const z = (name) => ({ name, browser_download_url: "https://github.com/x/" + name, size: 7 });
  const com = { published_at: "p", assets: [z("meu-bot-0.79.3-arm64.zip"), z("meu-bot-0.79.3-arm64.zip.sig"), z("meu-bot-admin-gestao-0.79.3-arm64.zip"), z("meu-bot-0.79.3-arm64.dmg")] };
  assert.equal(escolherAsset(com).nome, "meu-bot-0.79.3-arm64.dmg");
  assert.equal(escolherAsset(com).versao, "0.79.3");
  assert.equal(escolherAsset({ assets: [z("meu-bot-0.78.4-arm64.zip")] }).nome, "meu-bot-0.78.4-arm64.zip");
  assert.equal(escolherAsset({ assets: [z("meu-bot-admin-gestao-0.79.3-arm64.dmg")] }), null);
  const st = [{ published_at: "s", assets: [z("meu-bot-staging-0.80.0-staging.1-arm64.zip"), z("meu-bot-finance-staging-0.80.0-staging.1-arm64.dmg"), z("meu-bot-staging-0.80.0-staging.1-arm64.dmg")] }];
  assert.equal(escolherStaging(st).nome, "meu-bot-staging-0.80.0-staging.1-arm64.dmg");
  assert.equal(escolherStaging(st).versao, "0.80.0-staging.1");
  // O site de produção nunca pega o instalador do staging.
  assert.equal(escolherAsset(st[0]), null);
});

test("escolherWindows: o instalador x64 do meu-bot-staging na release de staging mais nova que o tiver", () => {
  const z = (name, size = 10) => ({ name, browser_download_url: "https://github.com/x/" + name, size });
  const exe = "meu-bot-staging-0.85.0-staging.2-x64-setup.exe";
  const rels = [
    { draft: true, published_at: "d", assets: [z("meu-bot-staging-0.86.0-staging.1-x64-setup.exe")] },
    { tag_name: "v0.85.0-staging.3", published_at: "c", assets: [z("meu-bot-staging-0.85.0-staging.3-arm64.zip")] },
    { tag_name: "v0.85.0-staging.2", published_at: "2026-11-18T10:00:00Z", assets: [z(exe + ".sig"), z("meu-bot-staging-0.85.0-staging.2-arm64.zip"), z(exe, 113000000)] },
    { tag_name: "v0.85.0-staging.1", published_at: "a", assets: [z("meu-bot-staging-0.85.0-staging.1-x64-setup.exe")] },
  ];
  assert.deepEqual(escolherWindows(rels), { versao: "0.85.0-staging.2", url: "https://github.com/x/" + exe, tamanho: 113000000, publicadoEm: "2026-11-18T10:00:00Z", nome: exe });
  // Só o instalador do app de teste: nem o .sig, nem outro produto, nem um estável.
  assert.equal(escolherWindows([{ assets: [z(exe + ".sig"), z("meu-bot-finance-staging-0.85.0-staging.2-x64-setup.exe"), z("meu-bot-0.85.0-x64-setup.exe")] }]), null);
  // O hash vem do `digest` do GitHub, só na forma sha256:<64 hex>.
  const h = "a".repeat(64);
  const comHash = (digest) => escolherWindows([{ published_at: "2026-11-18T10:00:00Z", assets: [{ name: exe, browser_download_url: "https://github.com/x/" + exe, size: 1, digest }] }]);
  assert.equal(comHash("sha256:" + h).sha256, h);
  assert.equal("sha256" in comHash("md5:abc"), false);
  assert.equal(escolherWindows([]), null);
  assert.equal(escolherWindows(null), null);
  // As escolhas do Mac não pegam o instalador do Windows.
  assert.equal(escolherStaging([{ assets: [z(exe)] }]), null);
});
