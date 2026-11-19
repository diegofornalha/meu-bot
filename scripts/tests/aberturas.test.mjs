import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { usoResumo, aberturaTexto, canalDoProduto } from "../../dist/renderer/lib/admin-view.js";

const { parseAberturas } = createRequire(import.meta.url)("../../dist/main/admin/aberturas-core.js");

test("parseAberturas: mais nova primeiro, pula linha estragada ou fora do formato", () => {
  const raw = [
    JSON.stringify({ em: "2026-11-10T10:00:00Z", produto: "meu-bot", versao: "0.79.3", mac: "box-mac", user: "box" }),
    "lixo{",
    JSON.stringify({ em: "2026-11-10T11:00:00Z", produto: "meu-bot-staging", versao: "0.80.0-staging.1", mac: "box-mac", user: "box", conta: "mac1@gmail.com" }),
    JSON.stringify({ em: "ontem", produto: "meu-bot", versao: "1" }),
    JSON.stringify({ em: "2026-11-10T12:00:00Z", produto: "rm -rf /", versao: "1" }),
  ].join("\n");
  const ab = parseAberturas(raw);
  assert.deepEqual(ab.map((a) => a.produto), ["meu-bot-staging", "meu-bot"]);
  assert.deepEqual(ab.map((a) => a.conta), ["mac1@gmail.com", ""], "registro antigo sem conta vira vazio");
  assert.equal(parseAberturas("").length, 0);
});

test("usoResumo: última versão de cada app, com o canal; aberturaTexto diz produção ou staging", () => {
  const ab = [
    { em: "2026-11-10T11:00:00Z", produto: "meu-bot-staging", versao: "0.80.0-staging.1", mac: "box-mac", user: "box", conta: "mac1@gmail.com" },
    { em: "2026-11-10T10:00:00Z", produto: "meu-bot", versao: "0.79.3", mac: "box-mac", user: "box", conta: "" },
    { em: "2026-11-09T10:00:00Z", produto: "meu-bot", versao: "0.79.2", mac: "box-mac", user: "box", conta: "" },
  ];
  const r = usoResumo(ab, Date.parse("2026-11-10T12:00:00Z"));
  assert.equal(r.length, 2);
  assert.match(r[0].text, /^Staging \(meu-bot-staging\): versão 0\.80\.0-staging\.1 · conta mac1@gmail\.com · aberto há 1 h$/);
  assert.match(r[1].text, /^Produção \(meu-bot\): versão 0\.79\.3/);
  assert.equal(canalDoProduto("meu-bot-finance-staging"), "staging");
  assert.equal(canalDoProduto("meu-bot-inspector-staging"), "staging");
  assert.match(aberturaTexto(ab[2]), /meu-bot \(produção\) 0\.79\.2 · Mac box-mac$/);
  assert.match(aberturaTexto(ab[0]), /0\.80\.0-staging\.1 · mac1@gmail\.com · Mac box-mac$/);
});

test("resumoDaSaude: o que vai ao console (saúde, licença, uso com a conta, aberturas)", () => {
  const { resumoDaSaude } = createRequire(import.meta.url)("../../dist/main/admin/suporte-resumo-core.js");
  const r = resumoDaSaude({
    probe: { reachable: true, user: "root", os: "Ubuntu 24.04", backendListening: true, backendInstalled: true, claudeLoggedIn: false, diskFreeMb: 40960, diskTotalMb: 81920, error: null },
    whatsapp: { connected: true, detail: "" }, progress: null, share: {}, xai: null,
    license: { license: { plan: "pro", status: "active", expiresAt: null }, activeCount: 1, pendingCount: 0, deviceLimit: 2, devices: [] },
    aberturas: [{ em: "2026-11-10T14:00:00Z", produto: "meu-bot-staging", versao: "0.80.0", mac: "cursor", user: "box", conta: "mac1@gmail.com" }],
  });
  assert.deepEqual(r.saude.map((l) => l.ok), [true, true, false, true, true]);
  assert.equal(r.saude[0].texto, "entra por SSH (root · Ubuntu 24.04)");
  assert.deepEqual(r.licenca.map((l) => l.texto), ["Plano: Pro", "Status: Ativo", "Devices: 1/2 ativos"]);
  assert.match(r.uso[0].texto, /^Staging \(meu-bot-staging\): versão 0\.80\.0 · conta mac1@gmail\.com · aberto em /);
  assert.match(r.aberturas[0], /meu-bot-staging \(staging\) 0\.80\.0 · mac1@gmail\.com · Mac cursor$/);
});

test("ZERAR_ABERTURAS_SH: esvazia o arquivo sem apagá-lo e diz o que fez", async () => {
  const { ZERAR_ABERTURAS_SH } = createRequire(import.meta.url)("../../dist/main/admin/aberturas-core.js");
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const home = mkdtempSync(join(tmpdir(), "aberturas-"));
  const rodar = () => execFileSync("bash", ["-c", ZERAR_ABERTURAS_SH], { env: { ...process.env, HOME: home }, encoding: "utf8" }).trim();
  const arq = join(home, ".local/share/meu-bot/aberturas.jsonl");
  assert.equal(rodar(), "vazio", "sem o arquivo não cria nada");
  assert.equal(existsSync(arq), false);
  mkdirSync(join(home, ".local/share/meu-bot"), { recursive: true });
  writeFileSync(arq, `${JSON.stringify({ em: "2026-11-10T10:00:00Z", produto: "meu-bot", versao: "1.0.0" })}\n`, { mode: 0o600 });
  writeFileSync(join(home, ".local/share/meu-bot/licenca.json"), "{}");
  assert.equal(rodar(), "zerado");
  assert.equal(readFileSync(arq, "utf8"), "");
  assert.equal(statSync(arq).mode & 0o777, 0o600, "a permissão do arquivo fica");
  assert.equal(readFileSync(join(home, ".local/share/meu-bot/licenca.json"), "utf8"), "{}", "não toca nos vizinhos");
  assert.equal(parseAberturas(readFileSync(arq, "utf8")).length, 0);
});
