// App derivado: a ficha vem do repositório dele (produto.json), não da tabela PRODUTOS. Aqui, o contrato da ficha
// (o que aceita e o que recusa) e o caminho até as capacidades, que é o que o app faz ao abrir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { releasesUrl, UPDATE_REPO } = createRequire(import.meta.url)("../../dist/main/atualizacao/updater-core.js");
const { parseFichaExterna, fichaEmbutida, registrarDerivado, produtoDe, capsFor, titleFor, userDataNameFor, resolveVariant, produtosDoCore, PRODUTOS, esquemaDe, ESQUEMA_RE } = createRequire(import.meta.url)("../../dist/main/app/variant-core.js");

const FICHA = { nome: "meu-bot-vendas-staging", bundleId: "local.meu-bot-vendas.staging", canal: "staging", portaLocal: 8840, portaWsl: 2340, portaMcp: 7840, herdaDe: "meu-bot-staging", abreEm: "modulos", modulos: "meu-bot-vendas", descricao: "O meu-bot das vendas." };
const erro = (f) => { const r = parseFichaExterna(f); assert.equal(r.ok, false, JSON.stringify(f)); return r.erro; };

test("ficha de derivado: vira um app da pessoa com nome, bundle, dados e portas próprios", () => {
  const r = parseFichaExterna(FICHA);
  assert.equal(r.ok, true, r.erro);
  const p = r.produto;
  assert.equal(p.variant, "derivado");
  assert.deepEqual([p.nome, p.bundleId, p.userData, p.canal, p.herdaDe, p.abreEm], ["meu-bot-vendas-staging", "local.meu-bot-vendas.staging", "meu-bot-vendas-staging", "staging", "meu-bot-staging", "modulos"]);
  assert.deepEqual([p.portaLocal, p.portaWsl, p.portaMcp], [8840, 2340, 7840]);
  // O que não é da ficha vem do meu-bot: as extensões e a licença. Sem .dmg, sem Windows, sem fundir pasta antiga.
  const base = PRODUTOS.find((x) => x.variant === "client");
  assert.deepEqual(p.extensoes, base.extensoes);
  assert.deepEqual([p.licenca, p.fundeDe, p.instalador, p.windows, p.icone], ["meu-bot", null, false, false, "assets/icon.icns"]);
  assert.deepEqual({ ...p.caps }, { ...base.caps, modulos: "meu-bot-vendas" });
  assert.match(esquemaDe(p), ESQUEMA_RE, "o nome serve de esquema do deep link");
  // Só o obrigatório: o resto tem padrão.
  const minimo = parseFichaExterna({ nome: "meu-bot-x", bundleId: "local.meu-bot-x", canal: "staging", portaLocal: 8841, portaWsl: 2341, portaMcp: 7841 });
  assert.equal(minimo.ok, true, minimo.erro);
  assert.deepEqual([minimo.produto.herdaDe, minimo.produto.abreEm, minimo.produto.caps.modulos, minimo.produto.caps.inspector, minimo.produto.caps.extensao, minimo.produto.addon, minimo.produto.descricao], [null, null, null, false, null, null, ""]);
});

test("ficha de derivado: recusa o que colide com o core ou não é do contrato, dizendo o campo", () => {
  for (const ruim of [null, "x", [], 7]) assert.match(erro(ruim), /objeto/);
  assert.match(erro({ ...FICHA, portaMpc: 1 }), /campo desconhecido "portaMpc"/, "nome de campo trocado não passa calado");
  for (const nome of ["vendas", "meu-bot-", "meu-bot-Vendas", "meu-bot-vendas staging", "meu-bot--x", "meu-bot-a-b-c-d-e-f-g", `meu-bot-${"x".repeat(31)}`, "../meu-bot-x", 7]) assert.match(erro({ ...FICHA, nome }), /^nome:/);
  // Nome, licença, add-on e bundle id do core são do core.
  for (const nome of ["meu-bot-staging", "meu-bot-admin-gestao", "meu-bot-admin", "meu-bot-crm", "meu-bot-finance"]) assert.match(erro({ ...FICHA, nome }), /já é de um app do core/);
  assert.match(erro({ ...FICHA, nome: "meu-bot" }), /^nome:/);
  assert.match(erro({ ...FICHA, bundleId: "local.meu-bot.staging" }), /bundleId: .* já é de um app do core/);
  assert.match(erro({ ...FICHA, bundleId: "meu bot" }), /^bundleId:/);
  for (const canal of ["beta", "estavel", undefined]) assert.match(erro({ ...FICHA, canal }), /^canal:/, "só o canal de teste por enquanto");
  // Portas: número válido e nenhuma das do core no mesmo papel (dois apps abertos juntos não dividem porta).
  for (const campo of ["portaLocal", "portaWsl", "portaMcp"]) {
    for (const v of [80, 70000, 8840.5, "8840", undefined]) assert.match(erro({ ...FICHA, [campo]: v }), new RegExp(`^${campo}:`));
    for (const p of produtosDoCore()) assert.match(erro({ ...FICHA, [campo]: p[campo] }), new RegExp(`^${campo}: .* já é de um app do core`), `${campo} do ${p.nome}`);
  }
  assert.match(erro({ ...FICHA, herdaDe: "meu-bot-admin-gestao" }), /^herdaDe:/, "só de um app da pessoa");
  assert.match(erro({ ...FICHA, herdaDe: "outro-app" }), /^herdaDe:/);
  assert.match(erro({ ...FICHA, abreEm: "config" }), /^abreEm:/);
  assert.match(erro({ ...FICHA, modulos: "vendas" }), /^modulos:/);
  assert.match(erro({ ...FICHA, inspector: "sim" }), /^inspector:/);
  assert.match(erro({ ...FICHA, addon: "meu-bot-nao-existe" }), /^addon:/);
  assert.match(erro({ ...FICHA, descricao: "x".repeat(301) }), /^descricao:/);
});

test("derivado ao abrir: a ficha embutida no pacote é registrada e dela saem título, pasta de dados e capacidades", () => {
  try {
    for (const sem of [undefined, null]) assert.equal(fichaEmbutida(sem), null, "app da tabela: não há ficha no pacote");
    assert.equal(fichaEmbutida({ ...FICHA, portaMcp: 7830 }), null, "ficha recusada não abre como derivado");
    for (const lixo of ["x", 3, []]) assert.equal(fichaEmbutida(lixo), null);
    // "derivado" não é uma variante que o app aceite pelo variant.json nem pelo ambiente: só a ficha embutida no asar faz um derivado.
    assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: { variant: "derivado" } }), "client");
    assert.equal(resolveVariant({ packaged: false, env: "derivado", variantJson: undefined }), "client");
    assert.throws(() => produtoDe("derivado"), /sem ficha/);

    const p = fichaEmbutida(FICHA);
    assert.equal(p.nome, "meu-bot-vendas-staging");
    registrarDerivado(p);
    assert.equal(produtoDe("derivado"), p);
    assert.equal(titleFor("derivado", "1.2.3-staging.4"), "meu-bot-vendas-staging 1.2.3-staging.4");
    assert.equal(userDataNameFor("derivado"), "meu-bot-vendas-staging");
    const c = capsFor("derivado", "1.2.3-staging.4", "darwin");
    assert.deepEqual([c.variant, c.nome, c.produto, c.canal, c.abreEm, c.modulos, c.chat, c.install, c.controleRemoto], ["derivado", "meu-bot-vendas-staging", "meu-bot", "staging", "modulos", "meu-bot-vendas", true, true, true]);
    // As capacidades do derivado são as do meu-bot-staging, fora o que a ficha escolhe.
    const base = capsFor("client-staging", "1.2.3-staging.4", "darwin");
    for (const k of Object.keys(base)) if (!["variant", "nome", "titulo", "abreEm", "modulos", "addon"].includes(k)) assert.deepEqual(c[k], base[k], k);
  } finally { registrarDerivado(null); }
});

test("o derivado antigo que resta na tabela já cabe numa ficha de fora (a saída dele do core não muda nome, bundle, dados nem portas)", () => {
  const antigos = PRODUTOS.filter((p) => !produtosDoCore().includes(p));
  assert.deepEqual(antigos.map((p) => p.nome).sort(), ["meu-bot-inspector-staging"], "o meu-bot-diego-staging já saiu");
  for (const a of antigos) {
    const r = parseFichaExterna({ nome: a.nome, bundleId: a.bundleId, canal: a.canal, portaLocal: a.portaLocal, portaWsl: a.portaWsl, portaMcp: a.portaMcp, herdaDe: a.herdaDe, abreEm: a.abreEm, modulos: a.caps.modulos, inspector: a.caps.inspector, addon: a.addon, descricao: a.descricao });
    assert.equal(r.ok, true, `${a.nome}: ${r.erro}`);
    const p = r.produto;
    for (const k of ["nome", "bundleId", "userData", "canal", "licenca", "herdaDe", "portaLocal", "portaWsl", "portaMcp", "fundeDe", "addon", "instalador", "windows", "abreEm", "descricao"]) assert.deepEqual(p[k], a[k], `${a.nome}.${k}`);
    assert.deepEqual({ ...p.caps }, { ...a.caps }, `${a.nome}.caps`);
    assert.deepEqual(p.extensoes, a.extensoes);
  }
});

test("releases do derivado: a ficha diz o repositório, e é nele que o atualizador procura; sem dizer, vale o do core", () => {
  // Todo app da tabela publica no repositório do core.
  for (const p of PRODUTOS) assert.equal(p.repoReleases, null, p.nome);
  assert.equal(parseFichaExterna(FICHA).produto.repoReleases, null);
  const r = parseFichaExterna({ ...FICHA, releases: "diegofornalha/meu-bot-vendas-app" });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.produto.repoReleases, "diegofornalha/meu-bot-vendas-app");
  // Só "dono/repositório": nada que mude o caminho da URL da API.
  for (const ruim of ["meu-bot-vendas", "https://github.com/a/b", "a/b/c", "a/..", "../b", "a/b?x=1", "a /b", "a/b#c", "-a/b", "", 7, {}]) assert.match(erro({ ...FICHA, releases: ruim }), /^releases:/, String(ruim));

  assert.equal(releasesUrl("staging"), `https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=30`);
  assert.equal(releasesUrl("staging", null), releasesUrl("staging"));
  assert.equal(releasesUrl("estavel", null), `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`);
  assert.equal(releasesUrl("staging", r.produto.repoReleases), "https://api.github.com/repos/diegofornalha/meu-bot-vendas-app/releases?per_page=30");
  assert.equal(releasesUrl("estavel", r.produto.repoReleases), "https://api.github.com/repos/diegofornalha/meu-bot-vendas-app/releases/latest");
});

test("contrato da ficha: a ficha do modelo público e a de um derivado publicado continuam valendo (mudar o core não pode quebrá-las)", () => {
  // Cópias exatas do produto.json de github.com/diegofornalha/meu-bot-derivado-modelo e de um derivado já publicado.
  // Os derivados moram fora deste repositório e são reempacotados a cada staging do core: se uma mudança aqui fizer
  // estas fichas serem recusadas, a release deles para (ficam na versão anterior). Este teste falha antes disso. Para
  // mudar o contrato, a ficha antiga tem de continuar aceita, ou a mudança tem de chegar junto aos repositórios deles.
  const modelo = { nome: "meu-bot-exemplo-staging", bundleId: "local.meu-bot-exemplo.staging", canal: "staging", portaLocal: 8840, portaWsl: 2340, portaMcp: 7840, herdaDe: null, abreEm: null, modulos: null, addon: null, releases: "diegofornalha/meu-bot-derivado-modelo", descricao: "Troque esta frase pelo que o seu app é, em até 300 caracteres." };
  const publicado = { nome: "meu-bot-diego-staging", bundleId: "local.meu-bot-diego.staging", canal: "staging", portaLocal: 8794, portaWsl: 2294, portaMcp: 7836, herdaDe: "meu-bot-staging", abreEm: "modulos", modulos: "meu-bot-diego", addon: "meu-bot-diego", releases: "diegofornalha/meu-bot-diego-app", descricao: "O meu-bot em teste com os módulos do Diego na frente." };
  for (const ficha of [modelo, publicado]) {
    const r = parseFichaExterna(ficha);
    assert.equal(r.ok, true, `${ficha.nome}: ${r.erro}`);
    assert.deepEqual([r.produto.nome, r.produto.bundleId, r.produto.userData, r.produto.repoReleases], [ficha.nome, ficha.bundleId, ficha.nome, ficha.releases]);
    assert.deepEqual([r.produto.portaLocal, r.produto.portaWsl, r.produto.portaMcp], [ficha.portaLocal, ficha.portaWsl, ficha.portaMcp]);
  }
});
