import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const core = require("../../dist/main/modulos/modulos-core.js");
const mb = require("../../backend-colima/modulos.js");
const { capsFor, produtoDe, ADDONS } = require("../../dist/main/app/variant-core.js");

const MANIFESTO = {
  produto: "meu-bot-diego",
  modulos: [
    { id: "buffer-mcp", rotulo: "Buffer", versao: "1.0.0", credenciais: [{ chave: "BUFFER_API_KEY", rotulo: "Chave do Buffer" }], opcoes: [{ chave: "perfis", rotulo: "Perfis", tipo: "texto", padrao: "whatsapp" }, { chave: "ligado", tipo: "booleano", padrao: true }, { chave: "hora", tipo: "numero", padrao: 9 }] },
    { id: "whatsapp-rene", rotulo: "Agente do WhatsApp (rene)", versao: "0.2.1", pasta: "whatsapp-rene", gateways: ["hermes", "telegram"], requisitos: ["WhatsApp pelo Hermes"] },
  ],
};

test("parseManifesto: completa padrões, filtra lixo e recusa o que quebraria a máquina", () => {
  const m = core.parseManifesto(MANIFESTO);
  assert.equal(m.produto, "meu-bot-diego");
  const [b, w] = m.modulos;
  assert.deepEqual([b.pasta, b.instalar, b.desinstalar], ["buffer-mcp", "instalar.sh", "desinstalar.sh"]);
  assert.deepEqual(b.opcoes.map((o) => [o.chave, o.tipo, o.padrao]), [["perfis", "texto", "whatsapp"], ["ligado", "booleano", true], ["hora", "numero", 9]]);
  assert.deepEqual(w.gateways, ["hermes"], "gateway desconhecido fica de fora");
  const ruim = (patch, re) => assert.throws(() => core.parseManifesto({ ...MANIFESTO, modulos: [{ ...MANIFESTO.modulos[0], ...patch }] }), re);
  ruim({ id: "../x" }, /id inválido/);
  ruim({ versao: "1.0" }, /x\.y\.z/);
  ruim({ pasta: "../fora" }, /pasta inválida/);
  ruim({ instalar: "rm -rf.sh" }, /instalar\/desinstalar/);
  assert.throws(() => core.parseManifesto({ ...MANIFESTO, produto: "diego" }), /meu-bot-<nome>/);
  assert.throws(() => core.parseManifesto({ ...MANIFESTO, modulos: [MANIFESTO.modulos[0], MANIFESTO.modulos[0]] }), /repetido/);
  assert.throws(() => core.parseManifesto({ ...MANIFESTO, modulos: [] }), /nenhum módulo/);
});

test("estado: só os nomes das chaves saem da máquina; opções corrompidas viram vazio; versão compara", () => {
  const op = Buffer.from(JSON.stringify({ perfis: "whatsapp", hora: 9, x: { y: 1 } })).toString("base64");
  const e = core.parseEstado(`mod=buffer-mcp ligado=1 versao=1.0.0 preenchidas=BUFFER_API_KEY,lixo, opcoes=${op}\nmod=whatsapp-rene ligado=0 versao= preenchidas= opcoes=\nmod=../x ligado=1 versao=1 preenchidas= opcoes=\n`);
  assert.deepEqual(e["buffer-mcp"], { ligado: true, versao: "1.0.0", preenchidas: ["BUFFER_API_KEY"], opcoes: { perfis: "whatsapp", hora: 9 } });
  assert.deepEqual(e["whatsapp-rene"], { ligado: false, versao: null, preenchidas: [], opcoes: {} });
  assert.equal(Object.keys(e).length, 2);
  assert.equal(core.desatualizado("1.0.0", "1.0.1"), true);
  assert.equal(core.desatualizado("1.10.0", "1.9.9"), false);
  assert.equal(core.desatualizado(null, "1.0.0"), false, "nunca instalado não é desatualizado");
});

test("opções: padrões + o que havia + o patch, com tipo conferido", () => {
  const [b] = core.parseManifesto(MANIFESTO).modulos;
  assert.deepEqual(core.mesclarOpcoes(b, { hora: 7 }, { perfis: " whatsapp,agente " }), { perfis: "whatsapp,agente", ligado: true, hora: 7 });
  assert.deepEqual(core.mesclarOpcoes(b, {}, { hora: "10" }), { perfis: "whatsapp", ligado: true, hora: 10 });
  assert.throws(() => core.mesclarOpcoes(b, {}, { ligado: "sim" }), /sim ou não/);
  assert.throws(() => core.mesclarOpcoes(b, {}, { outra: 1 }), /desconhecida/);
});

const semPython = spawnSync("python3", ["--version"]).status !== 0 ? "sem python3" : false;
test("credenciais: grava 0600 na máquina, valor vazio apaga, só chaves do manifesto, nada impresso", { skip: semPython }, () => {
  const home = mkdtempSync(join(tmpdir(), "modulos-home-"));
  const [b] = core.parseManifesto(MANIFESTO).modulos;
  const run = (sh) => spawnSync("bash", ["-c", sh], { env: { ...process.env, HOME: home }, encoding: "utf8" });
  const segredo = "sk-a=b c#'\"$x";
  let r = run(core.credenciaisSh(b, { BUFFER_API_KEY: segredo }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "cred=ok", "o valor nunca aparece na saída");
  const f = join(home, ".config", "meu-bot", "modulos", "buffer-mcp.env");
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.equal(mb.lerEnv(f).BUFFER_API_KEY, segredo, "o backend lê o mesmo valor, cru");
  r = run(core.estadoSh(["buffer-mcp"]));
  assert.deepEqual(core.parseEstado(r.stdout)["buffer-mcp"].preenchidas, ["BUFFER_API_KEY"]);
  run(core.credenciaisSh(b, { BUFFER_API_KEY: "" }));
  assert.deepEqual(mb.lerEnv(f), {});
  assert.throws(() => core.credenciaisSh(b, { OUTRA: "x" }), /desconhecida/);
  assert.throws(() => core.credenciaisSh(b, { BUFFER_API_KEY: "a\nb" }), /uma linha/);
});

test("backend: só módulos ligados, do perfil e liberados pela licença; ${VAR} das chaves só no arquivo do turno", () => {
  const base = mkdtempSync(join(tmpdir(), "modulos-base-")); const conf = mkdtempSync(join(tmpdir(), "modulos-conf-"));
  const mod = (id, turno, ligado = true) => { mkdirSync(join(base, id), { recursive: true }); writeFileSync(join(base, id, "turno.json"), JSON.stringify(turno)); if (ligado) writeFileSync(join(base, id, "ligado"), ""); };
  mod("buffer-mcp", { produto: "meu-bot-diego", perfis: ["whatsapp", "agente"], mcp: { buffer: { type: "http", url: "https://mcp.buffer.com/mcp", headers: { Authorization: "Bearer ${BUFFER_API_KEY}" } }, "nome ruim": {} } });
  mod("whatsapp-rene", { produto: "meu-bot-diego", perfis: ["whatsapp"], regras: "regras.md", acao: { padroes: ["^(pode |)(cria|faz)", "[invalida"], maxTurns: 50, adendo: "Execute em silêncio." } });
  writeFileSync(join(base, "whatsapp-rene", "regras.md"), "Responda curto.\n");
  mod("desligado", { produto: "meu-bot-diego", perfis: ["whatsapp"], regras: "regras.md" }, false);
  mod("de-outro", { produto: "meu-bot-outro", perfis: ["*"], mcp: { x: { command: "x" } } });
  writeFileSync(join(conf, "buffer-mcp.env"), "BUFFER_API_KEY=sk-123\n");
  const ok = (p) => p === "meu-bot-diego";
  const w = mb.paraPerfil("whatsapp", ok, { base, conf });
  assert.deepEqual(w.ids, ["buffer-mcp", "whatsapp-rene"]);
  assert.deepEqual(Object.keys(w.mcp), ["buffer"]);
  assert.equal(w.mcp.buffer.headers.Authorization, "Bearer sk-123");
  assert.deepEqual(w.regras, ["Responda curto."]);
  assert.equal(w.acoes.length, 1);
  assert.deepEqual(mb.ajusteDaAcao(w.acoes, "Pode criar a planilha?"), { maxTurns: 50, adendo: "Execute em silêncio." });
  assert.equal(mb.ajusteDaAcao(w.acoes, "tudo bem?"), null);
  assert.deepEqual(mb.paraPerfil("agente", ok, { base, conf }).ids, ["buffer-mcp"]);
  assert.deepEqual(mb.paraPerfil("whatsapp", () => false, { base, conf }).ids, [], "sem o add-on na licença, nada entra");
  const f = mb.arquivoMcp(w.mcp, { base });
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(f, "utf8")).mcpServers.buffer.url, "https://mcp.buffer.com/mcp");
  assert.deepEqual(mb.paraPerfil("whatsapp", ok, { base: join(base, "nao-existe"), conf }).ids, []);
  assert.ok(existsSync(f));
});

test("variante meu-bot-diego-staging: só ela leva os módulos (abre na página Módulos); o add-on está no catálogo e na cópia do backend", () => {
  assert.equal(capsFor("diego-staging").modulos, "meu-bot-diego");
  assert.equal(produtoDe("diego-staging").nome, "meu-bot-diego-staging");
  assert.equal(produtoDe("diego-staging").abreEm, "modulos");
  for (const v of ["client", "client-staging", "finance-staging", "inspector-staging", "admin"]) assert.equal(capsFor(v).modulos, null, v);
  assert.ok(ADDONS.some((a) => a.nome === "meu-bot-diego"));
  // Add-on com módulos por licença só se liga quando o repositório dele existe e foi testado (issue #312).
  assert.deepEqual(ADDONS.filter((a) => a.modulos).map((a) => a.nome), []);
  for (const v of ["client", "diego-staging"]) assert.deepEqual(capsFor(v).addons.map((a) => [a.nome, a.modulos]), ADDONS.map((a) => [a.nome, a.modulos]), v);
  assert.ok(require("../../backend-colima/licenca.js").produtoOk({ plan: "free", status: "active", produtos: ["meu-bot-diego"] }, "meu-bot-diego"));
});

test("ficha do módulo no manifesto: categoria, exemplos, guia (só https), testar e passos válidos; o resto cai", () => {
  const { parseManifesto, lerTeste } = require("../../dist/main/modulos/modulos-core.js");
  const { modulos: [m] } = parseManifesto({ produto: "meu-bot-diego", modulos: [{
    id: "salvy-mcp", versao: "1.0.0", categoria: "Telefonia", exemplos: ["Quanto está a fatura?", "", 3], testar: "testar.sh",
    opcoes: [{ chave: "retornoLogin", tipo: "texto" }],
    guia: { paraQue: "Linhas e faturas", cuidados: ["Confirme antes"], completo: "https://docs.salvy.com.br/mcp-guide" },
    passos: [
      { id: "ligar", titulo: "Ligar", conclui: "ligado" },
      { id: "colar", titulo: "Colar o endereço", conclui: "opcao:retornoLogin" },
      { id: "x", conclui: "rodar-script" }, { id: "ligar", conclui: "manual" }, { id: "y", conclui: "opcao:naoexiste" },
      { id: "perguntar", titulo: "Primeira pergunta", conclui: "manual", pergunta: "Quanto está a fatura?" },
    ],
  }] });
  assert.equal(m.categoria, "Telefonia"); assert.deepEqual(m.exemplos, ["Quanto está a fatura?"]); assert.equal(m.testar, "testar.sh");
  assert.equal(m.guia.completo, "https://docs.salvy.com.br/mcp-guide");
  assert.deepEqual(m.passos.map((p) => p.id), ["ligar", "colar", "perguntar"], "conclui desconhecido, id repetido e opção inexistente caem");
  assert.equal(m.passos[2].botao, "Feito");
  const sem = parseManifesto({ produto: "meu-bot-diego", modulos: [{ id: "a-b", versao: "1.0.0", guia: { completo: "javascript:alert(1)" } }] }).modulos[0];
  assert.equal(sem.guia.completo, null); assert.equal(sem.testar, null); assert.deepEqual(sem.passos, []);
  assert.throws(() => parseManifesto({ produto: "meu-bot-diego", modulos: [{ id: "a-b", versao: "1.0.0", testar: "../x.sh" }] }), /testar/);
  // Saída do testar.sh
  const t = lerTeste(["Testando…", "ferramenta\tlist_phone_accounts\tLista as linhas", "ferramenta\tget_invoice", "ferramenta\tlist_phone_accounts\tdup", "teste=ok"], "2026-11-17T10:00:00Z");
  assert.equal(t.ok, true); assert.deepEqual(t.ferramentas.map((f) => f.nome), ["list_phone_accounts", "get_invoice"]);
  assert.deepEqual(lerTeste(["teste=erro o login venceu"], "x"), { ok: false, em: "x", ferramentas: [], erro: "o login venceu" });
  assert.equal(lerTeste(["caiu no meio"], "x").erro, "caiu no meio", "sem a linha final conta como erro");
});

test("ficha do módulo (renderer): selo, tempo e passos pelo estado", async () => {
  const { situacao, tempoDesde, passoFeito } = await import("../../dist/renderer/modulos/modulos-ficha.js");
  const base = { versao: "1.0.0", desatualizado: false, testar: "testar.sh", teste: null, credenciais: [{ chave: "K" }], estado: { ligado: false, versao: null, preenchidas: [], opcoes: {} } };
  assert.equal(situacao(base).texto, "Desligado");
  const ligado = { ...base, estado: { ...base.estado, ligado: true, versao: "1.0.0", preenchidas: ["K"] } };
  assert.equal(situacao(ligado).texto, "Ligado · não testado");
  assert.equal(situacao({ ...ligado, teste: { ok: true, em: "", ferramentas: [], erro: null } }).texto, "Conectado");
  assert.equal(situacao({ ...ligado, teste: { ok: false, em: "", ferramentas: [], erro: "x" } }).classe, "pill-off");
  assert.equal(situacao({ ...ligado, desatualizado: true, versao: "1.1.0" }).texto, "Atualização disponível (1.1.0)");
  assert.equal(tempoDesde("2026-11-17T10:00:00Z", Date.parse("2026-11-17T13:00:00Z")), "há 3 h");
  assert.equal(passoFeito({ id: "a", conclui: "credenciais" }, base, []), false);
  assert.equal(passoFeito({ id: "a", conclui: "credenciais" }, ligado, []), true);
  assert.equal(passoFeito({ id: "a", conclui: "testado" }, ligado, []), false);
  assert.equal(passoFeito({ id: "a", conclui: "opcao:x" }, { ...ligado, estado: { ...ligado.estado, opcoes: { x: "" } } }, []), false);
  assert.equal(passoFeito({ id: "m", conclui: "manual" }, base, ["m"]), true);
});
