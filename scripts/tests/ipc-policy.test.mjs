import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const { SHARED_CHANNELS, CLIENT_CHANNELS, ADMIN_CHANNELS, ADMIN_READONLY_MSG } = createRequire(import.meta.url)("../../dist/main/ipc/ipc-policy.js");

const shared = new Set(SHARED_CHANNELS), client = new Set(CLIENT_CHANNELS), admin = new Set(ADMIN_CHANNELS);
const all = [...SHARED_CHANNELS, ...CLIENT_CHANNELS, ...ADMIN_CHANNELS];

/** Canais que os preloads chamam (invoke ou send): a lista real do que o renderer pode pedir. */
function preloadChannels(file) {
  const src = readFileSync(join(here, "..", "..", "dist", "preload", file), "utf8");
  return [...src.matchAll(/ipcRenderer\.(?:invoke|send)\("([a-z:-]+)"/g)].map((m) => m[1]);
}

test("cada canal está numa lista só", () => {
  assert.equal(new Set(all).size, all.length, "canal repetido entre as listas");
  for (const c of SHARED_CHANNELS) assert.ok(!client.has(c) && !admin.has(c), c);
});

test("todo canal dos preloads tem política", () => {
  const seen = new Set(all);
  for (const file of ["preload.js", "picker-preload.js", "quick-entry-preload.js", "relief-preload.js"]) {
    const chans = preloadChannels(file);
    assert.ok(chans.length > 0, `${file}: nenhum canal lido`);
    for (const c of chans) assert.ok(seen.has(c), `${file}: ${c} sem política em ipc-policy.ts`);
  }
});

test("o que escreve na máquina da pessoa é só do cliente (exceto limpar o WhatsApp, que o admin também faz, registrado); o admin só tem o suporte", () => {
  assert.ok(shared.has("whatsapp:clear") && shared.has("whatsapp:clear-plan") && shared.has("whatsapp:pause") && shared.has("whatsapp:mark") && shared.has("whatsapp:names") && shared.has("update:check"));
  assert.ok(client.has("ui:notify-test") && client.has("alerts:get") && client.has("alerts:set"), "notificação de teste e avisos de segurança são do cliente");
  const writes = [
    "chat:send", "chat:new", "chat:delete", "chat:apagadas", "chat:duplicate", "chat:branch",
    "whatsapp:pair", "whatsapp:audio", "whatsapp:logout", "whatsapp:dm-policy", "whatsapp:branch", "whatsapp:pausa-plugin", "whatsapp:dono",
    "claude-login:start", "claude-login:code", "claude-login:logout", "xai-login:prepare", "xai-login:start", "xai-login:logout",
    "statusline:install", "statusline:set-segments", "statusline:uninstall", "tailscale:disable-check", "tailscale:restore", "support:set", "support:name", "support:deliver", "support:progress", "support:share", "support:reset",
    "backend:install", "backend:presente",
    "picker:install", "picker:install-statusline", "picker:install-transcricao", "picker:remove-host", "picker:rename-host", "picker:sync-ssh",
    "picker:approve-tailscale", "picker:tailscale-disable-check", "picker:tailscale-credential-save", "picker:tailscale-credential-forget",
    "cota:apagar-item", "cota:pedir-mais",
  ];
  for (const c of writes) assert.ok(client.has(c), `${c} devia ser só do cliente`);
  assert.ok(shared.has("picker:use-port"), "a porta por máquina é configuração deste Mac: o admin também ajusta");
  assert.deepEqual([...admin].sort(), ["admin:action", "admin:auditoria", "admin:auditoria-exportar", "admin:auditoria-visivel", "admin:backends-atualizar", "admin:backup-conferir", "admin:backup-criar", "admin:backup-listar", "admin:backup-restaurar", "admin:backup-whatsapp", "admin:bot-chats", "admin:bot-delete", "admin:bot-thread", "admin:claude-global", "admin:claude-global-conta-editar", "admin:claude-global-conta-nova", "admin:claude-global-conta-remover", "admin:claude-global-conta-usar", "admin:claude-global-entrar", "admin:claude-global-instalar", "admin:claude-global-limiares", "admin:claude-global-usuario", "admin:governanca", "admin:health", "admin:hermes-global", "admin:license-approve", "admin:license-revoke", "admin:license-set", "admin:link-publico", "admin:link-publico-entrar", "admin:link-publico-instalar", "admin:link-publico-publicar", "admin:link-publico-remover", "admin:link-publico-tunel", "admin:link-publico-usuario", "admin:logs", "admin:preparar-aplicar", "admin:preparar-estado", "admin:produtos-list", "admin:swap-ligar", "admin:usuario-apagar", "admin:usuario-apagar-item", "admin:usuario-apelido", "admin:usuario-criar", "admin:usuario-ligado", "admin:usuario-limite", "admin:usuario-maiores", "admin:usuario-preparar", "admin:usuario-recursos", "admin:usuario-seletores", "admin:usuarios", "admin:usuarios-sincronizar", "admin:usuarios-visivel", "admin:whatsapp-alvo", "picker:produtos-abrir", "picker:support-add", "picker:support-archive", "picker:support-refresh", "picker:support-remove", "picker:support-rename", "produtos:catalogo", "produtos:exportar", "produtos:listar", "produtos:remover", "produtos:salvar", "ui:bot-menu"]);
  assert.match(ADMIN_READONLY_MSG, /só lê/);
});

test("janela Produtos: todo canal do preload dela é só do admin", () => {
  const src = readFileSync(join(here, "..", "..", "dist", "preload", "produtos-preload.js"), "utf8");
  const chans = [...src.matchAll(/ipcRenderer\.(?:invoke|send)\("([a-z:-]+)"/g)].map((m) => m[1]);
  assert.ok(chans.length >= 5, "listar, salvar, remover, exportar, catálogo");
  for (const c of chans) assert.ok(admin.has(c), `${c} devia estar em ADMIN_CHANNELS`);
});

test("os grupos sharedApi/clientApi/adminApi dos preloads batem com as listas de canais", () => {
  for (const file of ["preload.js", "picker-preload.js"]) {
    const src = readFileSync(join(here, "..", "..", "dist", "preload", file), "utf8");
    const groups = [...src.matchAll(/const (shared|client|admin)Api[\s\S]*?\n\};/g)];
    assert.equal(groups.length, 3, `${file}: três grupos`);
    const lists = { shared, client, admin };
    for (const g of groups) {
      const chans = [...g[0].matchAll(/ipcRenderer\.(?:invoke|send)\("([a-z:-]+)"/g)].map((m) => m[1]);
      assert.ok(chans.length > 0, `${file}: ${g[1]}Api vazio`);
      for (const c of chans) assert.ok(lists[g[1]].has(c), `${file}: ${c} está em ${g[1]}Api mas não em ${g[1].toUpperCase()}_CHANNELS`);
    }
  }
});
