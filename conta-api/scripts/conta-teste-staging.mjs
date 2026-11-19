#!/usr/bin/env node
// Contas de teste no D1 do STAGING (conta-staging), com rastro na auditoria.
//
//   node scripts/conta-teste-staging.mjs listar
//   node scripts/conta-teste-staging.mjs criar [--vence-em-horas N]   (padrão 72; negativo = teste já vencido)
//   node scripts/conta-teste-staging.mjs remover <id | e-mail>
//
// Só fala com o banco conta-staging (o nome e o ambiente são fixos aqui: não há como apontar para produção) e só
// toca contas `promo-teste-<8 hex>@example.com`. Criar e remover gravam em `auditoria`.
// A conta criada aqui existe só no banco: o Firebase não a conhece, então ela não entra pela página de login nem
// aceita senha. Para testar login e senha, crie a conta entrando pelo auth-staging de verdade.
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BANCO = "conta-staging";
export const AMBIENTE = "staging";
const EMAIL_RE = /^promo-teste-[0-9a-f]{8}@example\.com$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const QUEM_RE = /^[A-Za-z0-9._-]{1,64}$/;
const FILTRO_TESTE = "email LIKE 'promo-teste-%@example.com'";
/** Tabelas com linhas da conta, na ordem em que saem (a de `contas` por último). */
const TABELAS_DA_CONTA = ["sessoes", "codigos_login", "pagamento_checkouts", "pagamentos", "assinaturas", "addons_pagos", "pedidos", "devices", "maquinas", "membros", "licencas"];

export const emailDeTeste = (v) => typeof v === "string" && EMAIL_RE.test(v);
export const idDeConta = (v) => typeof v === "string" && UUID_RE.test(v);
/** Quem aparece na auditoria: o usuário do sistema que rodou o script. */
export function quemRodou(usuario) {
  if (typeof usuario !== "string" || !QUEM_RE.test(usuario)) throw new Error("usuário do sistema fora do formato para a auditoria");
  return `script:conta-teste-staging:${usuario}`;
}
/** Os argumentos do wrangler: sempre o banco e o ambiente de staging. */
export function argsWrangler(sql) {
  return ["wrangler", "d1", "execute", BANCO, "--env", AMBIENTE, "--remote", "--json", "--command", sql];
}
export function sqlListar() {
  return `SELECT id, email, criada_em FROM contas WHERE ${FILTRO_TESTE} ORDER BY criada_em`;
}
/** O SELECT que acha a conta a remover: por id ou e-mail, e só entre as de teste. */
export function sqlAchar(alvo) {
  if (emailDeTeste(alvo)) return `SELECT id, email FROM contas WHERE email = '${alvo}' AND ${FILTRO_TESTE}`;
  if (idDeConta(alvo)) return `SELECT id, email FROM contas WHERE id = '${alvo}' AND ${FILTRO_TESTE}`;
  throw new Error("informe o id (uuid) ou o e-mail promo-teste-<8 hex>@example.com da conta de teste");
}
export function sqlCriar({ id, tag, agora, venceEm, quem }) {
  if (!idDeConta(id) || !/^[0-9a-f]{8}$/.test(tag)) throw new Error("id ou tag fora do formato");
  const email = `promo-teste-${tag}@example.com`;
  return [
    `INSERT INTO contas (id, firebase_uid, email, email_verificado, nome, criada_em, atualizada_em) VALUES ('${id}','teste-promo-${tag}','${email}',1,'Conta de teste (só no banco)','${agora}','${agora}')`,
    `INSERT INTO licencas (conta_id, plan, status, member_since, trial_end, expires_at, updated_at, updated_by) VALUES ('${id}','pro','trialing','${agora}','${venceEm}','${venceEm}','${agora}','${quem}')`,
    `INSERT INTO auditoria (quando, quem, acao, conta_id, detalhe) VALUES ('${agora}','${quem}','conta-teste.criada','${id}','${email}; teste até ${venceEm}; só no banco, sem Firebase')`,
  ].join("; ");
}
export function sqlRemover({ id, email, agora, quem }) {
  if (!idDeConta(id) || !emailDeTeste(email)) throw new Error("só contas promo-teste-<8 hex>@example.com são removidas por aqui");
  return [
    ...TABELAS_DA_CONTA.map((t) => `DELETE FROM ${t} WHERE conta_id = '${id}'`),
    `DELETE FROM contas WHERE id = '${id}' AND ${FILTRO_TESTE}`,
    `INSERT INTO auditoria (quando, quem, acao, conta_id, detalhe) VALUES ('${agora}','${quem}','conta-teste.removida','${id}','${email}; linhas da conta apagadas do banco')`,
  ].join("; ");
}

function d1(sql) {
  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const saida = execFileSync("npx", argsWrangler(sql), { cwd: raiz, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const lotes = JSON.parse(saida.slice(saida.indexOf("[")));
  return lotes.map((l) => l.results ?? []);
}

function principal(argv) {
  const [acao, ...resto] = argv;
  const agora = new Date();
  if (acao === "listar") { console.table(d1(sqlListar())[0]); return; }
  if (acao === "criar") {
    const i = resto.indexOf("--vence-em-horas");
    const horas = i === -1 ? 72 : Number(resto[i + 1]);
    if (!Number.isFinite(horas)) throw new Error("--vence-em-horas: um número (negativo = já vencido)");
    const id = randomUUID(), tag = randomBytes(4).toString("hex");
    const venceEm = new Date(agora.getTime() + horas * 3600_000).toISOString();
    d1(sqlCriar({ id, tag, agora: agora.toISOString(), venceEm, quem: quemRodou(userInfo().username) }));
    console.log(`criada: promo-teste-${tag}@example.com (${id}), teste até ${venceEm}. Só no banco: não entra pelo login nem aceita senha.`);
    return;
  }
  if (acao === "remover") {
    const [achada] = d1(sqlAchar(resto[0]))[0];
    if (achada === undefined) throw new Error(`nenhuma conta de teste com "${resto[0]}" no ${BANCO}`);
    const membroDona = d1(`SELECT slug FROM organizacoes WHERE dona_conta_id = '${achada.id}'`)[0];
    if (membroDona.length > 0) throw new Error(`a conta é dona de organização (${membroDona.map((o) => o.slug).join(", ")}); apague a organização antes`);
    d1(sqlRemover({ id: achada.id, email: achada.email, agora: agora.toISOString(), quem: quemRodou(userInfo().username) }));
    console.log(`removida: ${achada.email} (${achada.id}). Registrado na auditoria.`);
    return;
  }
  throw new Error("uso: conta-teste-staging.mjs listar | criar [--vence-em-horas N] | remover <id | e-mail>");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { principal(process.argv.slice(2)); } catch (e) { console.error(`erro: ${e?.message ?? e}`); process.exit(1); }
}
