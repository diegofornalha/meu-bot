// Modo "sugere e você aprova", lado do app: o pedido da tela, a chamada da CLI da guarda (rodada de verdade, numa casa
// temporária com um `openclaw` de mentira) e os textos da lista.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SEM_SUGESTOES, erroDaAcao, lerSaida, parseSugestaoComando, parseSugestoes, sugestoesSh } from "../../dist/main/whatsapp/whatsapp-sugestoes-core.js";
import { haQuanto, numeroDoDestino, resumoDoModo, rotuloComContador } from "../../dist/renderer/lib/sugestoes-view.js";
import { guardar, mudarModo } from "../../backend-colima/guarda/sugestoes.mjs";

const GUARDA = join(import.meta.dirname, "..", "..", "backend-colima", "guarda");
const ANA = "+5511988887777";

test("parseSugestaoComando: só o que a tela pode pedir", () => {
  assert.deepEqual(parseSugestaoComando({ acao: "ligar" }), { acao: "ligar" });
  assert.deepEqual(parseSugestaoComando({ acao: "aprovar", id: "abc123def456" }), { acao: "aprovar", id: "abc123def456" });
  assert.deepEqual(parseSugestaoComando({ acao: "aprovar", id: "abc123def456", texto: "  oi  " }), { acao: "aprovar", id: "abc123def456", texto: "oi" });
  assert.deepEqual(parseSugestaoComando({ acao: "descartar", id: "todas" }), { acao: "descartar", id: "todas" });
  for (const ruim of [null, "ligar", {}, { acao: "listar" }, { acao: "aprovar" }, { acao: "aprovar", id: "todas" }, { acao: "aprovar", id: "a; rm -rf ~" }, { acao: "aprovar", id: "abc123def456", texto: "   " }, { acao: "aprovar", id: "abc123def456", texto: "x".repeat(4001) }, { acao: "descartar", id: "$(id)" }]) assert.equal(parseSugestaoComando(ruim), null, JSON.stringify(ruim));
});

test("parseSugestoes e erroDaAcao: a resposta da máquina, saneada", () => {
  assert.deepEqual(parseSugestoes(null), SEM_SUGESTOES);
  assert.deepEqual(parseSugestoes("indisponivel"), SEM_SUGESTOES);
  const r = parseSugestoes({ ligado: true, desde: "2026-11-20T10:00:00.000Z", pendentes: 3, sugestoes: [
    { id: "bbbbbbbbbbbb", para: ANA, texto: "segunda", em: "2026-11-20T10:05:00.000Z" },
    { id: "aaaaaaaaaaaa", para: "120363041234567890@g.us", texto: "primeira", em: "2026-11-20T10:01:00.000Z", sessao: "x" },
    { id: "x", para: ANA, texto: "id curto", em: "2026-11-20T10:01:00.000Z" }, { id: "cccccccccccc", para: "<script>", texto: "destino estranho", em: "2026-11-20T10:01:00.000Z" }, { id: "dddddddddddd", para: ANA, texto: "", em: "2026-11-20T10:01:00.000Z" }, "lixo",
  ] });
  assert.equal(r.disponivel, true); assert.equal(r.ligado, true);
  assert.deepEqual(r.sugestoes.map((s) => s.texto), ["primeira", "segunda"], "em ordem de chegada, sem o que não é sugestão");
  assert.deepEqual(Object.keys(r.sugestoes[0]), ["id", "para", "texto", "em"], "a chave de sessão não vai para a tela");
  assert.equal(erroDaAcao({ ok: true, id: "aaaaaaaaaaaa" }), null);
  assert.equal(erroDaAcao({ ligado: true, desde: null, pendentes: 0 }), null);
  assert.match(erroDaAcao({ erro: "o WhatsApp não mandou: gateway fora do ar" }), /gateway fora do ar/);
  assert.match(erroDaAcao("indisponivel"), /reinstale a guarda/);
  assert.match(erroDaAcao(null), /não respondeu/);
  assert.equal(lerSaida("ruído\nsugestoes={\"ligado\":false}\n", "sugestoes").ligado, false);
  assert.equal(lerSaida("sugestoes=isto não é json", "sugestoes"), null);
});

// A casa de mentira: a guarda instalada onde o instalador a põe e um `openclaw` que anota o que mandaria.
function casa({ envioFalha = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "sugestoes-app-")), dados = join(home, ".local", "share", "meu-bot"), bin = join(home, ".openclaw", "bin");
  mkdirSync(join(dados, "guarda"), { recursive: true }); mkdirSync(bin, { recursive: true });
  cpSync(join(GUARDA, "sugestoes.mjs"), join(dados, "guarda", "sugestoes.mjs"));
  writeFileSync(join(bin, "openclaw"), envioFalha ? "#!/bin/sh\necho 'gateway fora do ar' >&2\nexit 1\n" : `#!/bin/sh\nprintf '%s\\n' "$@" > "$HOME/enviado.txt"\n`);
  chmodSync(join(bin, "openclaw"), 0o755);
  const rodar = (c) => execFileSync("/bin/bash", ["-s"], { input: sugestoesSh(c), env: { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` }, encoding: "utf8" });
  return { home, dados, rodar };
}

test("sugestoesSh na máquina: liga, lista, aprova com o texto editado (o envio sai pelo openclaw) e descarta", () => {
  const c = casa();
  try {
    assert.deepEqual(parseSugestoes(lerSaida(c.rodar({ acao: "listar" }), "sugestoes")), { disponivel: true, ligado: false, desde: null, sugestoes: [] });
    const ligou = c.rodar({ acao: "ligar" });
    assert.equal(erroDaAcao(lerSaida(ligou, "acao")), null);
    assert.equal(parseSugestoes(lerSaida(ligou, "sugestoes")).ligado, true);
    const a = guardar(c.dados, { para: ANA, texto: "Posso te ligar às 15h?" }), b = guardar(c.dados, { para: ANA, texto: "Segue o orçamento." });
    assert.equal(parseSugestoes(lerSaida(c.rodar({ acao: "listar" }), "sugestoes")).sugestoes.length, 2);
    // Texto com aspas, cifrão e quebra de linha: vai em base64url, o shell não o interpreta.
    const editado = `Oi Ana! "Às 15h" serve? $(touch ${join(c.home, "invadido")})\nAbraço`;
    const aprovou = c.rodar({ acao: "aprovar", id: a.id, texto: editado });
    assert.equal(erroDaAcao(lerSaida(aprovou, "acao")), null);
    assert.deepEqual(parseSugestoes(lerSaida(aprovou, "sugestoes")).sugestoes.map((s) => s.id), [b.id], "a aprovada saiu da fila");
    assert.equal(readFileSync(join(c.home, "enviado.txt"), "utf8"), `message\nsend\n--channel\nwhatsapp\n--target\n${ANA}\n-m\n${editado}\n`);
    assert.equal(existsSync(join(c.home, "invadido")), false);
    const descartou = c.rodar({ acao: "descartar", id: b.id });
    assert.equal(erroDaAcao(lerSaida(descartou, "acao")), null);
    assert.deepEqual(parseSugestoes(lerSaida(descartou, "sugestoes")).sugestoes, []);
    assert.match(erroDaAcao(lerSaida(c.rodar({ acao: "aprovar", id: a.id }), "acao")), /não encontrada/);
  } finally { rmSync(c.home, { recursive: true, force: true }); }
});

test("sugestoesSh: envio que falha deixa a sugestão na fila; máquina sem a guarda nova responde indisponível", () => {
  const c = casa({ envioFalha: true });
  try {
    mudarModo(c.dados, true);
    const a = guardar(c.dados, { para: ANA, texto: "oi" });
    const r = c.rodar({ acao: "aprovar", id: a.id });
    assert.match(erroDaAcao(lerSaida(r, "acao")), /o WhatsApp não mandou: gateway fora do ar/);
    assert.deepEqual(parseSugestoes(lerSaida(r, "sugestoes")).sugestoes.map((s) => s.id), [a.id]);
    rmSync(join(c.dados, "guarda"), { recursive: true });
    const sem = c.rodar({ acao: "ligar" });
    assert.match(erroDaAcao(lerSaida(sem, "acao")), /reinstale a guarda/);
    assert.deepEqual(parseSugestoes(lerSaida(sem, "sugestoes")), SEM_SUGESTOES);
  } finally { rmSync(c.home, { recursive: true, force: true }); }
});

test("os textos da lista", () => {
  const agora = Date.parse("2026-11-20T12:00:00Z");
  assert.equal(haQuanto("2026-11-20T11:59:40Z", agora), "agora");
  assert.equal(haQuanto("2026-11-20T11:55:00Z", agora), "há 5 min");
  assert.equal(haQuanto("2026-11-20T09:30:00Z", agora), "há 2 h");
  assert.equal(haQuanto("2026-11-17T12:00:00Z", agora), "há 3 d");
  assert.equal(haQuanto("lixo", agora), "agora");
  assert.equal(numeroDoDestino(ANA), "5511988887777");
  assert.equal(numeroDoDestino("120363041234567890@g.us"), null);
  assert.equal(resumoDoModo(true, 0), "Modo sugestão ligado · nenhuma sugestão esperando");
  assert.equal(resumoDoModo(true, 1), "Modo sugestão ligado · 1 sugestão esperando você");
  assert.equal(resumoDoModo(false, 0), "Modo sugestão desligado");
  assert.equal(resumoDoModo(false, 2), "Modo sugestão desligado · 2 sugestões esperando você");
  assert.equal(rotuloComContador(0), "WhatsApp"); assert.equal(rotuloComContador(3), "WhatsApp · 3"); assert.equal(rotuloComContador(250), "WhatsApp · 99+");
});
