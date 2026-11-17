import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const P = require("../../dist/main/modulos/modulos-pagina-core.js");
const core = require("../../dist/main/modulos/modulos-core.js");

const base = (pagina) => ({ produto: "meu-bot-finance", modulos: [{ id: "financas", versao: "1.0.0", pagina }] });

test("pagina no manifesto: opcional, validada, e uma página ruim derruba o manifesto com a frase", () => {
  assert.equal(core.parseManifesto(base(undefined)).modulos[0].pagina, null);
  assert.deepEqual(core.parseManifesto(base({ rotulo: "Finanças", porta: 8795 })).modulos[0].pagina, { rotulo: "Finanças", porta: 8795, caminho: "/" });
  assert.deepEqual(core.parseManifesto(base({ rotulo: "Finanças", porta: 8795, caminho: "/app/" })).modulos[0].pagina.caminho, "/app/");
  for (const ruim of [{ porta: 8795 }, { rotulo: "x", porta: 80 }, { rotulo: "x", porta: 70000 }, { rotulo: "x", porta: "8795" }, { rotulo: "x", porta: 8795, caminho: "app" }, { rotulo: "x", porta: 8795, caminho: "/../etc" }, { rotulo: "x", porta: 8795, caminho: "/a?b=1" }, { rotulo: "x", porta: 8795, caminho: "//evil.com" }, "x", []]) {
    assert.throws(() => core.parseManifesto(base(ruim)), /pagina/, JSON.stringify(ruim));
  }
});

test("partição e origem: uma partição por módulo e máquina; só a origem do forward passa", () => {
  assert.equal(P.particaoModulo("financas", "agente box"), "modulo-financas-agente_box");
  assert.notEqual(P.particaoModulo("financas", "a"), P.particaoModulo("financas", "b"));
  const o = P.origemForward(51234);
  assert.equal(P.urlPagina(51234, "/app/", "abc"), "http://127.0.0.1:51234/app/?token=abc");
  assert.equal(P.urlNaOrigem("http://127.0.0.1:51234/qualquer?x=1", o), true);
  for (const u of ["http://127.0.0.1:51235/", "https://127.0.0.1:51234/", "http://localhost:51234/", "http://127.0.0.1:51234@evil.com/", "javascript:alert(1)", "file:///etc/passwd", "lixo"]) assert.equal(P.urlNaOrigem(u, o), false, u);
});

test("status da página: lê token e se o serviço responde; token fora do formato vira null", () => {
  const t = "a".repeat(48);
  assert.deepEqual(P.parsePaginaStatus(`motd\npagina token=${t} rodando=1\n`), { token: t, rodando: true });
  assert.deepEqual(P.parsePaginaStatus("pagina token=- rodando=0"), { token: null, rodando: false });
  assert.deepEqual(P.parsePaginaStatus("pagina token=curto rodando=1"), { token: null, rodando: true });
  assert.equal(P.parsePaginaStatus("nada"), null);
  assert.throws(() => P.paginaStatusSh("../x", 8795));
  assert.throws(() => P.paginaStatusSh("financas", 80));
  assert.throws(() => P.tokenSh("Fin"));
});

test("token na máquina: criado uma vez, 0600, exportado ao instalador; o status o lê e vê a porta no ar", async () => {
  const HOME = mkdtempSync(join(tmpdir(), "pagina-"));
  const env = { ...process.env, HOME };
  const run = (sh) => spawnSync("bash", ["-c", sh], { env, encoding: "utf8" });
  const a = run(`${P.tokenSh("financas")} && echo "arq=$MODULO_PAGINA_TOKEN"`);
  assert.equal(a.status, 0, a.stderr);
  const arq = join(HOME, ".local/share/meu-bot/modulos/financas/pagina.token");
  assert.equal(a.stdout.trim(), `arq=${arq}`);
  const tok = readFileSync(arq, "utf8");
  assert.match(tok, /^[A-Za-z0-9]{48}$/);
  assert.equal(statSync(arq).mode & 0o777, 0o600);
  run(P.tokenSh("financas"));
  assert.equal(readFileSync(arq, "utf8"), tok, "religar não troca o token");
  const srv = createServer().listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  const porta = srv.address().port;
  try {
    const st = P.parsePaginaStatus(run(P.paginaStatusSh("financas", porta < 1024 ? 1024 : porta)).stdout);
    assert.deepEqual(st, { token: tok, rodando: true });
  } finally { srv.close(); }
  const parado = P.parsePaginaStatus(run(P.paginaStatusSh("financas", porta)).stdout);
  assert.equal(parado.rodando, false);
});
