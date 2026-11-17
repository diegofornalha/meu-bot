// Lista de espera do site: leitura do contato (e-mail ou WhatsApp) e das listas fechadas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cliqueValido, lerContato, origemLista, plataformaValida } from "../dist/lista-core.js";

test("lerContato: e-mail vira minúsculo; inválido é null", () => {
  assert.deepEqual(lerContato("  Fulano.Silva+teste@Empresa.com.BR "), { tipo: "email", contato: "fulano.silva+teste@empresa.com.br" });
  for (const x of ["a@b", "a@@b.com", "a b@c.com", "a..b@c.com", "@c.com", "a@.com", `${"a".repeat(120)}@c.com`]) assert.equal(lerContato(x), null, x);
});

test("lerContato: WhatsApp do Brasil como a pessoa escreve, sempre com 55 na frente", () => {
  for (const x of ["(11) 99999-1234", "11999991234", "+55 11 99999-1234", "5511999991234", "011 99999 1234"]) assert.deepEqual(lerContato(x), { tipo: "whatsapp", contato: "5511999991234" }, x);
  assert.deepEqual(lerContato("(16) 3333-4444"), { tipo: "whatsapp", contato: "551633334444" }, "fixo com DDD");
  for (const x of ["99999-1234", "1199999123", "119999912345", "(01) 99999-1234", "11 19999-1234", "abc", "", "   ", 5, null, undefined, "11999991234; drop"]) assert.equal(lerContato(x), null, String(x));
});

test("plataforma, origem e código do clique: listas fechadas e formato", () => {
  assert.equal(plataformaValida("windows"), true);
  for (const x of ["linux", "", null, 1]) assert.equal(plataformaValida(x), false);
  assert.equal(origemLista("hero"), "hero"); assert.equal(origemLista("obrigado"), "obrigado");
  for (const x of ["<script>", "", null, 7]) assert.equal(origemLista(x), "site");
  assert.equal(cliqueValido("Cj0KCQiA_abc-DEF123"), "Cj0KCQiA_abc-DEF123");
  for (const x of ["curto", "tem espaço dentro aqui", `${"a".repeat(201)}`, null, 5]) assert.equal(cliqueValido(x), null);
});
