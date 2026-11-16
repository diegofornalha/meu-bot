import { test } from "node:test";
import assert from "node:assert/strict";
import { appsInstalados, bundleDoApp, pastasDeApps } from "../app-mcp-apps.mjs";

test("app-mcp: os apps instalados vêm de ~/Applications e de /Applications, sem repetir", () => {
  const pastas = pastasDeApps("/Users/x");
  assert.deepEqual(pastas, ["/Users/x/Applications", "/Applications"]);
  const disco = { "/Users/x/Applications": ["meu-bot-admin-gestao.app", "meu-bot-staging.app", "Outro.app", "meu-bot.app.bak"], "/Applications": ["meu-bot.app", "meu-bot-staging.app", "Safari.app", "meu-bot staging (antigo).app"] };
  assert.deepEqual(appsInstalados(pastas, (d) => disco[d] ?? []), ["meu-bot", "meu-bot-admin-gestao", "meu-bot-staging"]);
  assert.deepEqual(appsInstalados(pastas, () => []), []);
});

test("app-mcp: app_abrir acha o app da release em /Applications; o da conta vem primeiro; fora das duas, null", () => {
  const pastas = pastasDeApps("/Users/x");
  const tem = (lista) => (b) => lista.includes(b);
  assert.equal(bundleDoApp("meu-bot", pastas, tem(["/Applications/meu-bot.app"])), "/Applications/meu-bot.app");
  assert.equal(bundleDoApp("meu-bot-staging", pastas, tem(["/Applications/meu-bot-staging.app", "/Users/x/Applications/meu-bot-staging.app"])), "/Users/x/Applications/meu-bot-staging.app");
  assert.equal(bundleDoApp("meu-bot-fit", pastas, tem([])), null);
});
