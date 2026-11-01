import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Fonte única das versões dos motores: backend-colima/motor-versoes.sh (scripts) e o espelho em TS (app). Na VM agente
// (1 nov) o plugin do WhatsApp sem versão resolvia 2026.10.9 num OpenClaw 2026.9.9 e recusava instalar; o prompt ao
// agente mandava `openclaw@latest`. Aqui os quatro lugares têm de dizer a mesma coisa, e "latest" não entra.
const RAIZ = join(import.meta.dirname, "..", "..");
const ler = (p) => readFileSync(join(RAIZ, p), "utf8");
const v = createRequire(import.meta.url)("../../dist/main/maquina/motor-versoes.js");

const lerSh = (txt) => { const o = {}; for (const m of txt.matchAll(/^([A-Z_]+)=(\S+)$/gm)) o[m[1]] = m[2]; return o; };

test("motor-versoes.sh e motor-versoes.ts dizem as mesmas versões (e só CHAVE=valor no .sh)", () => {
  const sh = ler("backend-colima/motor-versoes.sh");
  const vars = lerSh(sh);
  assert.deepEqual(vars, { OPENCLAW_VERSAO: v.OPENCLAW_VERSAO, OPENCLAW_WA_PLUGIN_VERSAO: v.OPENCLAW_WA_PLUGIN_VERSAO, HERMES_VERSAO: v.HERMES_VERSAO, MOTOR_NODE: v.MOTOR_NODE });
  for (const l of sh.split("\n")) assert.ok(l === "" || l.startsWith("#") || /^[A-Z_]+=\S+$/.test(l), `linha que não é comentário nem CHAVE=valor: ${l}`);
  for (const x of [v.OPENCLAW_VERSAO, v.OPENCLAW_WA_PLUGIN_VERSAO, v.HERMES_VERSAO]) assert.match(x, /^\d+\.\d+\.\d+$/);
  assert.match(v.MOTOR_NODE, /^v\d+\.\d+\.\d+$/);
});

test("install-grok-oauth.sh, o Hermes de todos e o pedido ao agente usam as versões fixadas", () => {
  assert.equal(/^HERMES_VERSION=(\S+)$/m.exec(ler("backend-colima/install-grok-oauth.sh"))?.[1], v.HERMES_VERSAO);
  const { HERMES_VERSAO } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.equal(HERMES_VERSAO, v.HERMES_VERSAO);
  const prompt = ler("src/renderer/whatsapp/agente-whatsapp.ts");
  assert.equal(/npm install -g openclaw@(\S+)`/.exec(prompt)?.[1], v.OPENCLAW_VERSAO, "o pedido instala o OpenClaw na versão fixada");
  assert.equal(/clawhub:@openclaw\/whatsapp@([\d.]+)/.exec(prompt)?.[1], v.OPENCLAW_WA_PLUGIN_VERSAO, "o pedido instala o plugin na versão fixada");
  assert.equal(/hermes-agent@([\d.]+)/.exec(prompt)?.[1], v.HERMES_VERSAO);
});

const arquivos = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) arquivos(p, out); else if (/\.(ts|js|mjs|sh|py)$/.test(n)) out.push(p);
  }
  return out;
};

test("nenhum motor como latest e nenhum plugin do WhatsApp sem versão em src/ e backend-colima/", () => {
  const ruins = [];
  for (const p of [...arquivos(join(RAIZ, "src")), ...arquivos(join(RAIZ, "backend-colima"))]) {
    const txt = readFileSync(p, "utf8");
    for (const [i, l] of txt.split("\n").entries()) {
      if (/openclaw@latest|hermes-agent@latest/.test(l) || /plugins install\s+(?:"?clawhub:)?@openclaw\/whatsapp(?![@\w-])/.test(l)) ruins.push(`${relative(RAIZ, p)}:${i + 1}`);
    }
  }
  assert.deepEqual(ruins, []);
});
