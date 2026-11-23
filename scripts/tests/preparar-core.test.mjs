import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { lerPreparar, passosPreparar, pacotesSh, GH_GLOBAL_SH, PREPARAR_ESTADO_SH, ORDEM_PREPARAR, PACOTES_BASE, PACOTES_TELA } = createRequire(import.meta.url)("../../dist/main/admin/preparar-core.js");
const { COTA_ESTADO_SH, HERMES_ESTADO_SH, OPENCLAW_ESTADO_SH, openclawGlobalSh } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");

const todos = [...PACOTES_BASE, ...PACOTES_TELA, "chromium"];
const pacotes = (faltam = []) => todos.map((p) => `${p}=${faltam.includes(p) ? 0 : 1}`).join(" ");
const saida = (o = {}) => [
  "ROOT", `RAM=${o.ram ?? 32000000}`, `SWAP=${o.swap ?? 8388604}`, `COTA=${o.cota ?? 1}`, `LLMNR=${o.llmnr ?? "off"}`, `RESERVA=${o.reserva ?? 1}`, `SEMISO=${o.semiso ?? ""}`,
  `PACOTES=${o.pacotes ?? pacotes()}`, `GH=${o.gh ?? "2.103.3"}`, `HERMES=${o.hermes ?? "global"}`, `TRANSCRITOR=${o.transcritor ?? 1}`, `OPENCLAW=${o.openclaw ?? "global"}`, `OCLEVE=${o.ocleve ?? "2 2"}`, `CONTEXTO=${o.contexto ?? "2 2"}`, `CG=${o.cg ?? "1 1 1"}`, `OG=${o.og ?? "1 1 1"}`, `LP=${o.lp ?? "1 1 1 1 agentesgrok.com"}`, `OS=${o.os ?? "debian"}`,
].join("\n") + "\n";

test("preparar: máquina pronta → tudo ok, nada a aplicar; NAOROOT → root=false", () => {
  const v = lerPreparar(saida());
  assert.equal(v.root, true);
  assert.deepEqual(v.itens.map((i) => [i.id, i.estado]), [["swap", "ok"], ["cota", "ok"], ["governanca", "ok"], ["llmnr", "ok"], ["pacotes", "ok"], ["gh", "ok"], ["hermes", "ok"], ["transcritor", "ok"], ["openclaw", "ok"], ["openclaw-leve", "ok"], ["claude-global", "ok"], ["ollama", "ok"], ["contexto", "ok"], ["link-publico", "ok"], ["chromium", "ok"]]);
  assert.deepEqual(v.faltam, []);
  assert.equal(v.ramKb, 32000000);
  assert.match(v.itens.find((i) => i.id === "link-publico").detalhe, /agentesgrok\.com/);
  assert.equal(lerPreparar("NAOROOT\n").root, false);
  assert.deepEqual(lerPreparar("NAOROOT\n").itens, []);
});

test("preparar: faltas saem na ordem de dependência, com o detalhe; o Chromium é opcional e fica fora de faltam", () => {
  const v = lerPreparar(saida({ swap: 0, cota: 0, reserva: 0, semiso: "box-1 box-2", pacotes: pacotes(["ffmpeg", "xvfb", "chromium"]), gh: "", hermes: "sem-transcritor", transcritor: 0 }));
  assert.deepEqual(v.faltam, ["swap", "cota", "governanca", "pacotes", "gh", "transcritor"]);
  const por = Object.fromEntries(v.itens.map((i) => [i.id, i]));
  assert.match(por.pacotes.detalhe, /^faltam: ffmpeg, xvfb$/);
  assert.match(por.governanca.detalhe, /sem reserva.*sem isolamento: box-1, box-2/);
  assert.equal(por.hermes.estado, "ok"); assert.equal(por.transcritor.estado, "falta");
  assert.equal(por.chromium.estado, "falta"); assert.equal(por.chromium.opcional, true);
  assert.deepEqual(v.semIsolamento, ["box-1", "box-2"]);
  // Hermes só no root e sem transcritor: os dois faltam.
  const r = lerPreparar(saida({ hermes: "root", transcritor: 0 }));
  assert.equal(r.itens.find((i) => i.id === "hermes").estado, "falta"); assert.equal(r.itens.find((i) => i.id === "transcritor").estado, "falta");
  // O transcritor não depende do Hermes: máquina só com OpenClaw o tem (é ele que liga a transcrição sem ffmpeg).
  const oc = lerPreparar(saida({ hermes: "nenhum", transcritor: 1 }));
  assert.equal(oc.itens.find((i) => i.id === "transcritor").estado, "ok"); assert.match(oc.itens.find((i) => i.id === "transcritor").detalhe, /OpenClaw e Hermes/);
  // Hermes global mas transcritor de antes do transcrever-texto: falta, com o detalhe de reaplicar.
  const velho = lerPreparar(saida({ hermes: "global", transcritor: 0 }));
  assert.equal(velho.itens.find((i) => i.id === "transcritor").estado, "falta"); assert.match(velho.itens.find((i) => i.id === "transcritor").detalhe, /aplicar de novo/);
});

test("preparar: Claude Global e Link Público (humano aponta a aba; link nunca entra em faltam); Chromium no Ubuntu é humano", () => {
  const cg = (s) => lerPreparar(saida({ cg: s })).itens.find((i) => i.id === "claude-global");
  assert.equal(cg("0 0 0").estado, "falta"); assert.equal(cg("1 1 0").estado, "humano"); assert.equal(cg("1 0 1").estado, "falta"); assert.equal(cg("1 1 1").estado, "ok");
  assert.equal(cg("1 1 0").pagina, "claude-global");
  const lp = (s) => lerPreparar(saida({ lp: s })).itens.find((i) => i.id === "link-publico");
  assert.equal(lp("0 0 0 0").estado, "humano"); assert.equal(lp("1 0 0 0 d.com").estado, "humano"); assert.equal(lp("1 1 0 0 d.com").estado, "humano"); assert.equal(lp("1 1 1 0 d.com").estado, "humano"); assert.equal(lp("1 1 1 1 d.com").estado, "ok");
  assert.equal(lp("0 0 0 0").pagina, "link-publico");
  assert.ok(!lerPreparar(saida({ lp: "0 0 0 0" })).faltam.includes("link-publico"));
  const ub = lerPreparar(saida({ os: "ubuntu", pacotes: pacotes(["chromium"]) })).itens.find((i) => i.id === "chromium");
  assert.equal(ub.estado, "humano"); assert.match(ub.detalhe, /snap/);
});

test("preparar: passos na ordem, só do que falta; governança vira reserva e/ou isolamento; claude-global sem script; chromium só pedido", () => {
  const v = lerPreparar(saida({ swap: 0, cota: 0, reserva: 0, semiso: "box-2", pacotes: pacotes(["jq", "chromium"]), gh: "", hermes: "nenhum", transcritor: 0, cg: "0 0 0" }));
  const p = passosPreparar(["chromium", "transcritor", "gh", "link-publico", "inventado", "swap", "cota", "governanca", "pacotes", "hermes", "claude-global"], v);
  assert.deepEqual(p.map((x) => x.titulo), ["Memória de reserva (swap de 8 GB)", "Cota de disco por usuário", "Reserva de memória para o sistema", "Isolamento das boxes", "Pacotes do sistema (jq, ffmpeg e a tela do bot)", "GitHub CLI para todos (/usr/local/bin/gh)", "Hermes para todos (/opt/hermes)", "Transcritor de áudio para todos (/opt/transcriber)", "Claude Code Global", "Navegador na tela do bot (Chromium)"]);
  assert.deepEqual(p.map((x) => x.acao), ["maquina.swap", "maquina.cota", "maquina.reserva", "maquina.isolamento", "maquina.pacotes", "maquina.gh", "maquina.hermes-global", "maquina.transcritor", "maquina.claude-global", "maquina.pacotes"]);
  for (const x of p) if (x.sh !== null) assert.match(x.sh, /^\[ "\$\(id -u\)" = 0 \]/, x.titulo);
  assert.equal(p.find((x) => x.id === "claude-global").sh, null);
  assert.match(p[2].sh, /set-property user\.slice MemoryMax=28125M/);
  assert.equal(p[2].alvo("RESERVA=ok 28125\n"), "28125");
  assert.equal(p[4].alvo("PACOTES=ok 1 jq\n"), "jq");
  // Só isolamento quando a reserva já existe; sem RAM lida, a reserva não entra; chromium não pedido não entra.
  const v2 = lerPreparar(saida({ reserva: 1, semiso: "box-1" }));
  assert.deepEqual(passosPreparar(["governanca"], v2).map((x) => x.titulo), ["Isolamento das boxes"]);
  const v3 = lerPreparar(saida({ reserva: 0 }).replace(/^RAM=.*\n/m, ""));
  assert.deepEqual(passosPreparar(["governanca"], v3), []);
  assert.deepEqual(passosPreparar(v.faltam, v).map((x) => x.id).includes("chromium"), false);
  // No Ubuntu o chromium é humano: pedir não gera passo.
  assert.deepEqual(passosPreparar(["chromium"], lerPreparar(saida({ os: "ubuntu", pacotes: pacotes(["chromium"]) }))), []);
});

test("preparar: pacotesSh valida nomes e protege contra o lock do apt; GH_GLOBAL_SH vai para /usr/local/bin sem a API", () => {
  assert.throws(() => pacotesSh(["jq; rm -rf /"]), /inválido/);
  assert.throws(() => pacotesSh([]), /inválido/);
  const sh = pacotesSh(["jq", "ffmpeg"]);
  assert.match(sh, /DPkg::Lock::Timeout=120/); assert.match(sh, /dpkg --configure -a/); assert.match(sh, /--no-install-recommends install \$F/); assert.match(sh, /PACOTES=ok/); assert.match(sh, /dpkg-query -W -f='\$\{Status\}'/);
  assert.match(GH_GLOBAL_SH, /install -m 755 "\$T"\/gh_\*\/bin\/gh \/usr\/local\/bin\/gh/); assert.match(GH_GLOBAL_SH, /GH=ok/);
  assert.doesNotMatch(GH_GLOBAL_SH, /\$HOME\/\.local/); assert.doesNotMatch(GH_GLOBAL_SH, /api\.github\.com/);
  assert.match(GH_GLOBAL_SH, /releases\/latest/); assert.match(GH_GLOBAL_SH, /gh_\$\{V\}_linux_\$\{A\}\.tar\.gz/);
});

test("preparar: o script de estado começa pelo guard de root, reaproveita os trechos de cota e Hermes e tem uma chave por item", () => {
  assert.match(PREPARAR_ESTADO_SH, /^\[ "\$\(id -u\)" = 0 \] \|\| \{ echo "NAOROOT"; exit 0; \}/);
  assert.ok(PREPARAR_ESTADO_SH.includes(COTA_ESTADO_SH)); assert.ok(PREPARAR_ESTADO_SH.includes(HERMES_ESTADO_SH)); assert.ok(PREPARAR_ESTADO_SH.includes(OPENCLAW_ESTADO_SH));
  for (const k of ["RAM=", "SWAP=", "LLMNR=", "RESERVA=", "SEMISO=", "PACOTES=", "GH=", "TRANSCRITOR=", "OCLEVE=", "CONTEXTO=", "CG=", "OG=", "LP=", "OS="]) assert.ok(PREPARAR_ESTADO_SH.includes(k), k);
  assert.match(PREPARAR_ESTADO_SH, /\/usr\/local\/bin\/gh --version/); assert.match(PREPARAR_ESTADO_SH, /dpkg-query/);
  assert.deepEqual([...ORDEM_PREPARAR], ["swap", "cota", "governanca", "llmnr", "pacotes", "gh", "hermes", "transcritor", "openclaw", "openclaw-leve", "claude-global", "ollama", "contexto", "chromium"]);
});

test("preparar: modo grátis para todos é opcional (não entra no 'aplicar o que falta'), e o passo vai por scp com 40 min", () => {
  const og = (s) => lerPreparar(saida({ og: s })).itens.find((i) => i.id === "ollama");
  assert.deepEqual([og("0 0 0").estado, og("0 0 0").opcional], ["falta", true]);
  assert.match(og("0 0 0").detalhe, /cada conta baixa/);
  assert.match(og("1 0 0").detalhe, /parado/);
  assert.match(og("1 1 0").detalhe, /sem o modelo/);
  assert.equal(og("1 1 1").estado, "ok");
  // Saída de um admin antigo, sem a chave OG=: falta, sem quebrar a leitura.
  assert.equal(lerPreparar(saida().replace(/^OG=.*\n/m, "")).itens.find((i) => i.id === "ollama").estado, "falta");
  const v = lerPreparar(saida({ og: "0 0 0" }));
  assert.deepEqual(v.faltam, [], "opcional não entra no que falta");
  const p = passosPreparar(["ollama"], v);
  assert.deepEqual([p[0].id, p[0].sh, p[0].timeoutMs, p[0].acao], ["ollama", null, 40 * 60_000, "maquina.ollama-global"]);
  assert.ok(p[0].ok.test("OLLAMA_GLOBAL=ok 18760\n"));
});

test("preparar: OpenClaw para todos ao lado do Hermes (o app é agnóstico de motor): só no root ou em nenhum lugar → falta; passo como root com a versão fixada", () => {
  const por = (o) => Object.fromEntries(lerPreparar(saida(o)).itens.map((i) => [i.id, i]));
  assert.equal(por({}).openclaw.estado, "ok"); assert.match(por({}).openclaw.detalhe, /\/opt\/openclaw/);
  assert.equal(por({ openclaw: "root" }).openclaw.estado, "falta"); assert.match(por({ openclaw: "root" }).openclaw.detalhe, /só o root/);
  assert.equal(por({ openclaw: "nenhum" }).openclaw.estado, "falta");
  const v = lerPreparar(saida({ openclaw: "nenhum" }));
  assert.deepEqual(v.faltam, ["openclaw"]);
  const p = passosPreparar(["openclaw"], v);
  assert.equal(p.length, 1); assert.equal(p[0].acao, "maquina.openclaw-global"); assert.match(p[0].sh, /^\[ "\$\(id -u\)" = 0 \]/);
  assert.equal(p[0].alvo("OPENCLAW=ok 2026.9.9\n"), "2026.9.9");
  const sh = openclawGlobalSh();
  for (const trecho of ["D=/opt/openclaw", "W=/usr/local/bin/openclaw", "nodejs.org/dist/$NV/node-$NV-linux-$a.tar.gz", "npm install -g --prefix \"$D\" \"openclaw@$V\"", "chmod -R a+rX \"$D\"", "meu-bot-openclaw-global", "runuser -u nobody", "OPENCLAW=ok $V", "for p in ffmpeg python3-venv; do dpkg-query -W -f='${Status}'", "install -y -q --no-install-recommends \"$p\""]) assert.ok(sh.includes(trecho), trecho);
  assert.ok(!sh.includes("latest"));
  // A ordem: depois do Hermes e do transcritor, antes do Claude Global.
  assert.deepEqual(ORDEM_PREPARAR.slice(ORDEM_PREPARAR.indexOf("transcritor"), ORDEM_PREPARAR.indexOf("transcritor") + 4), ["transcritor", "openclaw", "openclaw-leve", "claude-global"]);
});

test("preparar: o Criar usuário não instala o OpenClaw (a conta nova usa o Hermes; o OpenClaw só pelo botão da aba)", () => {
  const { faltamAoCriarUsuario } = createRequire(import.meta.url)("../../dist/main/admin/preparar-core.js");
  const v = lerPreparar(saida({ transcritor: 0, openclaw: "nenhum" }));
  assert.deepEqual(v.faltam, ["transcritor", "openclaw"]);
  assert.deepEqual(faltamAoCriarUsuario(v.faltam), ["transcritor"]);
  assert.deepEqual(faltamAoCriarUsuario(["openclaw"]), []);
  assert.deepEqual(faltamAoCriarUsuario(["openclaw-leve", "swap"]), ["swap"], "o leve reinicia gateways: só pelo botão da aba");
});

test("preparar: máquina de OpenClaw sem Hermes: o Hermes vira opcional (fora de faltam, do Criar usuário e do Nova VPS); sem OpenClaw continua obrigatório", () => {
  const oc = lerPreparar(saida({ openclaw: "global", hermes: "nenhum", transcritor: 1 }));
  const h = oc.itens.find((i) => i.id === "hermes"); assert.equal(h.estado, "falta"); assert.equal(h.opcional, true); assert.match(h.detalhe, /usa o OpenClaw/);
  assert.deepEqual(oc.faltam, []);
  const nada = lerPreparar(saida({ openclaw: "nenhum", hermes: "nenhum", transcritor: 0 }));
  assert.equal(nada.itens.find((i) => i.id === "hermes").opcional, false); assert.deepEqual(nada.faltam, ["hermes", "transcritor", "openclaw"]);
  const root = lerPreparar(saida({ openclaw: "global", hermes: "root" }));
  assert.equal(root.itens.find((i) => i.id === "hermes").opcional, false, "Hermes só no root: alguém usa, instalar para todos continua obrigatório");
  // Pedido de propósito, o passo existe.
  assert.equal(passosPreparar(["hermes"], oc).length, 1);
});

test("preparar: contexto para os agentes: bloco com marcadores no CLAUDE.md e no AGENTS.md do root e das boxes; falta quando algum arquivo não tem a versão atual", () => {
  const { CONTEXTO_MD, CONTEXTO_START, CONTEXTO_END, CONTEXTO_ESTADO_SH, contextoSh } = createRequire(import.meta.url)("../../dist/main/admin/contexto-core.js");
  assert.ok(CONTEXTO_MD.startsWith(CONTEXTO_START) && CONTEXTO_MD.endsWith(CONTEXTO_END));
  for (const t of ["nova", "novnc", "box-", "/opt/openclaw", "/opt/hermes", "meu-bot-leve.conf", "meu-bot-sem-llmnr.conf", "/swapfile", "usrquota", "nunca remova", "auditoria", "backup-drive.json", "Restaurar uma cópia"]) assert.ok(CONTEXTO_MD.includes(t), t);
  const por = (o) => Object.fromEntries(lerPreparar(saida(o)).itens.map((i) => [i.id, i]));
  assert.equal(por({ contexto: "3 3" }).contexto.estado, "ok"); assert.equal(por({ contexto: "3 1" }).contexto.estado, "falta"); assert.match(por({ contexto: "3 1" }).contexto.detalhe, /2 arquivo/);
  assert.equal(por({ contexto: "0 0" }).contexto.estado, "falta");
  assert.equal(lerPreparar(saida().replace(/^CONTEXTO=.*\n/m, "")).itens.find((i) => i.id === "contexto").estado, "falta", "saída antiga: nunca foi gravado");
  assert.deepEqual(lerPreparar(saida({ contexto: "2 0" })).faltam, ["contexto"]);
  assert.ok(PREPARAR_ESTADO_SH.includes(CONTEXTO_ESTADO_SH));
  const p = passosPreparar(["contexto"], lerPreparar(saida({ contexto: "2 0" })));
  assert.equal(p.length, 1); assert.equal(p[0].acao, "maquina.contexto"); assert.equal(p[0].alvo("CONTEXTO=ok 4\n"), "4");
  const sh = contextoSh(); assert.match(sh, /^\[ "\$\(id -u\)" = 0 \]/); assert.match(sh, /agent-workspace\/CLAUDE\.md/); assert.match(sh, /\.openclaw\/workspace\/AGENTS\.md/); assert.match(sh, /meu-bot:maquina v\\d\+ inicio/); assert.match(sh, /chown "\$u":"\$u" "\$f"/);
  // Entra no Criar usuário e no Nova VPS (não reinicia nada).
  const { faltamAoCriarUsuario } = createRequire(import.meta.url)("../../dist/main/admin/preparar-core.js");
  assert.deepEqual(faltamAoCriarUsuario(["contexto"]), ["contexto"]);
});

test("preparar: LLMNR: ligado é falta (1 s sem DNS para desligar); desligado ou sem systemd-resolved é ok; o passo grava o drop-in e confere a 5355", () => {
  const { LLMNR_DESLIGAR_SH, LLMNR_ESTADO_SH, LLMNR_CONF } = createRequire(import.meta.url)("../../dist/main/admin/preparar-core.js");
  const por = (o) => Object.fromEntries(lerPreparar(saida(o)).itens.map((i) => [i.id, i]));
  assert.equal(por({ llmnr: "on" }).llmnr.estado, "falta"); assert.match(por({ llmnr: "on" }).llmnr.detalhe, /5355/);
  assert.equal(por({ llmnr: "off" }).llmnr.estado, "ok"); assert.equal(por({ llmnr: "na" }).llmnr.estado, "ok"); assert.match(por({ llmnr: "na" }).llmnr.detalhe, /não se aplica/);
  assert.equal(lerPreparar(saida().replace(/^LLMNR=.*\n/m, "")).itens.find((i) => i.id === "llmnr").estado, "ok", "saída antiga: nada a fazer");
  assert.deepEqual(lerPreparar(saida({ llmnr: "on" })).faltam, ["llmnr"]);
  assert.ok(PREPARAR_ESTADO_SH.includes(LLMNR_ESTADO_SH)); assert.match(LLMNR_ESTADO_SH, /resolvectl status/); assert.match(LLMNR_ESTADO_SH, /:5355 /);
  const p = passosPreparar(["llmnr"], lerPreparar(saida({ llmnr: "on" })));
  assert.equal(p.length, 1); assert.equal(p[0].acao, "maquina.llmnr"); assert.equal(p[0].alvo("LLMNR=ok off\n"), "off");
  assert.match(LLMNR_DESLIGAR_SH, /^\[ "\$\(id -u\)" = 0 \]/); assert.ok(LLMNR_DESLIGAR_SH.includes(LLMNR_CONF)); assert.match(LLMNR_DESLIGAR_SH, /LLMNR=no/); assert.match(LLMNR_DESLIGAR_SH, /systemctl restart systemd-resolved/);
  assert.match(LLMNR_DESLIGAR_SH, /LLMNR=ok na/); assert.match(LLMNR_DESLIGAR_SH, /-LLMNR/);
  // Não reinicia gateway nem WhatsApp: pode entrar no Criar usuário.
  const { faltamAoCriarUsuario } = createRequire(import.meta.url)("../../dist/main/admin/preparar-core.js");
  assert.deepEqual(faltamAoCriarUsuario(["llmnr"]), ["llmnr"]);
});

test("preparar: OpenClaw leve: sem gateway é ok; gateways pesados viram falta com os nomes; o passo roda como root e registra na auditoria", () => {
  const { lerOcLeve, OPENCLAW_LEVE, OPENCLAW_LEVE_ESTADO_SH, OC_LEVE_ENSURE_SH, openclawLeveSh } = createRequire(import.meta.url)("../../dist/main/admin/openclaw-leve-core.js");
  assert.deepEqual(lerOcLeve("OCLEVE=3 1 box-1 box-2\n"), { total: 3, leves: 1, faltam: ["box-1", "box-2"] });
  assert.deepEqual(lerOcLeve("OCLEVE=0 0\n"), { total: 0, leves: 0, faltam: [] }); assert.equal(lerOcLeve("ROOT\n"), null);
  const por = (o) => Object.fromEntries(lerPreparar(saida(o)).itens.map((i) => [i.id, i]));
  assert.equal(por({ ocleve: "0 0" })["openclaw-leve"].estado, "ok"); assert.match(por({ ocleve: "0 0" })["openclaw-leve"].detalhe, /nascem leves/);
  assert.equal(por({ ocleve: "2 2" })["openclaw-leve"].estado, "ok"); assert.match(por({ ocleve: "2 2" })["openclaw-leve"].detalhe, /2 gateways leves.*768/);
  const f = por({ ocleve: "3 1 root box-1" })["openclaw-leve"]; assert.equal(f.estado, "falta"); assert.match(f.detalhe, /pesados: root, box-1/);
  assert.deepEqual(lerPreparar(saida({ ocleve: "3 1 root box-1" })).faltam, ["openclaw-leve"]);
  // Saída antiga (sem a chave): nada a fazer.
  assert.equal(lerPreparar(saida().replace(/^OCLEVE=.*\n/m, "")).itens.find((i) => i.id === "openclaw-leve").estado, "ok");
  assert.ok(PREPARAR_ESTADO_SH.includes(OPENCLAW_LEVE_ESTADO_SH));
  const p = passosPreparar(["openclaw-leve"], lerPreparar(saida({ ocleve: "3 1 root box-1" })));
  assert.equal(p.length, 1); assert.equal(p[0].acao, "maquina.openclaw-leve"); assert.match(p[0].sh, /^\[ "\$\(id -u\)" = 0 \]/); assert.ok(p[0].ok.test("OCLEVE=ok 2 root box-1")); assert.equal(p[0].alvo("OCLEVE=ok 2 root box-1\n"), "2 root box-1");
  // O ensure: drop-in sobrescrevendo o ExecStart (o unit zera NODE_OPTIONS e passa o flag na linha), allow só se nosso, sem reiniciar com RESTART=0.
  assert.match(OC_LEVE_ENSURE_SH, /ExecStart=\\n%s/); assert.match(OC_LEVE_ENSURE_SH, new RegExp(`--max-old-space-size=${OPENCLAW_LEVE.heapMb}`)); assert.match(OC_LEVE_ENSURE_SH, /meu-bot-leve\.conf/);
  assert.match(OC_LEVE_ENSURE_SH, /"meu-bot-guarda" not in cur: print\("allow=alheia"\)/); assert.match(OC_LEVE_ENSURE_SH, /base = \["whatsapp","meu-bot-guarda"\]/);
  assert.match(OC_LEVE_ENSURE_SH, /\[ "\$RESTART" = 1 \] && systemctl --user is-active --quiet "\$U"/); assert.match(OC_LEVE_ENSURE_SH, /LEVE=sem-gateway/);
  assert.match(openclawLeveSh(), /runuser -u "\$u" -- env RESTART=1 HOME="\$h"/); assert.match(openclawLeveSh(), /OCLEVE=ok \$N\$C/);
});

test("motivoSsh: prazo estourado e stderr vazio dizem por quê (não sai mais 'não consegui ler os usuários da máquina:' sem nada)", () => {
  const { motivoSsh } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.equal(motivoSsh({ code: 255, stderr: "aviso\nssh: connect to host x port 22: Connection refused\n" }, 60_000), "ssh: connect to host x port 22: Connection refused");
  assert.match(motivoSsh({ code: null, stderr: "" }, 60_000), /não respondeu em 60 s/);
  assert.match(motivoSsh({ code: 1, stderr: "  \n" }, 60_000), /código 1/);
});
