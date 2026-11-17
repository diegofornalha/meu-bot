// A checagem do túnel sem master (Windows): o backend responde pela porta local? Qualquer resposta HTTP vale; porta
// fechada e conexão que aceita e não responde (o forward com a conexão SSH morta) não valem.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createRequire } from "node:module";

const { backendResponde } = createRequire(import.meta.url)("../../dist/main/maquina/backend-responde.js");
import { readFileSync } from "node:fs";
const escutar = (srv) => new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv.address().port)));
const fechar = (srv) => new Promise((ok) => srv.close(ok));

test("responde: 200 no /health e também um 404 (qualquer resposta prova o caminho)", async () => {
  const pedidos = [];
  const srv = http.createServer((req, res) => { pedidos.push(req.url); res.writeHead(req.url === "/health" ? 200 : 404).end("{}"); });
  const porta = await escutar(srv);
  try {
    assert.equal(await backendResponde(porta, 2000), true);
    assert.deepEqual(pedidos, ["/health"]);
  } finally { await fechar(srv); }
  const srv404 = http.createServer((_req, res) => { res.writeHead(404).end(); });
  const p2 = await escutar(srv404);
  try { assert.equal(await backendResponde(p2, 2000), true); } finally { await fechar(srv404); }
});

test("não responde: porta fechada", async () => {
  const srv = net.createServer();
  const porta = await escutar(srv);
  await fechar(srv);
  assert.equal(await backendResponde(porta, 2000), false);
});

test("não responde: a porta aceita a conexão e fica muda (forward com a conexão SSH morta)", async () => {
  const abertos = [];
  const srv = net.createServer((s) => { abertos.push(s); });
  const porta = await escutar(srv);
  try {
    const t0 = Date.now();
    assert.equal(await backendResponde(porta, 300), false);
    assert.ok(Date.now() - t0 < 2000, "desiste no tempo pedido");
  } finally { for (const s of abertos) s.destroy(); await fechar(srv); }
});

test("o script da pausa do Hermes vai pela entrada sem que um comando dele possa engolir o resto", () => {
  // hostProbe.ts importa o Electron: confere-se a fonte. O comando lê tudo com `cat` e roda com a entrada em /dev/null.
  const fonte = readFileSync(new URL("../../src/main/maquina/hostProbe.ts", import.meta.url), "utf8");
  assert.ok(fonte.includes(`export const BASH_PELA_ENTRADA = 'S=$(cat); exec bash -c "$S" </dev/null';`));
  assert.match(fonte, /"--", host, BASH_PELA_ENTRADA\], 3 \* 60_000, say, hermesPausaPluginSh\(/);
});
