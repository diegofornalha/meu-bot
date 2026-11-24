import assert from "node:assert/strict";
import { test } from "node:test";
import { ehPerfilClaude, lerProvedores, matizDoModelo, modeloDeRecuo, modelosDaMaquina, nomeDeModeloValido, recuoDoTurno, rotuloDoModelo, serveDeReserva, tempoLimiteMs, trocaPendente } from "../../dist/shared/modelos.js";

const CLAUDE = ["claudecode", "agente", "rene-dm", "rene"];
const nomes = (l) => l.map((m) => m.nome);

test("lista por máquina: os perfis do Claude e depois os provedores que o backend informa, com o rótulo deles", () => {
  const provedores = lerProvedores([
    { name: "agente", type: "claude", available: true, reserva: true },
    { name: "motor-x", type: "openai", available: true, reserva: false, rotulo: "Motor X", modulo: "motor-x-modulo" },
    { name: "ollama-local", type: "openai", available: true, reserva: true },
    { name: "sem-chave", type: "openai", available: false, reserva: true },
  ]);
  const l = modelosDaMaquina({ provedores });
  assert.deepEqual(nomes(l), [...CLAUDE, "motor-x", "ollama-local", "sem-chave"]);
  assert.deepEqual(l.find((m) => m.nome === "motor-x"), { nome: "motor-x", rotulo: "Motor X", claude: false, disponivel: true });
  assert.equal(l.find((m) => m.nome === "ollama-local").rotulo, "ollama-local", "sem rótulo vale o nome");
  assert.equal(l.find((m) => m.nome === "sem-chave").disponivel, false, "a máquina conhece, mas não responde agora");
  assert.ok(l.filter((m) => m.claude).every((m) => m.disponivel && CLAUDE.includes(m.nome)));
  assert.equal(rotuloDoModelo("motor-x", provedores), "Motor X");
  assert.equal(rotuloDoModelo("agente", provedores), "agente");
  assert.equal(rotuloDoModelo("motor-x", null), "motor-x");
  // Um provedor não toma o lugar de um perfil do Claude, nem aparece duas vezes.
  assert.deepEqual(nomes(modelosDaMaquina({ provedores: lerProvedores([{ name: "rene", type: "openai", available: true }, { name: "motor-x", type: "openai", available: true }, { name: "motor-x", type: "openai", available: true }]) })), [...CLAUDE, "motor-x"]);
});

test("backend antigo: o /status sem reserva nem rótulo vale como sempre (reserva verdadeira, rótulo = nome)", () => {
  const antigos = lerProvedores([{ name: "agente", type: "claude", available: true }, { name: "outro-motor", type: "openai", available: true }]);
  assert.deepEqual(antigos, [{ name: "agente", type: "claude", available: true, reserva: true }, { name: "outro-motor", type: "openai", available: true, reserva: true }]);
  assert.ok(antigos.every(serveDeReserva));
  assert.equal(serveDeReserva({}), true);
  assert.equal(serveDeReserva({ reserva: false }), false);
  assert.deepEqual(nomes(modelosDaMaquina({ provedores: antigos })), [...CLAUDE, "outro-motor"]);
  // Lixo no campo não derruba nada: o que não é provedor fica de fora.
  assert.deepEqual(lerProvedores(undefined), []);
  assert.deepEqual(lerProvedores("x"), []);
  assert.deepEqual(lerProvedores([null, 3, { name: "Nome Ruim", type: "openai" }, { type: "openai" }, { name: "ok", type: "openai", available: "sim", rotulo: "  ", modulo: 5 }]), [{ name: "ok", type: "openai", available: false, reserva: true }]);
});

test("sem o /status ainda: valem os modelos da sondagem da abertura, e o modelo da conversa não some", () => {
  assert.deepEqual(nomes(modelosDaMaquina({ provedores: null })), CLAUDE);
  assert.deepEqual(nomes(modelosDaMaquina({ provedores: null, anunciados: ["claudecode", "agente", "outro-motor", "Nome Ruim"] })), [...CLAUDE, "outro-motor"]);
  const antes = modelosDaMaquina({ provedores: null, atual: "motor-x" });
  assert.deepEqual(antes.at(-1), { nome: "motor-x", rotulo: "motor-x", claude: false, disponivel: true }, "ainda não se sabe: fica escolhido, sem alarme");
  // /status de antes de existir o campo `providers` (lista vazia) também é "não se sabe".
  assert.deepEqual(nomes(modelosDaMaquina({ provedores: [], anunciados: ["outro-motor"] })), [...CLAUDE, "outro-motor"]);
  // Com o /status na mão, a sondagem (anterior, pode estar velha) não inventa modelo.
  assert.deepEqual(nomes(modelosDaMaquina({ provedores: lerProvedores([{ name: "agente", type: "claude", available: true }]), anunciados: ["outro-motor"] })), CLAUDE);
});

test("modelo que sumiu: continua na lista da conversa que o usa, marcado como indisponível, e o turno tem para onde voltar", () => {
  const provedores = lerProvedores([{ name: "agente", type: "claude", available: true }]);
  const l = modelosDaMaquina({ provedores, atual: "motor-x" });
  assert.deepEqual(l.at(-1), { nome: "motor-x", rotulo: "motor-x", claude: false, disponivel: false });
  assert.deepEqual(nomes(modelosDaMaquina({ provedores, atual: "agente" })), CLAUDE, "perfil do Claude não duplica");
  assert.deepEqual(nomes(modelosDaMaquina({ provedores, atual: null })), CLAUDE);
  assert.equal(modeloDeRecuo("motor-x", "agente"), "agente");
  assert.equal(modeloDeRecuo("motor-x", "ollama-local"), "ollama-local", "volta para o padrão da máquina");
  assert.equal(modeloDeRecuo("motor-x", "motor-x"), "agente", "o padrão da máquina é o próprio que sumiu");
  assert.equal(modeloDeRecuo("agente", "agente"), null, "sem para onde voltar: o erro segue como veio");
});

test("nome de modelo: a mesma regra de nome de provedor do backend", () => {
  for (const ok of ["agente", "rene-dm", "ollama-local", "motor-x", "4o", "a".repeat(41)]) assert.equal(nomeDeModeloValido(ok), true, ok);
  for (const ruim of ["", "Agente", "-x", "a b", "a_b", "a/b", "a".repeat(42), 3, null, undefined, {}]) assert.equal(nomeDeModeloValido(ruim), false, String(ruim));
  assert.equal(ehPerfilClaude("agente"), true);
  assert.equal(ehPerfilClaude("ollama-local"), false);
  assert.equal(ehPerfilClaude("motor-x"), false);
});

test("cor e tempo-limite saem de regra, sem tabela por nome de provedor", () => {
  // Os modos que vêm com o app guardam a cor de sempre.
  assert.deepEqual(["agente", "claudecode", "rene-dm", "rene", "ollama-local"].map(matizDoModelo), [145, 220, 330, 270, 190]);
  // Um provedor qualquer ganha uma matiz estável, derivada do nome.
  for (const n of ["motor-x", "outro-motor", "a"]) {
    const h = matizDoModelo(n);
    assert.ok(Number.isInteger(h) && h >= 0 && h < 360, `${n}: ${h}`);
    assert.equal(matizDoModelo(n), h);
  }
  assert.notEqual(matizDoModelo("motor-x"), matizDoModelo("outro-motor"));
  // Só o chat puro do Claude é curto; quem tem ferramentas ou pode cair para a reserva tem o tempo longo.
  assert.equal(tempoLimiteMs("claudecode"), 120_000);
  for (const n of ["agente", "rene", "rene-dm", "ollama-local", "motor-x"]) assert.equal(tempoLimiteMs(n), 600_000, n);
});

test("turno com o modelo que sumiu: recua uma vez, só no model_not_found e só antes de qualquer resposta", () => {
  const e = { codigo: "model_not_found", modelo: "motor-x", padraoDaMaquina: "agente", parcial: "", cancelado: false, jaRecuou: false };
  assert.equal(recuoDoTurno(e), "agente");
  assert.equal(recuoDoTurno({ ...e, padraoDaMaquina: "motor-x" }), "agente", "o padrão da máquina é o que sumiu");
  assert.equal(recuoDoTurno({ ...e, parcial: " \n" }), "agente", "espaço em branco não é resposta");
  assert.equal(recuoDoTurno({ ...e, jaRecuou: true }), null, "a segunda tentativa não recua de novo: sem laço");
  assert.equal(recuoDoTurno({ ...e, cancelado: true }), null);
  assert.equal(recuoDoTurno({ ...e, parcial: "Olá" }), null);
  assert.equal(recuoDoTurno({ ...e, modelo: "agente" }), null, "sem para onde voltar");
  for (const codigo of ["model_limit", "auth", undefined, null, 404]) assert.equal(recuoDoTurno({ ...e, codigo }), null, String(codigo));
});

test("nota de troca no recuo: o novo modelo fica sabendo de quem foram as respostas anteriores", () => {
  // Conversa nova (sem histórico): nada a avisar.
  assert.equal(trocaPendente("motor-x", "agente", undefined, false), undefined);
  // O motor-x respondeu antes e sumiu: o agente recebe "trocou de motor-x para agente".
  assert.deepEqual(trocaPendente("motor-x", "agente", undefined, true), { from: "motor-x", to: "agente" });
  // A pessoa tinha acabado de trocar agente → motor-x (nota pendente, que o turno devolve) e ele não existe: voltar ao agente desfaz a nota.
  assert.equal(trocaPendente("motor-x", "agente", { from: "agente", to: "motor-x" }, true), undefined);
  // Idem, mas o recuo é outro modelo: a origem continua sendo quem respondeu de fato.
  assert.deepEqual(trocaPendente("motor-x", "ollama-local", { from: "agente", to: "motor-x" }, true), { from: "agente", to: "ollama-local" });
});
