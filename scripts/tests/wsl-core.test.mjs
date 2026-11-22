// "Este Windows" (src/main/maquina/wsl-core.ts): ler o wsl.exe, decidir o passo do preparo, o rootfs por arquitetura,
// o SHA256 do SHA256SUMS e os scripts/arquivos do ~/.ssh. O runner do GitHub já tem o WSL, então o caminho
// "sem-wsl → instalar → reiniciar" só é coberto aqui.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const w = require("../../dist/main/maquina/wsl-core.js");
const { PRODUTOS } = require("../../dist/main/app/variant-core.js");

const n = w.nomesWsl("meu-bot-staging", 2291);
const utf16 = (s) => Buffer.from(`\uFEFF${s}`, "utf16le");

test("nomes: distro, alias e arquivos por produto; o estável é o meu-bot-wsl", () => {
  assert.deepEqual(w.nomesWsl("meu-bot", 2290), { distro: "meu-bot", alias: "meu-bot-wsl", conf: "meu-bot-wsl.conf", chave: "meu-bot-wsl_ed25519", knownHosts: "meu-bot-wsl_known_hosts", porta: 2290 });
  assert.equal(n.alias, "meu-bot-staging-wsl");
  // Cada produto com a sua porta: dois apps abertos juntos não dividem o sshd.
  const portas = PRODUTOS.map((p) => p.portaWsl);
  assert.equal(new Set(portas).size, portas.length, `portaWsl repetida: ${portas.join(", ")}`);
  for (const p of PRODUTOS) assert.ok(p.portaWsl > 1024 && p.portaWsl < 65536, p.variant);
});

test("texto do wsl.exe: UTF-8 (WSL_UTF8=1) e UTF-16LE com BOM saem iguais", () => {
  const lista = "  NAME       STATE           VERSION\r\n* meu-bot    Stopped         2\r\n";
  const esperado = "  NAME       STATE           VERSION\n* meu-bot    Stopped         2\n";
  assert.equal(w.textoDoWsl(Buffer.from(lista, "utf8")), esperado);
  assert.equal(w.textoDoWsl(utf16(lista)), esperado);
  assert.equal(w.textoDoWsl(utf16("Versão Padrão: 2")), "Versão Padrão: 2");
  assert.equal(w.textoDoWsl(Buffer.from("Versão Padrão: 2", "utf8")), "Versão Padrão: 2");
  assert.equal(w.textoDoWsl(new Uint8Array()), "");
});

test("lista do wsl -l -v: padrão, versão, cabeçalho traduzido e lista vazia", () => {
  const t = "  NOME            ESTADO          VERSÃO\n* Ubuntu          Running         2\n  meu-bot-staging Stopped         1\n  docker-desktop  Stopped         2\n";
  assert.deepEqual(w.lerListaWsl(t), [
    { nome: "Ubuntu", estado: "Running", versao: 2, padrao: true },
    { nome: "meu-bot-staging", estado: "Stopped", versao: 1, padrao: false },
    { nome: "docker-desktop", estado: "Stopped", versao: 2, padrao: false },
  ]);
  assert.deepEqual(w.lerListaWsl("Windows Subsystem for Linux has no installed distributions.\nYou can resolve this by installing a distribution with the instructions below:\n"), []);
});

const base = (o = {}) => ({
  arquitetura: "amd64",
  status: { rc: 0, texto: "Default Version: 2\n" },
  lista: { rc: 0, texto: "  NAME  STATE  VERSION\n* meu-bot-staging  Running  2\n" },
  instalacaoPedidaEm: null, ligadoDesde: 1_000_000, nomes: n, preparo: w.PREPARO_VERSAO, arquivosLocais: true, ...o,
});

test("estado: o primeiro passo que falta, na ordem do preparo", () => {
  assert.equal(w.decidirEstadoWsl(base()), "pronto");
  assert.equal(w.decidirEstadoWsl(base({ arquitetura: null })), "sem-suporte");
  // Sem o WSL: o wsl.exe nem existe, o stub diz que não está instalado (en e pt), ou o --status falha.
  assert.equal(w.decidirEstadoWsl(base({ status: { rc: null, texto: "spawn wsl.exe ENOENT" } })), "sem-wsl");
  assert.equal(w.decidirEstadoWsl(base({ status: { rc: 1, texto: "Windows Subsystem for Linux is not installed. You can install by running 'wsl.exe --install'." } })), "sem-wsl");
  assert.equal(w.decidirEstadoWsl(base({ status: { rc: 0, texto: "O Subsistema do Windows para Linux não está instalado. Você pode instalar executando 'wsl.exe --install'." } })), "sem-wsl");
  // Com o WSL e sem a distro do app (a da pessoa, "Ubuntu", não conta), ou sem distro nenhuma.
  assert.equal(w.decidirEstadoWsl(base({ lista: { rc: 0, texto: "* Ubuntu  Running  2\n" } })), "sem-distro");
  assert.equal(w.decidirEstadoWsl(base({ lista: { rc: -1, texto: "Windows Subsystem for Linux has no installed distributions." } })), "sem-distro");
  // Distro importada, preparo por fazer, de versão anterior, ou arquivos do ~/.ssh faltando.
  assert.equal(w.decidirEstadoWsl(base({ preparo: null })), "sem-sshd");
  assert.equal(w.decidirEstadoWsl(base({ preparo: w.PREPARO_VERSAO - 1 })), "sem-sshd");
  assert.equal(w.decidirEstadoWsl(base({ arquivosLocais: false })), "sem-sshd");
});

test("estado: instalar o WSL → reiniciar → retomar", () => {
  const naoInstalado = { rc: 1, texto: "Windows Subsystem for Linux is not installed." };
  // O app pediu a instalação depois do último boot: falta reiniciar (e não instalar de novo).
  assert.equal(w.decidirEstadoWsl(base({ status: naoInstalado, instalacaoPedidaEm: 2_000_000, ligadoDesde: 1_000_000 })), "precisa-reiniciar");
  // O wsl.exe pede o reinício ele mesmo (componente pendente).
  assert.equal(w.decidirEstadoWsl(base({ status: { rc: 1, texto: "The requested operation requires a system restart." } })), "precisa-reiniciar");
  // Reiniciou e o WSL respondeu: segue para a distro.
  assert.equal(w.decidirEstadoWsl(base({ instalacaoPedidaEm: 500_000, ligadoDesde: 1_000_000, lista: { rc: -1, texto: "" } })), "sem-distro");
  // Reiniciou e o WSL ainda não responde: oferece instalar de novo (não fica preso em "reinicie").
  assert.equal(w.decidirEstadoWsl(base({ status: naoInstalado, instalacaoPedidaEm: 500_000, ligadoDesde: 1_000_000 })), "sem-wsl");
});

test("texto do cartão: botão só onde o app pode agir", () => {
  for (const e of w.ESTADOS_WSL) assert.ok(w.textoDoEstadoWsl(e).texto.length > 10, e);
  assert.deepEqual(w.ESTADOS_WSL.filter((e) => w.textoDoEstadoWsl(e).acao), ["sem-wsl", "sem-distro", "sem-sshd"]);
  assert.match(w.textoDoEstadoWsl("precisa-reiniciar").texto, /reinicie o Windows/);
  assert.match(w.textoDoEstadoWsl("sem-wsl").texto, /administrador/);
});

test("arquitetura: a do Windows, não a do app x64 emulado no ARM", () => {
  assert.equal(w.arquiteturaDoWindows({ PROCESSOR_ARCHITECTURE: "AMD64" }), "amd64");
  assert.equal(w.arquiteturaDoWindows({ PROCESSOR_ARCHITECTURE: "ARM64" }), "arm64");
  // App x64 emulado num Windows ARM: PROCESSOR_ARCHITECTURE diz AMD64, PROCESSOR_ARCHITEW6432 diz a real.
  assert.equal(w.arquiteturaDoWindows({ PROCESSOR_ARCHITECTURE: "AMD64", PROCESSOR_ARCHITEW6432: "ARM64" }), "arm64");
  assert.equal(w.arquiteturaDoWindows({ PROCESSOR_ARCHITECTURE: "x86" }), null);
  assert.equal(w.arquiteturaDoWindows({}), null);
});

test("rootfs por arquitetura e o SHA256 do SHA256SUMS da mesma pasta", () => {
  const a = w.rootfsDe("amd64"), b = w.rootfsDe("arm64");
  assert.equal(a.url, "https://cloud-images.ubuntu.com/wsl/releases/24.04/current/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz");
  assert.equal(b.arquivo, "ubuntu-noble-wsl-arm64-wsl.rootfs.tar.gz");
  assert.equal(a.sums, "https://cloud-images.ubuntu.com/wsl/releases/24.04/current/SHA256SUMS");
  const sums = [
    "2a790896740b14d637dbdc583cce1ba081ac53b9e9cdb46dc09a2f73abbd9934  ubuntu-noble-wsl-amd64-24.04lts.rootfs.tar.gz",
    "8251E27FFFF381A4AF5F41DCB94D867DE3E0D9774A9241908AB34555D99315EA *ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz",
    "fecec1d9b7b750c12c109edb49c13c1006f4a2efabb9b8bf341f11c4c9f2ef11  ubuntu-noble-wsl-arm64-wsl.rootfs.tar.gz",
  ].join("\r\n");
  assert.equal(w.sha256DoSums(sums, a.arquivo), "8251e27ffff381a4af5f41dcb94d867de3e0d9774a9241908ab34555d99315ea");
  assert.equal(w.sha256DoSums(sums, b.arquivo), "fecec1d9b7b750c12c109edb49c13c1006f4a2efabb9b8bf341f11c4c9f2ef11");
  // Nome parecido não vale (o 24.04lts é outro arquivo).
  assert.equal(w.sha256DoSums(sums, "ubuntu-noble-wsl-amd64.rootfs.tar.gz"), null);
});

test("virtualização: o recuo para WSL1 reconhece o erro do WSL2", () => {
  assert.equal(w.pedeVirtualizacao("Please enable the Virtual Machine Platform Windows feature and ensure virtualization is enabled in the BIOS.\nError code: Wsl/Service/RegisterDistro/CreateVm/HCS/HCS_E_HYPERV_NOT_INSTALLED"), true);
  assert.equal(w.pedeVirtualizacao("Habilite o recurso Plataforma de Máquina Virtual do Windows"), true);
  assert.equal(w.pedeVirtualizacao("The system cannot find the file specified."), false);
});

test("chaves: a do app é refeita do zero; lixo e injeção não passam", () => {
  const b64 = "AAAAC3NzaC1lZDI1NTE5AAAAIHk1PMlNh8tq0D4+3lVt7xOI6UOT4h0dSz2tZx7c0f1a";
  assert.equal(w.chavePublicaLimpa(`ssh-ed25519 ${b64} runneradmin@fv-az123\r\n`, n.alias), `ssh-ed25519 ${b64} meu-bot-staging-wsl`);
  assert.equal(w.chavePublicaLimpa(`ssh-ed25519 ${b64}' ; rm -rf / '`, n.alias), null);
  assert.equal(w.chavePublicaLimpa(`ssh-rsa ${b64}`, n.alias), null);
  assert.equal(w.chavePublicaLimpa(`ssh-ed25519 ${b64}`, "x'y"), null);
  assert.equal(w.chaveDoHost(`ssh-ed25519 ${b64} root@pc\n`), `ssh-ed25519 ${b64}`);
  assert.equal(w.chaveDoHost("cat: /etc/ssh/ssh_host_ed25519_key.pub: No such file or directory"), null);
  assert.equal(w.knownHostsDoAlias(n, `ssh-ed25519 ${b64}`), `meu-bot-staging-wsl ssh-ed25519 ${b64}\n`);
});

test("sshd do app: só 127.0.0.1, só o usuário comum, só por chave, na porta do produto", () => {
  const c = w.sshdConfig(2291);
  for (const l of ["Port 2291", "ListenAddress 127.0.0.1", "PasswordAuthentication no", "PermitRootLogin no", `AllowUsers ${w.USUARIO_WSL}`, `PidFile ${w.SSHD_PID}`]) assert.ok(c.split("\n").includes(l), l);
  assert.doesNotMatch(c, /0\.0\.0\.0|ListenAddress ::/);
  const p = w.scriptPreparo(2291, "ssh-ed25519 AAAA meu-bot-staging-wsl");
  assert.match(p, /^set -e/);
  assert.match(p, /useradd -m -s \/bin\/bash meubot/);
  assert.match(p, /'ssh-ed25519 AAAA meu-bot-staging-wsl' > \/home\/meubot\/\.ssh\/authorized_keys/);
  assert.match(p, /\/usr\/sbin\/sshd -t -f \/etc\/ssh\/meu-bot\/sshd_config/);
  assert.ok(p.includes(`echo ${w.PREPARO_VERSAO} > ${w.MARCA_PREPARO}`));
  assert.ok(p.trimEnd().endsWith("echo preparo-ok"));
  // O heredoc da config fecha numa linha própria (senão o resto do script vira config).
  assert.match(p, /\nMEU_BOT_SSHD\n/);
  // O ssh do Ubuntu fica desligado; quem escuta é o sshd do app.
  assert.match(w.scriptPacotes(), /systemctl disable --now ssh\.socket ssh\.service/);
  assert.match(w.scriptPacotes(), /openssh-server python3 curl/);
  // Manter de pé: sobe o sshd se não está no ar e fica dormindo (o wsl.exe filho segura a distro).
  assert.match(w.scriptManterDePe(), /kill -0 .*\/usr\/sbin\/sshd -f \/etc\/ssh\/meu-bot\/sshd_config.*exec sleep infinity$/);
});

test("~/.ssh: o alias num arquivo próprio e o Include no topo do config, uma vez só", () => {
  const conf = w.confDoAlias(n);
  for (const l of ["Host meu-bot-staging-wsl", "    HostName 127.0.0.1", "    Port 2291", "    User meubot", "    IdentityFile ~/.ssh/meu-bot-staging-wsl_ed25519", "    IdentitiesOnly yes", "    HostKeyAlias meu-bot-staging-wsl", "    UserKnownHostsFile ~/.ssh/meu-bot-staging-wsl_known_hosts", "    StrictHostKeyChecking yes"]) assert.ok(conf.split("\n").includes(l), l);
  assert.equal(w.configComInclude("", n), "Include ~/.ssh/meu-bot-staging-wsl.conf\n");
  const antes = "Host vps\n    HostName 203.0.113.7\n";
  const depois = w.configComInclude(antes, n);
  assert.equal(depois, `Include ~/.ssh/meu-bot-staging-wsl.conf\n\n${antes}`);
  assert.equal(w.configComInclude(depois, n), null);
  assert.equal(w.configComInclude("Include ~/.ssh/meu-bot-staging-wsl.conf\r\nHost x\r\n", n), null);
});
