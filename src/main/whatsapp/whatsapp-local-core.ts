/**
 * WhatsApp na máquina "local" (este Mac): os mesmos scripts das máquinas por SSH, rodando em `bash -s` aqui, sem SSH.
 * Puro (sem processos): o prelúdio que deixa o bash 3.2 e as ferramentas BSD do macOS falarem o dialeto que os scripts
 * esperam do Linux. Quem roda é whatsapp-ssh.ts.
 */

export const LOCAL_WA_HOST = "local";

/**
 * Antes de cada script local:
 * - PATH com o que o OpenClaw instala neste Mac (~/.local, ~/.openclaw) e o Homebrew (app de GUI tem PATH mínimo).
 * - `timeout N cmd…`: o macOS não tem; um perl que mata o comando no prazo e sai com 124, como o GNU.
 * - `stat -c %Y arq`: o stat do BSD não tem -c; %Y (mtime em segundos) vira `stat -f %m`. Sem isso o pareamento
 *   nunca via o número vinculado (linked_now compara o mtime do creds.json).
 * - `tail … --pid=N`: o tail do BSD não tem --pid e falha calado; o pareamento lê a saída do `channels login` assim, e
 *   sem isso o QR nunca chegava ao app ("Gerando o QR…" para sempre). Aqui: o tail normal até o processo N sair.
 * - As funções vão com `export -f`: os instaladores rodam como `bash arquivo.sh`, um bash filho (sem isso o
 *   install-transcricao.sh não achava o `timeout` e o teste do OpenClaw falhava).
 * - `sed -i expr arq`, com o `-i` como primeiro argumento (a única forma que os scripts usam hoje, no
 *   HERMES_STT_COMPARTILHADO_SH): o sed do BSD pede o sufixo do backup; vira `sed -i '' expr arq`. Outras formas
 *   do GNU (`sed -E -i`, `sed -Ei`) não são traduzidas: script novo que precisar delas estende a função e o teste.
 * - Sem escolha de agente gravada, o OpenClaw: é o padrão neste Mac, e um `hermes` da pessoa em ~/.local/bin faria a
 *   regra do motor (WA_MOTOR_SH) escolhê-lo sem ninguém pedir. Com a escolha gravada (tutorial 3 › Trocar), o Hermes
 *   atende aqui também: o gateway dele é um serviço do launchd (`hermes gateway install|start|stop|restart`), o ramo
 *   `GW=cli` dos scripts.
 * Os trechos de systemd dos scripts já saem sozinhos sem /run/systemd/system; o restart do OpenClaw cai em `openclaw
 * gateway restart`, que no Mac é o launchd.
 */
/** PATH com o que o OpenClaw instala no Mac (~/.local, ~/.openclaw) e o Homebrew: sessão sem login (app de GUI, `ssh host bash -s`) tem PATH mínimo. */
const MACOS_PATH_SH = `export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:$HOME/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
`;
/** As ferramentas que os scripts esperam do Linux e o macOS não tem: `timeout`, `tail --pid`, `stat -c` e `sed -i` em primeiro argumento (ver o comentário acima). */
const MACOS_FERRAMENTAS_SH = `command -v timeout >/dev/null 2>&1 || timeout() {
  _t=$1; shift
  perl -e 'my $t = shift; my $pid = fork(); die "fork" unless defined $pid; if ($pid == 0) { exec @ARGV or exit 127 } $SIG{ALRM} = sub { kill "TERM", $pid; sleep 1; kill "KILL", $pid; exit 124 }; alarm $t; waitpid($pid, 0); exit($? & 127 ? 128 + ($? & 127) : $? >> 8)' "$_t" "$@"
}
tail() {
  _pid=; _n=$#; _i=0
  while [ $_i -lt $_n ]; do _a=$1; shift; _i=$((_i+1)); case "$_a" in --pid=*) _pid=\${_a#--pid=} ;; *) set -- "$@" "$_a" ;; esac; done
  [ -n "$_pid" ] || { command tail "$@"; return; }
  command tail "$@" & _tp=$!
  while kill -0 "$_pid" 2>/dev/null; do sleep 1; done
  sleep 1; kill $_tp 2>/dev/null; wait $_tp 2>/dev/null; return 0
}
stat() {
  if [ "$1" = "-c" ]; then
    case "$2" in
      %Y) shift 2; command stat -f %m "$@" ;;
      %s) shift 2; command stat -f %z "$@" ;;
      %U) shift 2; command stat -f %Su "$@" ;;
      *) command stat "$@" ;;
    esac
  else command stat "$@"; fi
}
# \`sed -i expr arq\` com o -i em primeiro: o sed do BSD exige o sufixo do backup depois do -i; aqui, vazio (sem backup), como no Linux.
sed() { if [ "\${1-}" = "-i" ]; then shift; command sed -i '' "$@"; else command sed "$@"; fi; }
# Para os scripts que o prelúdio chama como \`bash arquivo.sh\` (instaladores): sem export, o bash filho não vê as funções.
export -f stat tail sed 2>/dev/null; command -v timeout >/dev/null 2>&1 && [ "$(type -t timeout)" = function ] && export -f timeout
true
`;
/** Só no host "local": sem escolha de agente gravada, o OpenClaw (o Hermes só atende neste Mac quando a pessoa o escolhe). */
const AGENTE_PADRAO_SH = `[ -s "$HOME/.local/share/meu-bot/whatsapp-agente" ] || { mkdir -p "$HOME/.local/share/meu-bot" && echo openclaw > "$HOME/.local/share/meu-bot/whatsapp-agente"; } 2>/dev/null || true
`;
export const LOCAL_SH_PRELUDE = `${MACOS_PATH_SH}${AGENTE_PADRAO_SH}${MACOS_FERRAMENTAS_SH}`;

/** O script completo para o `bash -s` local. */
export const scriptLocal = (script: string): string => `${LOCAL_SH_PRELUDE}${script}`;

/**
 * O script para uma máquina por SSH. A máquina pode ser um Mac (este Mac como pessoa do suporte, pelo alias de SSH, ou
 * o Mac de alguém): aí valem os mesmos ajustes do host "local", menos a escolha de agente, que é da máquina. Sem eles,
 * `timeout 25 openclaw …` respondia "command not found" e o app lia "gateway fora do ar" com o gateway rodando. Em
 * Linux o bloco não roda.
 */
export const scriptRemoto = (script: string): string => `if [ "$(uname -s 2>/dev/null)" = Darwin ]; then
${MACOS_PATH_SH}${MACOS_FERRAMENTAS_SH}fi
${script}`;
