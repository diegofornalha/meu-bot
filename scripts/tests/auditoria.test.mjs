import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const a = createRequire(import.meta.url)("../../dist/main/auditoria/auditoria-core.js");
const PY = join(import.meta.dirname, "..", "..", "backend-colima", "auditoria.py");
const CENTRAL = join(import.meta.dirname, "..", "..", "backend-colima", "meu-bot-auditoria");

const b64 = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
const gravar = (home, e) => execFileSync("python3", [PY, "gravar", b64(e)], { env: { HOME: home, PATH: process.env.PATH, USER: "box" }, encoding: "utf8" }).trim();
const ler = (home, ...args) => execFileSync("python3", [PY, "ler", ...args], { env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8" });

test("catálogo e marcas: texto da tela sai da ação; legado mostra o texto antigo; marca da lista vira ação", () => {
  assert.equal(a.textoDaLinha({ acao: "whatsapp.pausar", alvo: "+5511999990000", detalhe: "" }), "pausou o agente do WhatsApp para +5511999990000");
  assert.equal(a.textoDaLinha({ acao: "whatsapp.dono", alvo: "+5521923670743", detalhe: "" }), "definiu o dono do agente do WhatsApp (+5521923670743)");
  assert.equal(a.textoDaLinha({ acao: "legado", alvo: "", detalhe: "reiniciou o gateway" }), "reiniciou o gateway");
  assert.equal(a.textoDaLinha({ acao: "skill.importar", alvo: "minha-skill", detalhe: "fulano/minha-skill, commit abc1234" }), "importou a skill minha-skill pelo link do repositório");
  assert.equal(a.textoDaLinha({ acao: "skill.atualizar", alvo: "minha-skill", detalhe: "" }), "atualizou a skill importada minha-skill");
  assert.equal(a.textoDaLinha({ acao: "skill.remover", alvo: "minha-skill", detalhe: "" }), "removeu a skill importada minha-skill");
  assert.equal(a.acaoDaMarca({ deleted: true, archived: false }), "whatsapp.excluir");
  assert.equal(a.acaoDaMarca({ deleted: false }), "whatsapp.restaurar");
  assert.equal(a.acaoDaMarca({ archived: true, at: "2026-10-17T02:10:00Z" }), null, "migração não registra");
  assert.equal(a.acaoDaMarca({ name: "Junior" }), null, "cache de nome não registra");
  const sh = a.auditoriaSh("print(1)", { quem: { tipo: "dono", nome: "Ana'; rm -rf /" }, app: "meu-bot", acao: "whatsapp.limpar", alvo: "+55" });
  assert.match(sh, /^python3 - gravar '[A-Za-z0-9_-]+' <<'MEUBOT_AUDITORIA_PY'\nprint\(1\)\nMEUBOT_AUDITORIA_PY$/, "o nome vai em base64, nunca no shell");
});

test("auditoria.py: importa o suporte.log antigo, grava em corrente (Python e TS selam igual) e acusa adulteração", () => {
  const home = mkdtempSync(join(tmpdir(), "mb-aud-"));
  mkdirSync(join(home, ".local", "share", "meu-bot"), { recursive: true });
  writeFileSync(join(home, ".local", "share", "meu-bot", "suporte.log"), "2026-10-16T12:00:00Z|admin|reiniciou o gateway do OpenClaw\n2026-10-16T12:05:00Z|Ana|ligou o acesso do admin\n");
  const l1 = JSON.parse(gravar(home, { quem: { tipo: "admin", nome: "Lucas" }, app: "meu-bot-admin", acao: "whatsapp.pausar", alvo: "+5511999990000" }));
  gravar(home, { quem: { tipo: "dono", nome: "Ana Lúcia" }, app: "meu-bot-crm-staging", acao: "whatsapp.excluir", alvo: "+5511999990000", detalhe: "linha\ncom quebra" });
  assert.ok(existsSync(join(home, ".local", "share", "meu-bot", "suporte.log.importado")));
  const linhas = a.parseLinhas(ler(home));
  assert.equal(linhas.length, 4);
  assert.deepEqual(linhas.map((x) => x.linha.quem.tipo), ["legado", "legado", "admin", "dono"]);
  assert.match(l1.maquina, /^[0-9a-f]{12}$/);
  assert.equal(linhas[3].linha.detalhe, "linha com quebra", "sem quebra de linha no registro");
  assert.equal(linhas[3].linha.app, "meu-bot-crm-staging", "o canal staging aparece no registro");
  assert.equal(a.quebraDaCorrente(linhas.map((x) => x.bruto)), null, "corrente íntegra (o selo do Python confere no TS)");
  assert.equal(a.parseLinhas(ler(home, "--n", "1"))[0].linha.quem.nome, "Ana Lúcia");
  assert.equal(a.parseLinhas(ler(home, "--apos", l1.hash)).length, 1, "só o que veio depois");
  // Entrada fora do catálogo de tipos ou ação malformada: recusa.
  assert.throws(() => gravar(home, { quem: { tipo: "root", nome: "x" }, app: "meu-bot", acao: "whatsapp.pausar" }));
  assert.throws(() => gravar(home, { quem: { tipo: "dono", nome: "x" }, app: "meu-bot", acao: "rm -rf" }));
  // Adulteração: apagar uma linha do meio quebra a corrente ali; mudar um texto também.
  const arq = join(home, ".local", "share", "meu-bot", "auditoria.jsonl");
  const txt = readFileSync(arq, "utf8").trim().split("\n");
  assert.equal(a.quebraDaCorrente(a.parseLinhas([txt[0], txt[2], txt[3]].join("\n")).map((x) => x.bruto)), 1);
  assert.equal(a.quebraDaCorrente(a.parseLinhas([txt[0], txt[1], txt[2].replace("pausar", "retomar"), txt[3]].join("\n")).map((x) => x.bruto)), 2);
});

test("meu-bot-auditoria (central): carimba quem entregou pela chave, não duplica, só o super admin lê, corrente própria", () => {
  const maquina = mkdtempSync(join(tmpdir(), "mb-audm-"));
  for (const acao of ["whatsapp.pausar", "whatsapp.retomar", "whatsapp.limpar"]) gravar(maquina, { quem: { tipo: "admin", nome: "Teste" }, app: "meu-bot-admin", acao, alvo: "+5511999990000" });
  const linhas = ler(maquina);
  const central = mkdtempSync(join(tmpdir(), "mb-audc-"));
  const run = (papel, nome, op, input = "") => execFileSync("python3", [CENTRAL, papel, nome], { env: { HOME: central, PATH: process.env.PATH, ...(op ? { SSH_ORIGINAL_COMMAND: op } : {}) }, input, encoding: "utf8" }).trim();
  assert.equal(run("admin", "Teste", "gravar", linhas.split("\n").slice(0, 2).join("\n")), "ok 2");
  assert.equal(run("maquina", "pessoas", "", linhas), "ok 1", "as duas primeiras já estavam; o pedido vazio é gravar");
  assert.throws(() => run("admin", "Teste", "maquinas"), "admin não lê");
  assert.throws(() => run("maquina", "pessoas", "ler abc123def456"), "a chave das pessoas não lê");
  assert.throws(() => run("admin", "Teste", "rm -rf ~"), "operação desconhecida");
  assert.throws(() => run("admin", "Teste", "gravar", "não é json\n"));
  const lista = run("super", "Lucas", "maquinas").split("\n").map((l) => JSON.parse(l));
  assert.equal(lista.length, 1); assert.equal(lista[0].registros, 3);
  const reg = a.parseCentral(run("super", "Lucas", `ler ${lista[0].maquina}`));
  assert.deepEqual(reg.map((r) => `${r.registro.via.papel}:${r.registro.via.nome}`), ["admin:Teste", "admin:Teste", "maquina:pessoas"]);
  assert.equal(a.quebraDaCorrente(reg.map((r) => r.bruto)), null);
  // Conferência: a máquina perdeu a 2ª linha → a central acusa o que falta e a corrente da máquina quebra.
  const m = a.parseLinhas(linhas).map((x) => x.bruto);
  const c = a.conferir([m[0], m[2]], reg.map((r) => r.bruto));
  assert.equal(c.faltamNaMaquina.length, 1); assert.equal(c.maquinaQuebraEm, 1); assert.equal(c.centralQuebraEm, null);
});
