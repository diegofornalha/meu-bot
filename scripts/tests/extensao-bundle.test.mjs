import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
// Só roda quando a extensão foi compilada (npm run build:extensao): confere o que o app vai embutir.
const dist = new URL("../../build/extensao-crm/", import.meta.url);
const tem = existsSync(new URL("content.js", dist));
test("bundle da extensão: manifesto MV3 com key, host 127.0.0.1, pageWorld.js e config.json fora dos web-acessíveis", { skip: !tem }, () => {
  const m = JSON.parse(readFileSync(new URL("manifest.json", dist), "utf8"));
  assert.equal(m.manifest_version, 3); assert.match(m.key, /^[A-Za-z0-9+/=]{200,}$/); assert.equal(m.background.service_worker, "background.js");
  assert.ok(m.host_permissions.includes("http://127.0.0.1/*")); assert.ok(m.content_scripts[0].js.includes("content.js"));
  const war = m.web_accessible_resources.flatMap((w) => w.resources);
  assert.ok(war.includes("pageWorld.js")); assert.ok(!war.includes("config.json"), "o token não pode ser lido pela página");
  for (const f of ["content.js", "background.js", "pageWorld.js", "icones/crm-16.png", "icones/crm-128.png"]) assert.ok(existsSync(new URL(f, dist)), f);
  const content = readFileSync(new URL("content.js", dist), "utf8");
  assert.ok(content.includes("sdk_meubotCRM_2cfc25813a"), "App ID registrado no bundle"); assert.ok(content.length > 50_000, "InboxSDK embutido");
  assert.ok(!/Bearer [A-Za-z0-9]{20,}/.test(content), "sem token literal");
});

const distAut = new URL("../../build/extensao-autenticador/", import.meta.url);
// Compara o id com o do CRM: sem o bundle do CRM compilado, não há com o que comparar.
test("bundle do Autenticador: MV3 com key própria (id ≠ do CRM), popup e ícones; nada web-acessível", { skip: !existsSync(new URL("popup.js", distAut)) || !tem }, async () => {
  const { idDaChave } = await import("../../extensao-crm/scripts/id-da-extensao.mjs");
  const m = JSON.parse(readFileSync(new URL("manifest.json", distAut), "utf8"));
  const crm = JSON.parse(readFileSync(new URL("manifest.json", dist), "utf8"));
  assert.equal(m.manifest_version, 3); assert.notEqual(idDaChave(m.key), idDaChave(crm.key));
  assert.equal(m.action.default_popup, "popup.html"); assert.equal(m.web_accessible_resources, undefined); assert.equal(m.content_scripts, undefined);
  for (const f of ["popup.html", "popup.js", "icones/autenticador-16.png", "icones/autenticador-128.png"]) assert.ok(existsSync(new URL(f, distAut)), f);
  assert.ok(readFileSync(new URL("popup.html", distAut), "utf8").includes('src="popup.js"'));
});
