import { test } from "node:test";
import assert from "node:assert/strict";
import { atencaoBackup, resumoBackup } from "../../dist/renderer/conta-google/backup-resumo.js";

const r = (over = {}) => resumoBackup({ lido: true, erroLeitura: false, ligado: true, ultimaEm: null, guardando: false, falhou: false, ...over });
const a = (over = {}) => atencaoBackup({ erroLeitura: false, falhou: false, semSenha: false, guardando: false, restauro: false, ...over });

test("resumoBackup: uma linha para cada estado", () => {
  assert.equal(r({ ultimaEm: "25/11, 14:30" }), "diário · última cópia em 25/11, 14:30");
  assert.equal(r(), "diário · nenhuma cópia ainda");
  assert.equal(r({ ligado: false }), "desligado");
  assert.equal(r({ ligado: false, ultimaEm: "25/11, 14:30" }), "desligado · última cópia em 25/11, 14:30");
  assert.equal(r({ falhou: true }), "diário · nenhuma cópia ainda · a última tentativa falhou");
});

test("resumoBackup: cópia em curso e estado ainda não lido vêm antes de tudo", () => {
  assert.equal(r({ guardando: true, ultimaEm: "25/11, 14:30", falhou: true }), "guardando…");
  assert.equal(r({ lido: false }), "carregando…");
  assert.equal(r({ lido: false, erroLeitura: true }), "não deu para ler o estado");
  assert.equal(r({ lido: false, guardando: true }), "guardando…");
});

test("atencaoBackup: vazio sem motivo; cada motivo muda o texto", () => {
  assert.equal(a(), "");
  assert.equal(a({ semSenha: true }), "sem-senha");
  assert.equal(a({ falhou: true, semSenha: true, guardando: true }), "erro+sem-senha+guardando");
  assert.equal(a({ erroLeitura: true }), "leitura");
  assert.equal(a({ restauro: true }), "restauro");
});
