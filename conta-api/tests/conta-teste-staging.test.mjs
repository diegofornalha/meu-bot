// Script das contas de teste do staging (scripts/conta-teste-staging.mjs): as travas e o rastro na auditoria.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AMBIENTE, BANCO, argsWrangler, emailDeTeste, quemRodou, sqlAchar, sqlCriar, sqlRemover } from "../scripts/conta-teste-staging.mjs";

const ID = "5d5c0bcd-a92c-441a-854d-27bf7cae1f12";
const base = { id: ID, agora: "2026-11-18T00:00:00.000Z", quem: quemRodou("fulano") };

test("o wrangler é sempre chamado no banco e no ambiente de staging", () => {
  const args = argsWrangler("SELECT 1");
  assert.equal(BANCO, "conta-staging");
  assert.equal(args[args.indexOf("--env") + 1], AMBIENTE);
  assert.equal(AMBIENTE, "staging");
  assert.ok(args.includes(BANCO) && !args.includes("conta"));
});

test("só e-mails promo-teste-<8 hex>@example.com são de teste", () => {
  assert.equal(emailDeTeste("promo-teste-0613dc2c@example.com"), true);
  for (const e of ["alguem@gmail.com", "promo-teste-xyz@example.com", "promo-teste-0613dc2c@example.com' OR 1=1 --", "x-promo-teste-0613dc2c@example.com", null]) assert.equal(emailDeTeste(e), false, String(e));
});

test("achar e remover recusam conta que não é de teste", () => {
  assert.throws(() => sqlAchar("alguem@gmail.com"));
  assert.throws(() => sqlAchar("' OR 1=1 --"));
  assert.throws(() => sqlRemover({ ...base, email: "alguem@gmail.com" }));
  assert.throws(() => sqlRemover({ ...base, id: "nao-e-uuid", email: "promo-teste-0613dc2c@example.com" }));
  assert.match(sqlAchar(ID), /email LIKE 'promo-teste-%@example\.com'/);
});

test("remover apaga as sessões e a conta (só se for de teste) e grava a auditoria", () => {
  const sql = sqlRemover({ ...base, email: "promo-teste-0613dc2c@example.com" });
  assert.match(sql, /DELETE FROM sessoes WHERE conta_id = '5d5c0bcd/);
  assert.match(sql, /DELETE FROM contas WHERE id = '5d5c0bcd[^;]+AND email LIKE 'promo-teste-%@example\.com'/);
  assert.match(sql, /INSERT INTO auditoria [^;]+'script:conta-teste-staging:fulano','conta-teste\.removida'/);
});

test("criar grava a conta, a licença e a auditoria", () => {
  const sql = sqlCriar({ ...base, tag: "0613dc2c", venceEm: "2026-11-21T00:00:00.000Z" });
  assert.match(sql, /INSERT INTO contas [^;]+'promo-teste-0613dc2c@example\.com'/);
  assert.match(sql, /INSERT INTO licencas /);
  assert.match(sql, /'conta-teste\.criada'/);
  assert.throws(() => sqlCriar({ ...base, tag: "'; DROP", venceEm: "x" }));
});

test("quem rodou entra na auditoria só se for um nome simples", () => {
  assert.throws(() => quemRodou("a'b"));
});
