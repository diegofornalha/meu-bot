import { test } from "node:test";
import assert from "node:assert/strict";
import { acharItem, achatar } from "../../dist/main/app/menu-aberto-core.js";

const cliques = [];
const item = (label, enabled = true) => ({ label, enabled, click: () => cliques.push(label) });
const MOLDE = [item("Renomear"), item("Duplicar", false), { label: "Exportar", submenu: [item("Markdown (.md)"), item("JSON (.json)")] }, { type: "separator" }, { label: "Título sem clique" }, item("Fechar aba")];

test("achatar: caminho pelos submenus, sem separador; desligado e sem clique não se escolhem", () => {
  const p = achatar(MOLDE);
  assert.deepEqual(p.map((x) => [x.rotulo, x.habilitado, x.clicar !== null]), [
    ["Renomear", true, true], ["Duplicar", false, true], ["Exportar › Markdown (.md)", true, true], ["Exportar › JSON (.json)", true, true], ["Título sem clique", true, false], ["Fechar aba", true, true],
  ]);
});

test("acharItem: pelo rótulo inteiro ou pelo fim do caminho; o que não existe ou está desligado é erro que explica", () => {
  const p = achatar(MOLDE);
  acharItem(p, "renomear").clicar(); acharItem(p, "Markdown (.md)").clicar(); acharItem(p, "Exportar › JSON (.json)").clicar();
  assert.deepEqual(cliques, ["Renomear", "Markdown (.md)", "JSON (.json)"]);
  assert.throws(() => acharItem(p, "Excluir"), /não tem "Excluir": Renomear; Duplicar/);
  assert.throws(() => acharItem(p, "Duplicar"), /desligado/);
  assert.throws(() => acharItem(p, "Título sem clique"), /desligado/);
});
