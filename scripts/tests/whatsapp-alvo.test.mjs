import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { parseAlvo, alvoValido, resolverAlvo, alvoSemAlias, capacidadesDe, ALVO_PADRAO, WA_ALVO_SH } = req("../../dist/main/whatsapp/whatsapp-capacidades.js");
const { parseSshConfigText } = req("../../dist/main/maquina/sshConfig.js");
const { whatsappAlvoSh } = req("../../dist/main/admin/usuarios-core.js");

// Onde vive o WhatsApp de uma máquina com OpenClaw: a conta e o agente num gateway que pode ser de outro usuário da
// mesma máquina (um gateway único no root). Sem arquivo, o padrão de sempre: default/main/próprio.
test("parseAlvo: sem arquivo ou com lixo vale o padrão; ids fora do padrão caem campo por campo", () => {
  assert.deepEqual(parseAlvo(null), ALVO_PADRAO);
  assert.deepEqual(parseAlvo("x"), ALVO_PADRAO);
  assert.deepEqual(parseAlvo({ accountId: "box", agentId: "box", gatewayUser: "root" }), { accountId: "box", agentId: "box", gatewayUser: "root" });
  assert.deepEqual(parseAlvo({ accountId: "Box Lv", agentId: "../x", gatewayUser: "r oot", numero: "+55" }), ALVO_PADRAO);
  assert.deepEqual(parseAlvo({ accountId: "box-lv", agentId: "box-lv", gatewayUser: null, numero: "5522925501274" }), { accountId: "box-lv", agentId: "box-lv", gatewayUser: null, numero: "5522925501274" });
  assert.equal(alvoValido({ accountId: "box", agentId: "box", gatewayUser: "root" }), null);
  assert.match(alvoValido({ accountId: "Box", agentId: "box", gatewayUser: null }), /conta inválida/);
  assert.match(alvoValido({ accountId: "box", agentId: "box", gatewayUser: "r oot" }), /usuário do gateway/);
  assert.match(WA_ALVO_SH, /echo "alvo=\$ALVO"/); assert.match(WA_ALVO_SH, /export ALVO_GW/, "deixa o dono do gateway para os fragmentos");
});

const HOSTS = parseSshConfigText(`
Host agente-root
    HostName 187.127.41.175
    User root
Host agente-box agente-box2
    HostName 187.127.41.175
    User box
    HostName ignorado-o-primeiro-vale
Host grokbot-1
    HostName 10.0.0.5
    User ubuntu
Host *
    ServerAliveInterval 60
Include ~/.ssh/outro.conf
`).hosts;

test("parseSshConfigText: alias, HostName e User por bloco; curingas fora; o primeiro valor vale", () => {
  assert.deepEqual(HOSTS, [
    { host: "agente-root", hostName: "187.127.41.175", user: "root" },
    { host: "agente-box", hostName: "187.127.41.175", user: "box" },
    { host: "agente-box2", hostName: "187.127.41.175", user: "box" },
    { host: "grokbot-1", hostName: "10.0.0.5", user: "ubuntu" },
  ]);
  assert.deepEqual(parseSshConfigText("Include a.conf b.conf\nHost x\n").includes, ["a.conf", "b.conf"]);
});

test("resolverAlvo: o alias do gateway é o host com o mesmo HostName e o User do gatewayUser; sem ele, fica null e a tela explica", () => {
  const alvo = { accountId: "box", agentId: "box", gatewayUser: "root" };
  assert.deepEqual(resolverAlvo(alvo, "agente-box", HOSTS), { ...alvo, gatewayHost: "agente-root", proprio: false });
  const semAlias = resolverAlvo({ ...alvo, gatewayUser: "openclaw" }, "agente-box", HOSTS);
  assert.deepEqual(semAlias, { ...alvo, gatewayUser: "openclaw", gatewayHost: null, proprio: false });
  assert.match(alvoSemAlias(semAlias), /gateway do usuário openclaw .* User openclaw/);
  assert.equal(alvoSemAlias(resolverAlvo(alvo, "agente-box", HOSTS)), null);
  // gatewayUser igual ao User do próprio alias, ou null: gateway próprio.
  assert.deepEqual(resolverAlvo({ ...alvo, gatewayUser: "box" }, "agente-box", HOSTS), { ...alvo, gatewayUser: null, gatewayHost: null, proprio: true });
  assert.deepEqual(resolverAlvo(ALVO_PADRAO, "grokbot-1", HOSTS), { ...ALVO_PADRAO, gatewayHost: null, proprio: true });
  // Alias que não está no ssh config deste Mac: não dá para saber a máquina; sem alias para o gateway.
  assert.deepEqual(resolverAlvo(alvo, "desconhecido", HOSTS), { ...alvo, gatewayHost: null, proprio: false });
});

test("capacidades com gateway de outro usuário: sem guarda e sem atualizar grupos; o resto igual", () => {
  const proprio = capacidadesDe("openclaw", true, true);
  const conta = capacidadesDe("openclaw", true, true, { pausaModo: "allowlist", proprio: false });
  assert.ok(proprio.gatewayProprio && proprio.guarda && proprio.gruposAtualizar);
  assert.ok(!conta.gatewayProprio && !conta.guarda && !conta.gruposAtualizar);
  for (const k of ["parear", "listarConversas", "lerConversa", "limparHistorico", "pausar", "grupos", "politicaDm", "audio"]) assert.equal(conta[k], proprio[k], k);
  assert.ok(capacidadesDe("hermes", true, true).gatewayProprio && capacidadesDe("picoclaw", true, true).gatewayProprio);
});

test("whatsappAlvoSh (admin, como root): grava no home do usuário com dono e modo certos; null apaga", () => {
  const sh = whatsappAlvoSh("box-lv", JSON.stringify({ accountId: "box-lv", agentId: "box-lv", gatewayUser: "root" }));
  assert.match(sh, /getent passwd 'box-lv'/);
  assert.match(sh, /chown 'box-lv':'box-lv'/); assert.match(sh, /chmod 600/); assert.match(sh, /mv "\$F\.tmp" "\$F"/);
  assert.match(whatsappAlvoSh("box-lv", null), /rm -f "\$F"/);
});
