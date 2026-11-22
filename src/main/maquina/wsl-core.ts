/**
 * "Este Windows": a máquina Linux (WSL) que o app do Windows prepara no próprio PC e alcança por SSH em 127.0.0.1,
 * como uma máquina qualquer do ~/.ssh/config. Aqui só a parte pura (testável com node --test): ler o que o wsl.exe
 * diz, decidir em que passo o preparo está, escolher o rootfs do Ubuntu pela arquitetura e montar os scripts e os
 * arquivos do ~/.ssh. Quem executa é o wsl.ts.
 *
 * Os passos, cada um refazível: `sem-wsl` (instalar o WSL, pede administrador) → `precisa-reiniciar` (o Windows
 * reinicia; o preparo retoma na abertura seguinte) → `sem-distro` (baixa o Ubuntu e importa como distro própria, que
 * não mexe em distro nenhuma da pessoa) → `sem-sshd` (pacotes, usuário comum, sshd só em 127.0.0.1, chave e alias)
 * → `pronto`. Depois disso o seletor trata o alias como máquina SSH comum: instalar o backend, túnel, terminal e
 * WhatsApp são os de sempre.
 */

/** Sobe quando o preparo de dentro da distro muda (sshd_config, pacotes): uma distro de preparo anterior refaz o passo `sem-sshd`. */
export const PREPARO_VERSAO = 1;
/** O usuário comum da distro: é nele que o app entra (o backend não roda como root). */
export const USUARIO_WSL = "meubot";

export type EstadoWsl = "sem-suporte" | "sem-wsl" | "precisa-reiniciar" | "sem-distro" | "sem-sshd" | "pronto";
export const ESTADOS_WSL: readonly EstadoWsl[] = ["sem-suporte", "sem-wsl", "precisa-reiniciar", "sem-distro", "sem-sshd", "pronto"];

/** Nomes de um produto no Windows: distro, alias e arquivos no ~/.ssh. Um por produto, como a porta: o staging não mexe no do estável. */
export interface NomesWsl {
  /** Distro registrada no WSL: o nome do app ("meu-bot", "meu-bot-staging"). */
  distro: string;
  /** Alias no ~/.ssh/config: "meu-bot-wsl", "meu-bot-staging-wsl". */
  alias: string;
  /** Arquivo incluído no ~/.ssh/config, relativo a ~/.ssh. */
  conf: string;
  /** Chave privada, relativa a ~/.ssh (a .pub ao lado). */
  chave: string;
  /** known_hosts só deste alias, relativo a ~/.ssh: a chave do sshd da distro, gravada pelo app (nada de aceitar às cegas). */
  knownHosts: string;
  /** Porta do sshd dentro da distro, em 127.0.0.1. */
  porta: number;
}

export function nomesWsl(nomeDoApp: string, porta: number): NomesWsl {
  const alias = `${nomeDoApp}-wsl`;
  return { distro: nomeDoApp, alias, conf: `${alias}.conf`, chave: `${alias}_ed25519`, knownHosts: `${alias}_known_hosts`, porta };
}

/**
 * Texto do wsl.exe. Com `WSL_UTF8=1` no ambiente ele escreve UTF-8; sem ela (WSL antigo, ou a variável que não chegou)
 * escreve UTF-16LE, que lido como UTF-8 vira letras separadas por \0. Detecta pelos zeros, tira o BOM e os \r.
 */
export function textoDoWsl(bytes: Uint8Array): string {
  let zerosImpares = 0;
  const n = Math.min(bytes.length, 400);
  for (let i = 1; i < n; i += 2) if (bytes[i] === 0) zerosImpares++;
  const utf16 = n >= 4 && zerosImpares >= Math.floor(n / 2) * 0.6;
  const texto = new TextDecoder(utf16 ? "utf-16le" : "utf-8").decode(bytes);
  return texto.replace(/^\uFEFF/, "").replace(/\0/g, "").replace(/\r/g, "");
}

/** Uma distro da lista do `wsl -l -v`. */
export interface DistroWsl { nome: string; estado: string; versao: 1 | 2; padrao: boolean }

/**
 * `wsl -l -v`: cabeçalho (traduzido: NAME/NOME, STATE/ESTADO, VERSION/VERSÃO) e uma linha por distro, `*` na padrão.
 * Nome de distro não tem espaço; a versão é o último campo. Sem distro nenhuma o wsl.exe escreve uma frase e sai com
 * erro: a lista sai vazia.
 */
export function lerListaWsl(texto: string): DistroWsl[] {
  const out: DistroWsl[] = [];
  for (const bruta of texto.split("\n")) {
    const linha = bruta.trim();
    const padrao = linha.startsWith("*");
    const campos = linha.replace(/^\*\s*/, "").split(/\s+/).filter((c) => c !== "");
    if (campos.length < 3) continue;
    const v = campos[campos.length - 1];
    if (v !== "1" && v !== "2") continue;
    out.push({ nome: campos[0]!, estado: campos.slice(1, -1).join(" "), versao: v === "1" ? 1 : 2, padrao });
  }
  return out;
}

/** O wsl.exe disse que o WSL não está instalado (o stub da caixa do Windows responde isso a qualquer comando). */
const NAO_INSTALADO_RE = /not installed|não está instalado|nao esta instalado|wsl(\.exe)? --install|no est[aá] instalado/i;
/** O WSL foi instalado mas o Windows ainda não reiniciou (componente pendente). */
const REINICIAR_RE = /restart|reboot|reinici/i;
/** O WSL2 não sobe aqui: sem virtualização no firmware ou na VM (o recuo é importar como WSL1). */
const SEM_VIRTUALIZACAO_RE = /virtuali[sz]a|HCS_E_HYPERV_NOT_INSTALLED|0x80370102|Hyper-V|Virtual Machine Platform|Plataforma de M[aá]quina Virtual/i;
export const pedeVirtualizacao = (texto: string): boolean => SEM_VIRTUALIZACAO_RE.test(texto);

/** Resultado de um comando do wsl.exe; `rc` null = o wsl.exe nem rodou (não existe neste Windows). */
export interface SaidaWsl { rc: number | null; texto: string }

/** O que se sabe da máquina para decidir o passo (wsl.ts junta; aqui é só a decisão). */
export interface SinaisWsl {
  /** O Windows tem a arquitetura que o Ubuntu do WSL cobre (x64 ou ARM64). */
  arquitetura: ArqWsl | null;
  /** `wsl --status`. */
  status: SaidaWsl;
  /** `wsl -l -v` (só conta quando o status respondeu). */
  lista: SaidaWsl;
  /** Quando o app pediu a instalação do WSL (ms); null = nunca pediu. */
  instalacaoPedidaEm: number | null;
  /** Quando o Windows ligou (ms): instalação pedida depois disso = ainda não reiniciou. */
  ligadoDesde: number;
  nomes: NomesWsl;
  /** Versão do preparo gravada dentro da distro (/etc/meu-bot/wsl-preparo); null = sem o arquivo ou distro que não respondeu. */
  preparo: number | null;
  /** Chave, .conf, known_hosts e o Include do ~/.ssh/config estão no lugar. */
  arquivosLocais: boolean;
}

export function wslInstalado(status: SaidaWsl): boolean {
  return status.rc === 0 && !NAO_INSTALADO_RE.test(status.texto);
}

/** O passo em que o preparo está. A ordem é a do preparo: o primeiro que falta é o estado. */
export function decidirEstadoWsl(s: SinaisWsl): EstadoWsl {
  if (s.arquitetura === null) return "sem-suporte";
  if (!wslInstalado(s.status)) {
    const pediuAntesDeReiniciar = s.instalacaoPedidaEm !== null && s.instalacaoPedidaEm >= s.ligadoDesde;
    if (pediuAntesDeReiniciar || (s.status.rc !== null && REINICIAR_RE.test(s.status.texto) && !NAO_INSTALADO_RE.test(s.status.texto))) return "precisa-reiniciar";
    return "sem-wsl";
  }
  if (!lerListaWsl(s.lista.texto).some((d) => d.nome.toLowerCase() === s.nomes.distro.toLowerCase())) return "sem-distro";
  if (s.preparo !== PREPARO_VERSAO || !s.arquivosLocais) return "sem-sshd";
  return "pronto";
}

/** O que o cartão "Este Windows" diz em cada passo, e se oferece o botão. */
export function textoDoEstadoWsl(e: EstadoWsl): { texto: string; acao: boolean } {
  switch (e) {
    case "sem-suporte": return { texto: "✗ este Windows não é x64 nem ARM64: o Linux do WSL não roda nele.", acao: false };
    case "sem-wsl": return { texto: "⚠ este Windows ainda não tem o agente. \"Preparar este Windows\" instala o WSL (o Windows pede permissão de administrador e depois um reinício), baixa o Ubuntu (~350 MB) e deixa tudo pronto.", acao: true };
    case "precisa-reiniciar": return { texto: "⚠ o WSL foi instalado: reinicie o Windows. Ao abrir o app de novo, o preparo continua sozinho.", acao: false };
    case "sem-distro": return { texto: "⚠ o WSL está pronto; falta o Linux do agente. \"Preparar este Windows\" baixa o Ubuntu (~350 MB) numa distro própria, sem mexer em outra que você tenha.", acao: true };
    case "sem-sshd": return { texto: "⚠ o Linux do agente está instalado, mas o preparo não terminou. \"Preparar este Windows\" continua de onde parou.", acao: true };
    case "pronto": return { texto: "✓ este Windows está pronto.", acao: false };
  }
}

export type ArqWsl = "amd64" | "arm64";

/**
 * Arquitetura de verdade do Windows. O app é x64 e, num Windows ARM, roda emulado: lá `process.arch` diz x64 e o
 * Windows põe a real em PROCESSOR_ARCHITEW6432 (processo emulado) ou PROCESSOR_ARCHITECTURE. A distro tem de ser a da
 * máquina, não a do app.
 */
export function arquiteturaDoWindows(env: Record<string, string | undefined>): ArqWsl | null {
  return arqDoNome(env.PROCESSOR_ARCHITEW6432 ?? env.PROCESSOR_ARCHITECTURE ?? "");
}

function arqDoNome(nome: string): ArqWsl | null {
  const a = nome.trim().toUpperCase();
  if (a === "AMD64" || a === "X64") return "amd64";
  if (a === "ARM64") return "arm64";
  return null;
}

/**
 * A arquitetura pelo registro (`reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v
 * PROCESSOR_ARCHITECTURE`). É a fonte certa: o app x64 emulado num Windows ARM recebe `PROCESSOR_ARCHITECTURE=AMD64`
 * no ambiente (o PROCESSOR_ARCHITEW6432 só existe no x86 do WOW64), e o Ubuntu amd64 importado ali não roda nada
 * ("execvpe(bash) failed: Exec format error", VM meu-bot-win, 22 nov 2026). null = a saída não diz.
 */
export function arquiteturaDoRegistro(saida: string): ArqWsl | null {
  const m = /PROCESSOR_ARCHITECTURE\s+REG_SZ\s+(\S+)/i.exec(saida);
  return m === null ? null : arqDoNome(m[1]!);
}

/** O registro manda; o ambiente só quando o registro não respondeu. */
export const arquiteturaReal = (registro: string, env: Record<string, string | undefined>): ArqWsl | null =>
  arquiteturaDoRegistro(registro) ?? arquiteturaDoWindows(env);

/** O Linux da distro é de outra arquitetura (importado errado): é preciso apagar e importar de novo. */
export const formatoErrado = (texto: string): boolean => /Exec format error/i.test(texto);

/** Pasta do Ubuntu 24.04 para WSL no cloud-images: o rootfs de cada arquitetura e o SHA256SUMS ficam nela. */
export const PASTA_ROOTFS = "https://cloud-images.ubuntu.com/wsl/releases/24.04/current/";
export function rootfsDe(arq: ArqWsl): { arquivo: string; url: string; sums: string } {
  const arquivo = `ubuntu-noble-wsl-${arq}-wsl.rootfs.tar.gz`;
  return { arquivo, url: `${PASTA_ROOTFS}${arquivo}`, sums: `${PASTA_ROOTFS}SHA256SUMS` };
}

/** O SHA256 de `arquivo` num SHA256SUMS (`<hex>  <nome>` ou `<hex> *<nome>`); null = não está lá. */
export function sha256DoSums(sums: string, arquivo: string): string | null {
  for (const linha of sums.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$/.exec(linha.trim());
    if (m !== null && m[2] === arquivo) return m[1]!.toLowerCase();
  }
  return null;
}

/**
 * A chave pública do app, refeita do zero: só o tipo e o base64, com o alias de comentário. O texto vai para dentro de
 * um script de root; nada do arquivo .pub passa sem ser conferido.
 */
export function chavePublicaLimpa(pub: string, comentario: string): string | null {
  const m = /^(ssh-ed25519) ([A-Za-z0-9+/]+={0,2})(?:\s.*)?$/.exec(pub.trim());
  if (m === null || !/^[A-Za-z0-9._-]+$/.test(comentario)) return null;
  return `${m[1]} ${m[2]} ${comentario}`;
}

/** A chave do sshd da distro (`/etc/ssh/ssh_host_ed25519_key.pub`), só tipo e base64; null = não é uma chave. */
export function chaveDoHost(pub: string): string | null {
  const m = /^(ssh-ed25519) ([A-Za-z0-9+/]+={0,2})(?:\s.*)?$/.exec(pub.trim());
  return m === null ? null : `${m[1]} ${m[2]}`;
}

/** Onde mora a config do sshd próprio do app dentro da distro (separada da do Ubuntu, que fica desligada). */
export const SSHD_CONFIG = "/etc/ssh/meu-bot/sshd_config";
export const SSHD_PID = "/run/meu-bot-sshd.pid";
export const MARCA_PREPARO = "/etc/meu-bot/wsl-preparo";

/** O sshd do app: só 127.0.0.1, só o usuário comum, só por chave. */
export function sshdConfig(porta: number): string {
  return [
    "# Gerado pelo meu-bot: o sshd que o app do Windows usa para entrar nesta distro. Não edite à mão.",
    `Port ${porta}`,
    "ListenAddress 127.0.0.1",
    `PidFile ${SSHD_PID}`,
    "HostKey /etc/ssh/ssh_host_ed25519_key",
    "PubkeyAuthentication yes",
    "PasswordAuthentication no",
    "KbdInteractiveAuthentication no",
    "PermitRootLogin no",
    `AllowUsers ${USUARIO_WSL}`,
    "UsePAM yes",
    "PrintMotd no",
    "AcceptEnv LANG LC_*",
    "Subsystem sftp /usr/lib/openssh/sftp-server",
    "",
  ].join("\n");
}

/** Liga o sshd do app se ainda não está no ar (pelo pidfile). Vale no fim do preparo e a cada abertura do app. */
export function scriptSubirSshd(): string {
  return `mkdir -p /run/sshd; if [ -f ${SSHD_PID} ] && kill -0 "$(cat ${SSHD_PID})" 2>/dev/null; then echo sshd-no-ar; else /usr/sbin/sshd -f ${SSHD_CONFIG} && echo sshd-subiu; fi`;
}

/** Pasta do backend do usuário da distro (a padrão do install.sh, backend-dir-core.ts). */
export const BACKEND_WSL = `/home/${USUARIO_WSL}/.local/share/meu-bot/backend`;

/**
 * Sem systemd (WSL1, ou WSL2 sem `systemd=true`) o install.sh sobe o backend por nohup, e nada o traz de volta quando a
 * distro reinicia (Windows reiniciado, app fechado): sobe aqui, como o usuário comum, se está instalado e a porta do
 * .env não atende. `curl` com saída 7 = nada escutando (o `ss` não funciona no WSL1). Com systemd, é com ele.
 */
export function scriptSubirBackend(): string {
  const bd = BACKEND_WSL;
  return [
    `if [ ! -d /run/systemd/system ] && [ -f ${bd}/server.js ] && [ -f ${bd}/.env ]; then`,
    `  P=$(sed -n 's/^PORT=//p' ${bd}/.env | head -1); P=\${P:-8080}`,
    `  curl -s -o /dev/null -m 3 "http://127.0.0.1:$P/"; if [ $? -eq 7 ]; then`,
    `    N=; for n in /home/${USUARIO_WSL}/.local/node/bin/node /usr/local/bin/node /usr/bin/node; do [ -x "$n" ] && N=$n && break; done`,
    `    if [ -n "$N" ]; then cd ${bd} && runuser -u ${USUARIO_WSL} -- env OPENAI_COMPAT_SESSIONS_PATH=${bd}/data/openai-compat-sessions.json setsid -f "$N" server.js >> ${bd}/backend.log 2>&1 < /dev/null && echo backend-subiu; fi`,
    "  fi",
    "fi",
  ].join("\n");
}

/**
 * O processo que mantém a distro de pé enquanto o app está aberto: sobe o sshd (e o backend, sem systemd) e fica
 * dormindo. Sem nenhum wsl.exe aberto o WSL desliga a distro em segundos, e o sshd vai junto.
 */
export function scriptManterDePe(): string {
  return `${scriptSubirSshd()}\n${scriptSubirBackend()}\nexec sleep infinity`;
}

/** Pacotes do preparo (como root, sem perguntas). O ssh do Ubuntu fica desligado: quem escuta é o sshd do app. */
export function scriptPacotes(): string {
  return [
    "set -e",
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get update -qq",
    "apt-get install -y -qq openssh-server python3 curl openssl ca-certificates sudo >/dev/null",
    "(systemctl disable --now ssh.socket ssh.service >/dev/null 2>&1 || service ssh stop >/dev/null 2>&1 || true)",
    "echo pacotes-ok",
  ].join("\n");
}

/**
 * Usuário comum com sudo sem senha (a distro é só do app; o install.sh do backend usa `sudo -n` onde precisa), a
 * chave do app no authorized_keys, a config do sshd e a marca da versão do preparo. Refazível: rodar de novo só
 * regrava os arquivos.
 */
export function scriptPreparo(porta: number, chavePub: string): string {
  const u = USUARIO_WSL;
  return [
    "set -e",
    `id -u ${u} >/dev/null 2>&1 || useradd -m -s /bin/bash ${u}`,
    `printf '%s\\n' '${u} ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/meu-bot && chmod 440 /etc/sudoers.d/meu-bot`,
    `install -d -m 700 -o ${u} -g ${u} /home/${u}/.ssh`,
    `printf '%s\\n' '${chavePub}' > /home/${u}/.ssh/authorized_keys`,
    `chown ${u}:${u} /home/${u}/.ssh/authorized_keys && chmod 600 /home/${u}/.ssh/authorized_keys`,
    "[ -f /etc/ssh/ssh_host_ed25519_key ] || ssh-keygen -q -t ed25519 -N '' -f /etc/ssh/ssh_host_ed25519_key",
    "install -d -m 755 /etc/ssh/meu-bot /etc/meu-bot",
    `cat > ${SSHD_CONFIG} <<'MEU_BOT_SSHD'\n${sshdConfig(porta)}MEU_BOT_SSHD`,
    // O sshd (até o `-t`) recusa sem o diretório de separação de privilégio, que some a cada boot da distro (/run é tmpfs).
    "mkdir -p /run/sshd",
    `/usr/sbin/sshd -t -f ${SSHD_CONFIG}`,
    // Config nova numa distro que já tinha o sshd do app no ar: derruba o antigo para subir com a nova.
    `if [ -f ${SSHD_PID} ]; then kill "$(cat ${SSHD_PID})" 2>/dev/null || true; rm -f ${SSHD_PID}; sleep 0.5; fi`,
    scriptSubirSshd(),
    `echo ${PREPARO_VERSAO} > ${MARCA_PREPARO}`,
    "echo preparo-ok",
  ].join("\n");
}

/** O bloco do alias, no arquivo próprio incluído no ~/.ssh/config (o molde do meu-bot-suporte.conf). */
export function confDoAlias(n: NomesWsl): string {
  return [
    `# Gerado pelo ${n.distro}: a máquina Linux (WSL) deste Windows. Não edite à mão; o app regrava.`,
    `Host ${n.alias}`,
    "    HostName 127.0.0.1",
    `    Port ${n.porta}`,
    `    User ${USUARIO_WSL}`,
    `    IdentityFile ~/.ssh/${n.chave}`,
    "    IdentitiesOnly yes",
    `    HostKeyAlias ${n.alias}`,
    `    UserKnownHostsFile ~/.ssh/${n.knownHosts}`,
    "    StrictHostKeyChecking yes",
    "",
  ].join("\n");
}

export const knownHostsDoAlias = (n: NomesWsl, chaveHost: string): string => `${n.alias} ${chaveHost}\n`;
export const linhaInclude = (n: NomesWsl): string => `Include ~/.ssh/${n.conf}`;

/**
 * O ~/.ssh/config com o Include do alias no topo (antes de qualquer Host: depois dele, o Include só valeria dentro do
 * bloco anterior). null = já está lá, nada a escrever.
 */
export function configComInclude(atual: string, n: NomesWsl): string | null {
  const linha = linhaInclude(n);
  if (atual.split(/\r?\n/).some((l) => l.trim() === linha)) return null;
  return atual === "" ? `${linha}\n` : `${linha}\n\n${atual}`;
}
