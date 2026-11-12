import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { lerUsuarios, NOME_USUARIO_RE, RESERVADOS, LISTAR_SH, limiteKbDe, pctMinimo, conferirMinimo, MINIMO_CONTA_KB, caminhoDentro, lerMaiores, apagarSh, PROTEGIDOS, lingerSh, nivelUso } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");

test("usuários: lê a saída do script (só root vê), ordena por uid e ignora lixo", () => {
  const out = "ROOT\nDISCO=1000000\nCOTA=1\nU\tbox\t1002\t/home/box\t/bin/bash\t1\t1\t1\t500\t0\nU\tdebian\t1000\t/home/debian\t/bin/bash\t0\t0\t0\t20\t100000\nlixo\nU\tNome Ruim\t1005\t/x\t/bin/bash\t0\t0\t0\t\t\n";
  const r = lerUsuarios(out);
  assert.equal(r.root, true);
  assert.deepEqual(r.usuarios.map((u) => [u.nome, u.sudo, u.meuBot, u.chave]), [["debian", false, false, false], ["box", true, true, true]]);
  assert.equal(lerUsuarios("NAOROOT\n").root, false);
});

test("usuários: linger lido da última coluna (linha antiga sem ela = ligado), ligado ao criar e desligado ao apagar", () => {
  const base = "ana\t1001\t/home/ana\t/bin/bash\t0\t0\t1\t\t\t0\tinfinity\tinfinity\t";
  const r = lerUsuarios(`ROOT\nU\t${base}\t0\nU\tbia${base.slice(3)}\t1\nU\tcid${base.slice(3)}\n`);
  assert.deepEqual(r.usuarios.map((u) => [u.nome, u.ligado]), [["ana", false], ["bia", true], ["cid", true]]);
  assert.match(LISTAR_SH, /\/var\/lib\/systemd\/linger\/\$n/);
  assert.match(lingerSh("ana"), /loginctl enable-linger 'ana'/); assert.match(lingerSh("ana"), /LINGER=ok/);
  assert.match(apagarSh("ana"), /loginctl disable-linger "\$N"[\s\S]*userdel/);
});

test("usuários: nível de uso do disco (90% perto, 100% cheio; sem limite = ok)", () => {
  assert.equal(nivelUso(50, 100), "ok"); assert.equal(nivelUso(90, 100), "perto"); assert.equal(nivelUso(100, 100), "cheio"); assert.equal(nivelUso(120, 100), "cheio");
  assert.equal(nivelUso(500, null), "ok"); assert.equal(nivelUso(null, 100), "ok"); assert.equal(nivelUso(5, 0), "ok");
});

test("usuários: nome aceito e reservados; o script não lista contas sem login", () => {
  for (const n of ["maria", "box-lv", "joao_2"]) assert.ok(NOME_USUARIO_RE.test(n), n);
  for (const n of ["Maria", "1abc", "a", "maria silva", "x".repeat(33), "rm;-rf"]) assert.ok(!NOME_USUARIO_RE.test(n), n);
  assert.ok(RESERVADOS.has("root") && RESERVADOS.has("admin"));
  assert.match(LISTAR_SH, /nologin\|false/);
});

test("usuários: disco e cota; limite 0 vira 'sem limite'; % → KB", () => {
  const r = lerUsuarios("ROOT\nDISCO=1000000\nCOTA=1\nU\tana\t1001\t/home/ana\t/bin/bash\t0\t0\t1\t300\t0\nU\tbia\t1002\t/home/bia\t/bin/bash\t0\t0\t1\t50\t100000\n");
  assert.equal(r.discoKb, 1000000); assert.equal(r.cota, true);
  assert.deepEqual(r.usuarios.map((u) => [u.nome, u.usadoKb, u.limiteKb]), [["ana", 300, null], ["bia", 50, 100000]]);
  assert.equal(lerUsuarios("ROOT\nCOTA=0\nU\tana\t1001\t/home/ana\t/bin/bash\t0\t0\t1\t\t\n").usuarios[0].usadoKb, null);
  assert.equal(limiteKbDe(10, 1000000), 100000); assert.equal(limiteKbDe(0, 1000000), 0);
  for (const p of [-1, 101, 2.5, Number.NaN]) assert.throws(() => limiteKbDe(p, 1000000));
});

test("usuários: apagar só dentro da pasta; nunca a pasta, nem com ..; protegidos e sudo", () => {
  assert.ok(caminhoDentro("/home/ana", "/home/ana/videos"));
  for (const p of ["/home/ana", "/home/ana/", "/home/anabela/x", "/home/ana/../bia", "/etc/passwd", "/home/ana/a\nb"]) assert.ok(!caminhoDentro("/home/ana", p), p);
  assert.ok(!caminhoDentro("/root", "/root/x"), "só pastas em /home");
  const m = lerMaiores("HOME=/home/ana\nI\t900\td\t/home/ana/videos\nI\t5\tf\t/etc/passwd\nI\tx\tf\t/home/ana/y\n");
  assert.deepEqual(m.itens.map((i) => i.caminho), ["/home/ana/videos"]);
  assert.match(apagarSh("ana"), /tem sudo/); assert.match(apagarSh("ana"), /user-\$U\.slice\.d/); assert.ok(PROTEGIDOS.has("openclaw"));
});

test("usuários: RAM da máquina, do root e de cada um", () => {
  const r = lerUsuarios("ROOT\nDISCO=100\nCOTA=0\nRAM=32000000 2300000\nRAMROOT=2500000\nU\tana\t1001\t/home/ana\t/bin/bash\t0\t1\t1\t\t\t900000\nU\tbia\t1002\t/home/bia\t/bin/bash\t0\t0\t1\t\t\t0\n");
  assert.deepEqual(r.ram, { totalKb: 32000000, usoKb: 2300000, rootKb: 2500000, swapKb: 0, swapUsoKb: 0 });
  assert.deepEqual(r.usuarios.map((u) => [u.nome, u.ramKb]), [["ana", 900000], ["bia", 0]]);
  assert.equal(lerUsuarios("ROOT\n").ram, null);
});

test("usuários: tetos de RAM e CPU (systemd) lidos e gravados", async () => {
  const { ramMaxDe, cpuMaxDe, recursosSh } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.equal(ramMaxDe("1073741824"), 1024); assert.equal(ramMaxDe("infinity"), null); assert.equal(ramMaxDe(undefined), null);
  assert.equal(cpuMaxDe("1s"), 100); assert.equal(cpuMaxDe("500ms"), 50); assert.equal(cpuMaxDe("1.500s"), 150); assert.equal(cpuMaxDe("infinity"), null);
  assert.match(recursosSh("ana", 1024, 100), /MemoryHigh=921M MemoryMax=1024M CPUQuota=100%/);
  assert.match(recursosSh("ana", 0, 0), /MemoryHigh=infinity MemoryMax=infinity CPUQuota= /);
  for (const [r, c] of [[-1, 0], [0, -5], [1.5, 0], [0, Number.NaN]]) assert.throws(() => recursosSh("ana", r, c));
  const l = lerUsuarios("ROOT\nU\tana\t1001\t/home/ana\t/bin/bash\t0\t0\t1\t\t\t0\t1073741824\t1s\n");
  assert.deepEqual([l.usuarios[0].ramMaxMb, l.usuarios[0].cpuMaxPct], [1024, 100]);
});

test("máquina: swap lida e o script de ligar confere espaço, guarda o fstab e não liga duas vezes", async () => {
  const { swapLigarSh } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  const r = lerUsuarios("ROOT\nRAM=32000000 2000000\nRAMROOT=1\nSWAP=8388604 1024\n");
  assert.equal(r.ram.swapKb, 8388604); assert.equal(r.ram.swapUsoKb, 1024);
  const sh = swapLigarSh(8);
  assert.match(sh, /swapon --noheadings/); assert.match(sh, /fstab\.bak-meu-bot/); assert.match(sh, /findmnt --verify/); assert.match(sh, /swappiness=10/);
  for (const g of [0, 65, 2.5]) assert.throws(() => swapLigarSh(g));
});

test("usuários: apelido (descrição do usuário), sem mexer no login", async () => {
  const { apelidoValido, apelidoSh } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.equal(apelidoValido("  Maria   (financeiro) "), "Maria (financeiro)");
  assert.equal(apelidoValido(""), "");
  for (const a of ["a:b", "a,b", "x".repeat(41), 3]) assert.throws(() => apelidoValido(a));
  // Marcado no GECOS: a sonda e a lista só leem o que o meu-bot gravou (o "root" do root e o "Ubuntu" da imagem ficam de fora).
  assert.match(apelidoSh("ana", "Maria"), /usermod -c "\$\(\[ -n "\$A" \] && printf '%s%s' 'meu-bot=' "\$A"\)" 'ana'/);
  const { apelidoLimpo, LISTAR_SH: listarSh } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.equal(apelidoLimpo("Maria, a chefe: (RH)\\x"), "Maria a chefe (RH) x", "o que o GECOS não aceita vira espaço, em vez de recusar");
  assert.equal(apelidoLimpo("x".repeat(50)).length, 40);
  assert.match(listarSh, /substr\(g\[1\], 1, 8\) == "meu-bot="/, "a lista descarta GECOS sem a marca");
  const l = lerUsuarios("ROOT\nU\tana\t1001\t/home/ana\t/bin/bash\t0\t0\t1\t\t\t0\tinfinity\tinfinity\tMaria Souza\n");
  assert.equal(l.usuarios[0].apelido, "Maria Souza");
});

test("usuários: 'No meu-bot' gera o Host <máquina>-<usuário> e não duplica um Host que já existe", async () => {
  const { aliasDoUsuario, blocoSshUsuario, configTemHost } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.equal(aliasDoUsuario("meu-root", "box-1"), "meu-root-box-1");
  assert.equal(aliasDoUsuario("Máquina da Lú", "ana"), "maquina-da-lu-ana");
  const b = blocoSshUsuario({ alias: "meu-root-box-1", hostname: "2.24.31.253", port: "22", user: "box-1", chave: "~/.ssh/meu-bot-admin", maquina: "meu-root" });
  assert.match(b, /^Host meu-root-box-1$/m); assert.match(b, /User box-1/); assert.match(b, /IdentitiesOnly yes/);
  assert.ok(configTemHost("Host a b meu-root-box-1\n  User x\n", "meu-root-box-1"));
  assert.ok(!configTemHost("Host meu-root-box-10\n", "meu-root-box-1"));
});

test("usuários: todo usuário novo nasce com 3 GB de RAM e 200% de CPU (9 boxes em 32 GB; gateway do OpenClaw + claude filhos + o Kokoro da voz em ~550 MB de pico; a coluna Pressão mostra)", async () => {
  const { RECURSOS_PADRAO, recursosSh } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.deepEqual({ ...RECURSOS_PADRAO }, { ramMb: 3072, cpuPct: 200 });
  assert.match(recursosSh("ana", RECURSOS_PADRAO.ramMb, RECURSOS_PADRAO.cpuPct), /MemoryHigh=2764M MemoryMax=3072M CPUQuota=200%/);
});

test("seletores: entram os comuns com a chave deste Mac; sudo, meu-bot, sistema e sem chave ficam de fora", () => {
  const { candidatosAoSeletor, semChaveDesteMac } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  const u = (nome, o = {}) => ({ nome, uid: 1001, home: `/home/${nome}`, shell: "/bin/bash", sudo: false, meuBot: false, chave: true, usadoKb: null, limiteKb: null, ramKb: 0, ramMaxMb: null, cpuMaxPct: null, apelido: "", ligado: true, ...o });
  const lista = [u("ana"), u("box", { sudo: true }), u("openclaw", { meuBot: true }), u("hermes"), u("bia", { chave: false }), u("admin")];
  assert.deepEqual(candidatosAoSeletor(lista).map((x) => x.nome), ["ana"]);
  assert.deepEqual(semChaveDesteMac(lista), ["bia"]);
});

test("removerBlocoUsuario: tira só o bloco do admin (marca + Host + indentadas) e não leva o comentário do bloco seguinte", () => {
  const { removerBlocoUsuario, blocoSshUsuario } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  const bloco = blocoSshUsuario({ alias: "meu-root-ana", hostname: "203.0.113.7", port: "22", user: "ana", chave: "~/.ssh/id_ed25519", maquina: "meu-root" });
  const antes = "Include ~/.ssh/meu-bot-suporte.conf\n\nHost vps\n    HostName 203.0.113.7\n    User root\n";
  const depois = "\n# minha VPS de teste\nHost teste\n    HostName 198.51.100.2\n";
  const r = removerBlocoUsuario(`${antes}\n${bloco}${depois}`, "meu-root-ana");
  assert.equal(r.removido, true);
  assert.equal(r.texto, `${antes}${depois}`);
  assert.match(r.texto, /# minha VPS de teste\nHost teste/);
  // Sem a marca logo acima: o bloco não é do admin e fica.
  const meu = `${antes}\nHost meu-root-ana\n    User ana\n`;
  assert.deepEqual(removerBlocoUsuario(meu, "meu-root-ana"), { texto: meu, removido: false });
  assert.equal(removerBlocoUsuario(antes, "meu-root-ana").removido, false);
});

test("usuários: Hermes para todos na mesma versão do install-grok-oauth.sh, com atalho legível e git liberado", async () => {
  const { hermesGlobalSh, HERMES_VERSAO, lerUsuarios: ler, LISTAR_SH: listar } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  const { readFileSync } = await import("node:fs");
  const grok = readFileSync(new URL("../../backend-colima/install-grok-oauth.sh", import.meta.url), "utf8");
  assert.equal(/^HERMES_VERSION=(\S+)$/m.exec(grok)?.[1], HERMES_VERSAO);
  const sh = hermesGlobalSh();
  assert.match(sh, /npm install -g --prefix "\$D" "hermes-agent@\$V"/);
  assert.match(sh, /chmod -R a\+rX "\$D"/);
  assert.match(sh, /meu-bot-hermes-global/);
  assert.match(sh, /GIT_CONFIG_VALUE_0=\/opt\/hermes\/lib\/node_modules\/hermes-agent\/runtime\/hermes-agent/);
  assert.match(sh, /runuser -u nobody/);
  assert.match(sh, /runtime\/hermes-agent\/\.hermes\/bin/, "o atalho que o serviço do gateway de cada usuário chama");
  // CONTORNO #6: o atalho do serviço pula o lançador Node para o SIGTERM do systemd chegar ao Python.
  const atalho = sh.slice(sh.indexOf('cat > "$G/hermes"'));
  assert.match(atalho, /exec "\$R\/venv\/bin\/hermes" "\$@"/);
  assert.match(atalho, /export VIRTUAL_ENV="\$R\/venv" HERMES_NPM_BRIDGE=1/);
  assert.match(atalho, /unset PYTHONHOME PYTHONPATH/);
  assert.match(atalho, /\[ -x "\$R\/venv\/bin\/hermes" \] \|\| exec \/usr\/local\/bin\/hermes/, "sem venv, o caminho antigo");
  assert.match(listar, /HERMES=global/);
  assert.equal(ler("ROOT\nHERMES=global\n").hermes, "global");
  assert.equal(ler("ROOT\nHERMES=root\n").hermes, "root");
  assert.equal(ler("ROOT\n").hermes, null);
  // O OpenClaw é lido junto: a aba Usuários oferece "Instalar OpenClaw para todos" ao lado do Hermes.
  assert.match(listar, /OPENCLAW=global/);
  assert.equal(ler("ROOT\nOPENCLAW=global\n").openclaw, "global");
  assert.equal(ler("ROOT\nOPENCLAW=root\n").openclaw, "root");
  assert.equal(ler("ROOT\nOPENCLAW=nenhum\n").openclaw, "nenhum");
  assert.equal(ler("ROOT\n").openclaw, null);
  // Hermes global sem o transcritor compartilhado: incompleto, o admin oferece completar.
  assert.match(listar, /meu-bot-transcritor \/opt\/transcriber\/bin\/transcrever/);
  assert.equal(ler("ROOT\nHERMES=sem-transcritor\n").hermes, "sem-transcritor");
});

test("motor do usuário novo: Hermes por padrão, OpenClaw só grava a escolha (o pareamento faz o resto)", () => {
  const { motorDe, openclawSemearSh, MOTORES_NOVO_USUARIO } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.deepEqual([...MOTORES_NOVO_USUARIO], ["hermes", "openclaw"]);
  assert.equal(motorDe(undefined), "hermes"); assert.equal(motorDe(""), "hermes"); assert.equal(motorDe("openclaw"), "openclaw");
  assert.throws(() => motorDe("picoclaw"), /desconhecido/);
  const sh = openclawSemearSh();
  assert.match(sh, /openclaw > "\$HOME\/\.local\/share\/meu-bot\/whatsapp-agente"/);
  assert.match(sh, /SEMEADO=ok/); assert.ok(!/hermes/.test(sh), "não toca no Hermes");
});

test("transcritor para todos: /opt/transcriber do root (755, como o /opt/hermes), modelo reaproveitado, conferido como nobody", () => {
  const { transcritorSh } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  const sh = transcritorSh();
  assert.match(sh, /^T=\/opt\/transcriber;/);
  assert.match(sh, /chown -R root:root "\$T"; chmod -R u=rwX,go=rX "\$T"; chmod 755 "\$T\/bin\/transcrever"/, "só o root grava; todos leem e executam");
  assert.doesNotMatch(sh, /groupadd|usermod|chgrp/, "sem grupo: o acesso é pelo \"outros\", como o /opt/hermes");
  assert.match(sh, /faster-whisper==1\.2\.1 av==18\.1\.0/, "o av 19 quebra o decode_audio do faster-whisper 1.2.1");
  assert.match(sh, /cp -a \/opt\/hermes\/modelos\/whisper-small "\$M"/, "o modelo que já está na máquina não baixa de novo");
  assert.match(sh, /Systran\/faster-whisper-small/);
  assert.match(sh, /#!\/opt\/transcriber\/venv\/bin\/python\n"""meu-bot-transcritor/, "a marca que a leitura da máquina procura");
  assert.match(sh, /runuser -u nobody -- "\$T\/bin\/transcrever"/);
  assert.match(sh, /runuser -u nobody -- "\$T\/bin\/transcrever-texto"/, "o comando do OpenClaw também é conferido como nobody");
  assert.match(sh, /exec \/opt\/transcriber\/bin\/transcrever "\$1" - "\$2"/, "transcrever-texto imprime o texto (pasta de saída -; idioma vazio = pt)");
  assert.match(sh, /chmod 755 "\$T\/bin\/transcrever" "\$T\/bin\/transcrever-texto"/);
  assert.match(sh, /if str\(saida\) == "-":/);
  assert.match(sh, /echo "TRANSCRITOR=ok"/);
  const { TRANSCRITOR_ESTADO_SH } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.match(TRANSCRITOR_ESTADO_SH, /meu-bot-transcritor \/opt\/transcriber\/bin\/transcrever .*-x \/opt\/transcriber\/bin\/transcrever-texto/, "completo = os dois comandos");
  assert.ok(!sh.includes("${"), "nada de interpolação perdida no script");
});

test("usuários: o box- é fixo na frente do nome digitado, sem repetir", async () => {
  const { comPrefixo, PREFIXO_USUARIO, NOME_USUARIO_RE: re } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.equal(comPrefixo("maria"), "box-maria");
  assert.equal(comPrefixo("box-1"), "box-1", "quem já digitou o box- não ganha outro");
  assert.equal(comPrefixo("1"), "box-1");
  assert.ok(re.test(comPrefixo("maria")) && re.test(comPrefixo("1")), "o nome com prefixo é um usuário Linux válido");
  const { readFileSync } = await import("node:fs");
  const tela = readFileSync(new URL("../../src/renderer/admin/usuarios-page.ts", import.meta.url), "utf8");
  assert.equal(/const PREFIXO = "([^"]+)";/.exec(tela)?.[1], PREFIXO_USUARIO, "a cópia da tela bate com a do main");
});

test("usuários: o nome sugerido é o próximo box da sequência", async () => {
  const { proximoBox } = await import("../../dist/renderer/lib/usuarios-nome.js");
  assert.equal(proximoBox([]), "1");
  assert.equal(proximoBox(["box-1", "box-2"]), "3");
  assert.equal(proximoBox(["box-1", "box-4", "maria", "box-maria", "meu-box"]), "5", "só box-<número> conta; segue o maior");
});

test("usuários: \"pronto\" = backend do meu-bot na conta e o Hermes como agente (o que o onboarding da criação deixa)", () => {
  assert.match(LISTAR_SH, /\.local\/share\/meu-bot\/backend\/\.env/);
  assert.match(LISTAR_SH, /whatsapp-agente[^\n]*= hermes \] && pr=1 \|\| pr=0/);
  const linha = (pr) => `ROOT\nU\tbox-9\t1009\t/home/box-9\t/bin/bash\t0\t1\t1\t\t\t0\tinfinity\tinfinity\t\t1${pr === undefined ? "" : `\t${pr}`}\n`;
  assert.equal(lerUsuarios(linha("1")).usuarios[0].pronto, true);
  assert.equal(lerUsuarios(linha("0")).usuarios[0].pronto, false);
  assert.equal(lerUsuarios(linha()).usuarios[0].pronto, false, "máquina com script antigo: sem a coluna, não está pronto");
});

test("nome para criar: vazio ou só o prefixo não vira usuário \"box-\"; com ou sem prefixo dá o mesmo", async () => {
  const { nomeParaCriar } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.equal(nomeParaCriar(""), null); assert.equal(nomeParaCriar("   "), null); assert.equal(nomeParaCriar("box-"), null);
  assert.equal(nomeParaCriar(3), null); assert.equal(nomeParaCriar("Maria"), null, "maiúscula não entra");
  assert.equal(nomeParaCriar("3"), "box-3"); assert.equal(nomeParaCriar("box-3"), "box-3"); assert.equal(nomeParaCriar(" maria "), "box-maria");
  assert.equal(nomeParaCriar("root"), "box-root", "o prefixo tira do caminho dos nomes reservados");
});

test("governança de RAM/CPU: toda box leva isolamento (swap própria, piso protegido, peso igual); reserva do user.slice; reaplicar só nas que faltam", () => {
  const c = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.match(c.recursosSh("ana", 1024, 100), /CPUQuota=100% MemorySwapMax=256M MemoryLow=640M CPUWeight=100/);
  assert.match(c.recursosSh("ana", 0, 0), /MemorySwapMax=infinity MemoryLow=640M CPUWeight=100/, "sem teto de RAM, sem teto de swap");
  assert.deepEqual(c.reservaDe(32_870_400), { capMb: 28_890, lowMb: 14_445 }, "10% > 3 GB numa máquina de 32 GB (32100 MB − 3210)");
  assert.deepEqual(c.reservaDe(8_000_000), { capMb: 4_740, lowMb: 2_370 }, "o piso de 3 GB vence numa máquina de 8 GB");
  assert.throws(() => c.reservaDe(2_000_000), /RAM de menos/); assert.throws(() => c.reservaDe(0));
  const r = c.reservaHostSh(28800, 14400);
  assert.match(r, /awk '\$1=="anon"/, "a guarda olha a memória de verdade (anon), não o cache do root");
  assert.match(r, /set-property user\.slice MemoryMax=28800M MemoryLow=14400M CPUWeight=100/); assert.match(r, /RESERVA=ok 28800/);
  assert.throws(() => c.reservaHostSh(500, 0)); assert.throws(() => c.reservaHostSh(2000, 3000));
  const iso = c.isolamentoTodosSh();
  assert.match(iso, /MemorySwapMax=256M MemoryLow=640M CPUWeight=100/); assert.doesNotMatch(iso, /MemoryMax=|CPUQuota=/, "não mexe nos tetos de cada box");
  assert.match(iso, /sudo "\*\|\*" wheel "\*\|\*" admin "\*\) continue/); assert.match(iso, /^echo "ISOLAMENTO=ok \$N\$L"$/m);
  assert.deepEqual({ ...c.ISOLAMENTO_PADRAO }, { swapMb: 256, lowMb: 640, cpuWeight: 100 }); assert.deepEqual({ ...c.RESERVA_HOST }, { minMb: 3072, pct: 10 });
});

test("lista: CPUS, USERSLICE e as colunas do cgroup por usuário; linha antiga continua lendo (box null)", () => {
  const c = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.match(c.LISTAR_SH, /CPUS=\$\(nproc/); assert.match(c.LISTAR_SH, /USERSLICE=/); assert.match(c.LISTAR_SH, /memory\.pressure/); assert.match(c.LISTAR_SH, /cpu\.stat/); assert.match(c.LISTAR_SH, /memory\.swap\.current/);
  assert.match(c.LISTAR_SH, /print \$2" "\$3" "\$4; exit/, "usado, macio e duro da cota");
  const cg = ["1363148800", "331350016", "1940000000", "12288", "393", "0", "0", "0.00", "0.00", "0.00", "791000", "3083", "2439000000"].join("\t");
  const linha = ["U", "ana", "1001", "/home/ana", "/bin/bash", "0", "1", "1", "2902256", "4126300", "500000", "2147483648", "2s", "", "1", "1", "4538930", "268435456", "671088640", "100", cg].join("\t");
  const l = c.lerUsuarios(`ROOT\nRAM=32870400 2100000\nRAMROOT=900000\nSWAP=8388604 2048\nCPUS=8\nUSERSLICE=30198988800 22600000000 1200000000 15099494400\n${linha}\n`);
  assert.equal(l.cpus, 8); assert.deepEqual(l.userSlice, { maxKb: 29491200, usoKb: 22070313, anonKb: 1171875, lowKb: 14745600 });
  const u = l.usuarios[0];
  assert.deepEqual([u.limiteKb, u.hardKb, u.swapMaxMb, u.lowMb, u.cpuWeight], [4126300, 4538930, 256, 640, 100]);
  assert.deepEqual(u.box, { usoKb: 1331200, anonKb: 323584, picoKb: 1894531, swapKb: 12, evHigh: 393, evMax: 0, oomKill: 0, psiMem10: 0, psiMem60: 0, psiCpu60: 0, cpuPeriodos: 791000, cpuEstrangulados: 3083, cpuEstranguladoUsec: 2439000000 });
  assert.equal(u.pressao.estado, "folgada", "events high sozinho não é pressão (é o kernel recolhendo cache)");
  const antiga = c.lerUsuarios("ROOT\nU\tana\t1001\t/home/ana\t/bin/bash\t0\t0\t1\t300\t100000\t0\tinfinity\tinfinity\t\t1\t0\n");
  assert.deepEqual([antiga.usuarios[0].hardKb, antiga.usuarios[0].swapMaxMb, antiga.usuarios[0].box, antiga.usuarios[0].pressao, antiga.userSlice, antiga.cpus], [null, null, null, null, null, null]);
  const semMax = c.lerUsuarios("ROOT\nUSERSLICE=max 1000 500 0\n");
  assert.equal(semMax.userSlice.maxKb, null);
});

test("pressão: folgada, apertada e estrangulada pelos sinais certos (anon, PSI, teto batido, OOM)", () => {
  const c = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  const b = (o = {}) => ({ usoKb: 1300000, anonKb: 400 * 1024, picoKb: null, swapKb: 0, evHigh: 393, evMax: 0, oomKill: 0, psiMem10: 0, psiMem60: 0, psiCpu60: 0, cpuPeriodos: 0, cpuEstrangulados: 0, cpuEstranguladoUsec: 0, ...o });
  assert.equal(c.pressaoDe(b(), 2048).estado, "folgada");
  assert.equal(c.pressaoDe(b({ anonKb: 1600 * 1024 }), 2048).estado, "apertada", "anon ≥ 85% do MemoryHigh (1843)");
  assert.equal(c.pressaoDe(b({ anonKb: 1600 * 1024 }), null).estado, "folgada", "sem teto a regra do anon não vale");
  assert.equal(c.pressaoDe(b({ psiMem60: 12 }), 2048).estado, "apertada");
  assert.equal(c.pressaoDe(b({ psiCpu60: 30 }), 2048).estado, "apertada"); assert.match(c.pressaoDe(b({ psiCpu60: 30 }), 2048).dica, /CPU/);
  assert.equal(c.pressaoDe(b({ psiCpu60: 60 }), 2048).estado, "estrangulada"); assert.equal(c.pressaoDe(b({ psiMem60: 30 }), 2048).estado, "estrangulada");
  // Contadores acumulados (desde que a fatia subiu) são histórico: sozinhos não pintam nada.
  const antiga = c.pressaoDe(b({ oomKill: 1, evMax: 438 }), 2048);
  assert.equal(antiga.estado, "folgada"); assert.match(antiga.motivo, /desde que a box subiu: 1 morte por memória, 438 vezes no teto/);
  assert.equal(c.pressaoDe(b({ evMax: 1 }), 2048).estado, "folgada"); assert.equal(c.pressaoDe(b({ evMax: 2, psiMem60: 12 }), 2048).estado, "apertada", "só a PSI decide");
  // O que subiu agora há pouco (recentes) é sinal.
  const morte = c.pressaoDe(b({ oomKill: 1 }), 2048, { oom: 1, max: 0 });
  assert.equal(morte.estado, "estrangulada"); assert.match(morte.motivo, /matou 1 processo dele por falta de memória agora há pouco · desde que a box subiu: 1 morte/);
  assert.equal(c.pressaoDe(b({ evMax: 3 }), 2048, { oom: 0, max: 1 }).estado, "apertada");
  assert.equal(c.pressaoDe(b({ evMax: 3, psiMem60: 12 }), 2048, { oom: 0, max: 2 }).estado, "estrangulada");
  assert.equal(c.pressaoDe(null, 2048), null);
});

test("pressão: a sugestão traz o teto com número, dentro do que a máquina comporta, e só para o que falta", () => {
  const c = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  const b = (o = {}) => ({ usoKb: 0, anonKb: 400 * 1024, picoKb: null, swapKb: 0, evHigh: 0, evMax: 0, oomKill: 1, psiMem10: 0, psiMem60: 0, psiCpu60: 0, cpuPeriodos: 0, cpuEstrangulados: 0, cpuEstranguladoUsec: 0, ...o });
  // Memória: +512 MB em degraus de 128; o pico manda quando 1,25× dele é maior.
  const mem = c.pressaoDe(b(), 1280, { oom: 1, max: 0 }, { cpuMaxPct: 200, capMb: 7000, nucleos: 8 });
  assert.equal(mem.estado, "estrangulada"); assert.deepEqual(mem.sugestao, { ramMaxMb: 1792, cpuPct: null });
  assert.match(mem.dica, /de 1280 para 1792 MB/);
  assert.equal(c.ramSugeridaDe(b({ picoKb: 2000 * 1024 }), 1280, 7000), 2560, "1,25 × 2000 = 2500 → 2560");
  // O teto dos usuários juntos limita; sem espaço, nada a sugerir e a dica diz o que fazer.
  assert.equal(c.ramSugeridaDe(b(), 1280, 1500), 1408);
  const cheia = c.pressaoDe(b(), 1280, { oom: 1, max: 0 }, { capMb: 1280 });
  assert.equal(cheia.sugestao.ramMaxMb, null); assert.match(cheia.dica, /não comporta.*memória de reserva/);
  assert.equal(c.ramSugeridaDe(b(), null, 7000), null, "sem teto não há o que subir");
  // CPU: um núcleo a mais, até os núcleos da máquina.
  const cpu = c.pressaoDe(b({ oomKill: 0, psiCpu60: 60 }), 1280, undefined, { cpuMaxPct: 200, capMb: 7000, nucleos: 8 });
  assert.deepEqual(cpu.sugestao, { ramMaxMb: null, cpuPct: 300 }); assert.match(cpu.dica, /de 200 para 300/);
  assert.equal(c.cpuSugeridaDe(800, 8), null); assert.equal(c.cpuSugeridaDe(750, 8), 800);
  // Folgada não sugere nada.
  assert.deepEqual(c.pressaoDe(b({ oomKill: 0 }), 1280, undefined, { cpuMaxPct: 200, capMb: 7000, nucleos: 8 }).sugestao, { ramMaxMb: null, cpuPct: null });
});

test("pressão: recentesDe só conta o que subiu desde a leitura anterior, por 10 min; primeira leitura e fatia recriada não contam", () => {
  const c = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  const b = (o = {}) => ({ usoKb: 0, anonKb: 0, picoKb: null, swapKb: 0, evHigh: 0, evMax: 438, oomKill: 1, psiMem10: 0, psiMem60: 0, psiCpu60: 0, cpuPeriodos: 0, cpuEstrangulados: 0, cpuEstranguladoUsec: 0, ...o });
  const t0 = 1_000_000;
  const r1 = c.recentesDe(undefined, b(), t0);
  assert.deepEqual(r1.recentes, { oom: 0, max: 0 }, "primeira leitura: o acumulado é histórico");
  assert.deepEqual(r1.marca, { evMax: 438, oomKill: 1, maxEm: null, maxQtd: 0, oomEm: null, oomQtd: 0 });
  const r2 = c.recentesDe(r1.marca, b(), t0 + 60_000);
  assert.deepEqual(r2.recentes, { oom: 0, max: 0 }, "nada subiu");
  const r3 = c.recentesDe(r2.marca, b({ oomKill: 2, evMax: 441 }), t0 + 120_000);
  assert.deepEqual(r3.recentes, { oom: 1, max: 3 }); assert.equal(r3.marca.oomEm, t0 + 120_000); assert.equal(r3.marca.maxEm, t0 + 120_000);
  const r4 = c.recentesDe(r3.marca, b({ oomKill: 2, evMax: 441 }), t0 + 120_000 + 5 * 60_000);
  assert.deepEqual(r4.recentes, { oom: 1, max: 3 }, "5 min depois ainda conta");
  const r5 = c.recentesDe(r4.marca, b({ oomKill: 2, evMax: 441 }), t0 + 120_000 + c.JANELA_RECENTE_MS);
  assert.deepEqual(r5.recentes, { oom: 0, max: 0 }, "passou a janela");
  const r6 = c.recentesDe(r3.marca, b({ oomKill: 0, evMax: 2 }), t0 + 180_000);
  assert.deepEqual(r6.recentes, { oom: 0, max: 0 }, "contador menor = fatia recriada"); assert.equal(r6.marca.oomEm, null); assert.equal(r6.marca.evMax, 2);
});

test("capacidade: quantas boxes cabem no teto dos usuários com o teto padrão; CPU prometida; governança diz o que falta", () => {
  const c = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  const u = (nome, o = {}) => ({ nome, uid: 1001, sudo: false, cpuMaxPct: 200, swapMaxMb: 256, box: { anonKb: 1 }, ...o });
  const usuarios = [u("box-1"), u("box-2"), u("root-like", { sudo: true }), u("hermes"), u("admin")];
  const cap = c.capacidadeDe({ totalKb: 32_870_400, userSliceMaxKb: null, cpus: 8, padraoMb: 2048, usuarios });
  assert.deepEqual(cap, { boxes: 2, cabem: 14, capMb: 28_890, padraoMb: 2048, reservaAplicada: false, cpuNucleos: 8, cpuPrometidoPct: 400 });
  assert.equal(c.capacidadeDe({ totalKb: 32_870_400, userSliceMaxKb: null, cpus: 8, padraoMb: c.RECURSOS_PADRAO.ramMb, usuarios }).cabem, 9, "o padrão de 3 GB (5 nov, voz): 9 boxes em 32 GB com a reserva de 3 GB");
  assert.equal(c.capacidadeDe({ totalKb: 32_870_400, userSliceMaxKb: 29_491_200, cpus: 8, padraoMb: 2048, usuarios }).reservaAplicada, true);
  assert.equal(c.capacidadeDe({ totalKb: 32_870_400, userSliceMaxKb: null, cpus: 8, padraoMb: 1536, usuarios }).cabem, 18);
  assert.equal(c.capacidadeDe({ totalKb: 32_870_400, userSliceMaxKb: null, cpus: 8, padraoMb: 2048, usuarios: [u("x", { cpuMaxPct: null })] }).cpuPrometidoPct, 800, "sem cota de CPU conta como a máquina inteira");
  assert.deepEqual(c.governancaDe({ userSlice: null, usuarios }), { reserva: false, semIsolamento: [] });
  assert.deepEqual(c.governancaDe({ userSlice: { maxKb: 1, usoKb: 0, anonKb: 0, lowKb: 0 }, usuarios: [u("box-1", { swapMaxMb: null }), u("box-2"), u("velha", { swapMaxMb: null, box: null })] }), { reserva: true, semIsolamento: ["box-1"] }, "sem cgroup lido não dá para saber: fora da lista");
});

test("cota macia e dura: o limite que a pessoa vê e a folga (10% ou 300 MB) com 7 dias de carência; 'perto' a partir de 80%", () => {
  const c = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  assert.equal(c.hardKbDe(1_000_000), 1_307_200, "o piso de 300 MB vence em 1 GB"); assert.equal(c.hardKbDe(5_000_000), 5_500_000); assert.equal(c.hardKbDe(0), 0);
  assert.match(c.limiteSh("ana", 1_000_000), /setquota -u 'ana' 1000000 1307200 0 0 \//); assert.match(c.limiteSh("ana", 1_000_000), /setquota -t 604800 604800 \//);
  assert.match(c.limiteSh("ana", 0), /setquota -u 'ana' 0 0 0 0 \//);
  assert.equal(c.nivelUso(80, 100), "perto"); assert.equal(c.nivelUso(79, 100), "ok"); assert.equal(c.nivelUso(100, 100), "cheio");
});

test("usuários: backend por box vem em linha própria (B) e boxesDesatualizadas compara com a versão do app", () => {
  const { boxesDesatualizadas } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");
  const u = (n, uid, sudo) => `U\t${n}\t${uid}\t/home/${n}\t/bin/bash\t${sudo}\t1\t1\t\t\t0\tinfinity\tinfinity\t`;
  const out = `ROOT\n${u("box-1", 1000, 0)}\nB\tbox-1\t1.8.2\n${u("box-2", 1001, 0)}\nB\tbox-2\t1.9.0\n${u("ana", 1002, 1)}\nB\tana\t1.0.0\n${u("zed", 1003, 0)}\n${u("box-4", 1004, 0)}\nB\tbox-4\t\nB\tbox-9\t1.0.0\nB\tNome Ruim\t1.0.0\n`;
  const r = lerUsuarios(out);
  assert.deepEqual(r.usuarios.map((x) => [x.nome, x.backendInstalado, x.backendVersao]), [["box-1", true, "1.8.2"], ["box-2", true, "1.9.0"], ["ana", true, "1.0.0"], ["zed", false, null], ["box-4", true, null]]);
  // sem versão gravada conta como antigo; sudo e sem backend ficam de fora; app sem VERSION = nenhuma; 1.10 > 1.9.
  assert.deepEqual(boxesDesatualizadas(r.usuarios, "1.9.0"), ["box-1", "box-4"]);
  assert.deepEqual(boxesDesatualizadas(r.usuarios, "1.10.0"), ["box-1", "box-2", "box-4"]);
  assert.deepEqual(boxesDesatualizadas(r.usuarios, null), []);
  assert.match(LISTAR_SH, /\$bd\/VERSION/); assert.match(LISTAR_SH, /share\/meu-bot\/backend"/); assert.match(LISTAR_SH, /printf 'B\\t%s\\t%s\\n'/); assert.match(LISTAR_SH, /\[ -f "\$bd\/server\.js" \]/);
});

test("usuários: o script sai com 0 mesmo quando o último usuário não tem o backend do meu-bot", async () => {
  // Rodado aqui mesmo: root e /etc/passwd trocados por um arquivo de teste com dois usuários, o último sem backend.
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "listar-"));
  const com = path.join(dir, "com"); fs.mkdirSync(path.join(com, ".local/share/meu-bot/backend"), { recursive: true });
  fs.writeFileSync(path.join(com, ".local/share/meu-bot/backend/.env"), "X=1\n"); fs.writeFileSync(path.join(com, ".local/share/meu-bot/backend/server.js"), ""); fs.writeFileSync(path.join(com, ".local/share/meu-bot/backend/VERSION"), "1.2.3\n");
  const sem = path.join(dir, "sem"); fs.mkdirSync(sem);
  const passwd = path.join(dir, "passwd");
  fs.writeFileSync(passwd, `com:x:1001:1001::${com}:/bin/bash\nsem:x:1002:1002::${sem}:/bin/bash\n`);
  const sh = LISTAR_SH.replace('[ "$(id -u)" = 0 ]', "true").replaceAll("/etc/passwd", passwd);
  const out = execFileSync("bash", ["-s"], { input: sh, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
  assert.match(out, /^B\tcom\t1\.2\.3$/m);
  assert.deepEqual(lerUsuarios(out).usuarios.map((u) => [u.nome, u.backendInstalado]), [["com", true], ["sem", false]]);
});

test("limite mínimo da conta padrão: 3 GB; pctMinimo é a menor % que dá isso; conferirMinimo recusa menos (0 = sem limite passa)", () => {
  assert.equal(MINIMO_CONTA_KB, 3 * 1024 * 1024);
  assert.equal(pctMinimo(100 * 1024 * 1024), 3, "disco de 100 GB: 1% dá 1 GB, 3% dá 3 GB");
  assert.equal(pctMinimo(20 * 1024 * 1024), 15, "disco de 20 GB: 15%");
  assert.equal(pctMinimo(1024 * 1024), 100, "disco de 1 GB: nem o disco inteiro dá; 100");
  assert.throws(() => conferirMinimo(1, 100 * 1024 * 1024), /1% deste disco dá 1024 MB, menos que os 3 GB.*use pelo menos 3%/);
  assert.doesNotThrow(() => conferirMinimo(3, 100 * 1024 * 1024));
  assert.doesNotThrow(() => conferirMinimo(0, 100 * 1024 * 1024), "0 = sem limite");
});
