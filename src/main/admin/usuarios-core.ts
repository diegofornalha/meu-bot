/**
 * Puro (testado): o nome aceito, os scripts da aba Usuários (listar, ligar a cota, limite, apagar) e a leitura da
 * saída. O limite de disco é uma cota de usuário no disco principal (/), em % do tamanho dele.
 */
import { deveAtualizar } from "../atualizacao/updater-core";
import type { Capacidade, HermesNaMaquina, Pressao, PressaoBox, UsuarioMaquina } from "../../shared/ipc";

/** Nome de usuário Linux aceito: minúsculas, dígitos, hífen e sublinhado, começando por letra; até 32. */
export const NOME_USUARIO_RE = /^[a-z][a-z0-9_-]{1,31}$/;
/** Todo usuário criado pelo admin começa com isto: digitar "maria" cria "box-maria" (e "box-1" não vira "box-box-1"). */
export const PREFIXO_USUARIO = "box-";
export const comPrefixo = (nome: string): string => (nome.startsWith(PREFIXO_USUARIO) ? nome : `${PREFIXO_USUARIO}${nome}`);
/**
 * O nome que vai ser criado a partir do que foi digitado (com ou sem o prefixo), ou null quando não dá: vazio ou só
 * o prefixo (o regex sozinho aceitaria "box-"), fora do padrão, ou reservado. O main é quem decide: o renderer só avisa.
 */
export function nomeParaCriar(digitado: unknown): string | null {
  if (typeof digitado !== "string") return null;
  const d = digitado.trim();
  if (d === "" || d === PREFIXO_USUARIO) return null;
  const nome = comPrefixo(d);
  return NOME_USUARIO_RE.test(nome) && !RESERVADOS.has(nome) ? nome : null;
}
/** Nomes que já existem em qualquer Debian/Ubuntu ou que confundem (root, admin…): recusados mesmo se livres. */
export const RESERVADOS = new Set(["root", "admin", "sudo", "daemon", "bin", "sys", "sync", "games", "man", "lp", "mail", "news", "uucp", "proxy", "www-data", "backup", "list", "irc", "nobody", "systemd", "ubuntu", "debian"]);
/** Usuários que o meu-bot usa na máquina: nunca apagados pela aba (o agente para). */
export const PROTEGIDOS = new Set(["openclaw", "hermes", "auditoria"]);

/**
 * Lista: `DISCO=<kb>` (tamanho de /), `COTA=0|1`, `RAM=<total kb> <em uso kb>`, `RAMROOT=<kb>` (o que é do root), `SWAP=`,
 * `CPUS=<núcleos>`, `USERSLICE=<memory.max> <memory.current> <anon> <memory.low>` (o cgroup de todos os usuários juntos; a
 * linha falta sem cgroup v2) e uma linha `U<TAB>nome<TAB>uid<TAB>home<TAB>shell<TAB>sudo<TAB>meubot<TAB>chave<TAB>usadoKb
 * <TAB>limiteKb` por usuário de login (usado e limite vazios sem cota; limite 0 = sem limite), a RAM dos processos dele
 * (KB) e os tetos do systemd na fatia dele (`user-<uid>.slice`): RAM máxima (bytes ou "infinity") e CPU por segundo
 * ("1s" = 100%, "infinity"), o apelido, se tem linger (1 = os serviços dele seguem rodando sem ele conectado e voltam ao
 * reiniciar), se está pronto; e, no fim (colunas novas, as antigas não mudam de lugar): o limite duro da cota, o
 * isolamento (MemorySwapMax, MemoryLow, CPUWeight) e o cgroup dele (memory.current, anon, peak, swap, events high/max/
 * oom_kill, PSI de memória avg10/avg60 e de CPU avg60, cpu.stat períodos/estrangulados/µs). Máquina sem cgroup v2
 * deixa essas colunas vazias.
 */
/** `COTA=0|1` (cota de usuário ligada no disco principal); deixa `$cota` para quem vier depois. Também no checklist de Preparar máquina. */
export const COTA_ESTADO_SH = `if quotaon -pu / 2>/dev/null | grep -q " is on"; then cota=1; else cota=0; fi; echo "COTA=$cota"`;
/** `HERMES=global|sem-transcritor|root|nenhum`: onde está o Hermes e se o transcritor compartilhado existe. Também no checklist. */
export const HERMES_ESTADO_SH = `if grep -q meu-bot-hermes-global /usr/local/bin/hermes 2>/dev/null && [ -x /opt/hermes/bin/hermes ]; then if grep -q meu-bot-transcritor /opt/transcriber/bin/transcrever 2>/dev/null; then echo HERMES=global; else echo HERMES=sem-transcritor; fi; elif [ -x /root/.local/bin/hermes ]; then echo HERMES=root; else echo HERMES=nenhum; fi`;
export const LISTAR_SH = `[ "$(id -u)" = 0 ] || { echo "NAOROOT"; exit 0; }
echo ROOT
echo "DISCO=$(df -k --output=size / 2>/dev/null | tail -1 | tr -d ' ')"
${COTA_ESTADO_SH}
echo "RAM=$(free -k | awk '/^Mem:/ {print $2" "$3}')"
echo "RAMROOT=$(ps -u root -o rss= 2>/dev/null | awk '{s+=$1} END {print s+0}')"
echo "SWAP=$(free -k | awk '/^Swap:/ {print $2" "$3}')"
echo "CPUS=$(nproc 2>/dev/null)"
US=/sys/fs/cgroup/user.slice; [ -f "$US/memory.max" ] && echo "USERSLICE=$(cat $US/memory.max 2>/dev/null) $(cat $US/memory.current 2>/dev/null) $(awk '$1=="anon"{print $2}' $US/memory.stat 2>/dev/null) $(cat $US/memory.low 2>/dev/null)"
${HERMES_ESTADO_SH}
awk -F: '$3>=1000 && $3<60000 && $7 !~ /(nologin|false)$/ {split($5, g, ","); ap = (substr(g[1], 1, 8) == "meu-bot=") ? substr(g[1], 9) : ""; print $1"\\t"$3"\\t"$6"\\t"$7"\\t"ap}' /etc/passwd | while IFS="$(printf '\\t')" read -r n u h s ap; do
  g=" $(id -nG "$n" 2>/dev/null) "; case "$g" in *" sudo "*|*" wheel "*|*" admin "*) su=1 ;; *) su=0 ;; esac
  [ -d "$h/.local/share/meu-bot" ] && mb=1 || mb=0
  [ -s "$h/.ssh/authorized_keys" ] && ch=1 || ch=0
  [ -e "/var/lib/systemd/linger/$n" ] && lg=1 || lg=0
  [ -s "$h/.local/share/meu-bot/backend/.env" ] && [ "$(tr -d ' \\n' < "$h/.local/share/meu-bot/whatsapp-agente" 2>/dev/null)" = hermes ] && pr=1 || pr=0
  us=""; li=""; hd=""
  if [ "$cota" = 1 ]; then q=$(quota -wu "$n" 2>/dev/null | awk 'NR>2 && $1 ~ /^\\// {gsub(/\\*/,"",$2); print $2" "$3" "$4; exit}'); if [ -n "$q" ]; then set -- $q; us=$1; li=$2; hd=$3; else us=0; li=0; hd=0; fi; fi
  ram=$(ps -u "$n" -o rss= 2>/dev/null | awk '{s+=$1} END {print s+0}')
  sp=$(systemctl show "user-$u.slice" -p MemoryMax -p CPUQuotaPerSecUSec -p MemorySwapMax -p MemoryLow -p CPUWeight 2>/dev/null | awk -F= '{v[$1]=$2} END {print v["MemoryMax"]"\\t"v["CPUQuotaPerSecUSec"]"\\t"v["MemorySwapMax"]"\\t"v["MemoryLow"]"\\t"v["CPUWeight"]}')
  mm=$(printf '%s' "$sp" | cut -f1); cq=$(printf '%s' "$sp" | cut -f2); sx=$(printf '%s' "$sp" | cut -f3); ml=$(printf '%s' "$sp" | cut -f4); cw=$(printf '%s' "$sp" | cut -f5)
  d="/sys/fs/cgroup/user.slice/user-$u.slice"; cg=""
  if [ -f "$d/memory.current" ]; then
    cur=$(cat "$d/memory.current" 2>/dev/null); an=$(awk '$1=="anon"{print $2}' "$d/memory.stat" 2>/dev/null); pk=$(cat "$d/memory.peak" 2>/dev/null); sc=$(cat "$d/memory.swap.current" 2>/dev/null)
    ev=$(awk '$1=="high"{h=$2} $1=="max"{m=$2} $1=="oom_kill"{o=$2} END {print (h+0)"\\t"(m+0)"\\t"(o+0)}' "$d/memory.events" 2>/dev/null)
    pm=$(awk '$1=="some"{for(i=2;i<=NF;i++){split($i,a,"="); if(a[1]=="avg10")x=a[2]; if(a[1]=="avg60")y=a[2]}} END {print (x+0)"\\t"(y+0)}' "$d/memory.pressure" 2>/dev/null)
    pc=$(awk '$1=="some"{for(i=2;i<=NF;i++){split($i,a,"="); if(a[1]=="avg60")y=a[2]}} END {print (y+0)}' "$d/cpu.pressure" 2>/dev/null)
    cs=$(awk '$1=="nr_periods"{p=$2} $1=="nr_throttled"{t=$2} $1=="throttled_usec"{w=$2} END {print (p+0)"\\t"(t+0)"\\t"(w+0)}' "$d/cpu.stat" 2>/dev/null)
    cg=$(printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s' "$cur" "$an" "$pk" "$sc" "$ev" "$pm" "$pc" "$cs")
  fi
  printf 'U\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$n" "$u" "$h" "$s" "$su" "$mb" "$ch" "$us" "$li" "$ram" "$mm" "$cq" "$ap" "$lg" "$pr" "$hd" "$sx" "$ml" "$cw" "$cg"
  bd="$h/.local/share/meu-bot/backend"; [ -s "$bd/.env" ] && [ -f "$bd/server.js" ] && printf 'B\\t%s\\t%s\\n' "$n" "$(tr -dc '0-9.' < "$bd/VERSION" 2>/dev/null)"
done`;

const kb = (v: string | undefined): number | null => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
const dec = (v: string | undefined): number | null => (v !== undefined && /^\d+(\.\d+)?$/.test(v) ? Number(v) : null);
/** As 13 colunas do cgroup da fatia (memory.current em diante); null se as duas primeiras não vieram (sem cgroup v2 / máquina antiga). */
export function lerBox(c: readonly (string | undefined)[]): PressaoBox | null {
  const uso = kb(c[0]); const anon = kb(c[1]);
  if (uso === null || anon === null) return null;
  const b = (v: string | undefined): number => kb(v) ?? 0;
  return {
    usoKb: Math.round(uso / 1024), anonKb: Math.round(anon / 1024), picoKb: kb(c[2]) === null ? null : Math.round((kb(c[2]) ?? 0) / 1024), swapKb: Math.round(b(c[3]) / 1024),
    evHigh: b(c[4]), evMax: b(c[5]), oomKill: b(c[6]), psiMem10: dec(c[7]) ?? 0, psiMem60: dec(c[8]) ?? 0, psiCpu60: dec(c[9]) ?? 0,
    cpuPeriodos: b(c[10]), cpuEstrangulados: b(c[11]), cpuEstranguladoUsec: b(c[12]),
  };
}
export type ListaUsuarios = { root: boolean; discoKb: number | null; cota: boolean; ram: { totalKb: number; usoKb: number; rootKb: number; swapKb: number; swapUsoKb: number } | null; userSlice: { maxKb: number | null; usoKb: number; anonKb: number; lowKb: number } | null; cpus: number | null; hermes: HermesNaMaquina | null; usuarios: UsuarioMaquina[] };
export function lerUsuarios(out: string): ListaUsuarios {
  const root = /^ROOT$/m.test(out);
  const discoKb = kb(/^DISCO=(\d+)$/m.exec(out)?.[1]);
  const cota = /^COTA=1$/m.test(out);
  const rm = /^RAM=(\d+) (\d+)$/m.exec(out);
  const sw = /^SWAP=(\d+) (\d+)$/m.exec(out);
  const ram = rm === null ? null : { totalKb: Number(rm[1]), usoKb: Number(rm[2]), rootKb: kb(/^RAMROOT=(\d+)$/m.exec(out)?.[1]) ?? 0, swapKb: sw === null ? 0 : Number(sw[1]), swapUsoKb: sw === null ? 0 : Number(sw[2]) };
  const cpus = kb(/^CPUS=(\d+)$/m.exec(out)?.[1]);
  const us = /^USERSLICE=(max|\d+) (\d+) (\d+) (\d+)$/m.exec(out);
  const userSlice = us === null ? null : { maxKb: us[1] === "max" ? null : Math.round(Number(us[1]) / 1024), usoKb: Math.round(Number(us[2]) / 1024), anonKb: Math.round(Number(us[3]) / 1024), lowKb: Math.round(Number(us[4]) / 1024) };
  // Linha própria por box com o backend do meu-bot (`B\t<nome>\t<versão>`): a coluna do cgroup é variável, uma coluna
  // depois dela mudaria de posição. Versão vazia = instalado antes do VERSION (conta como antigo).
  const backends = new Map<string, string | null>();
  for (const l of out.split("\n")) {
    const c = l.split("\t");
    if (c[0] === "B" && NOME_USUARIO_RE.test(c[1] ?? "")) backends.set(c[1]!, /^\d+(\.\d+)*$/.test(c[2] ?? "") ? c[2]! : null);
  }
  const usuarios: UsuarioMaquina[] = [];
  for (const l of out.split("\n")) {
    const c = l.split("\t");
    if (c[0] !== "U" || c.length < 8 || !NOME_USUARIO_RE.test(c[1] ?? "")) continue;
    const limite = kb(c[9]); const hard = kb(c[16]);
    const ramMaxMb = ramMaxDe(c[11]);
    const box = lerBox(c.slice(20, 33));
    usuarios.push({
      nome: c[1]!, uid: Number(c[2]), home: c[3] ?? "", shell: c[4] ?? "", sudo: c[5] === "1", meuBot: c[6] === "1", chave: c[7] === "1",
      usadoKb: kb(c[8]), limiteKb: limite === 0 ? null : limite, hardKb: hard === null || hard === 0 ? null : hard,
      ramKb: kb(c[10]) ?? 0, ramMaxMb, cpuMaxPct: cpuMaxDe(c[12]),
      swapMaxMb: ramMaxDe(c[17]), lowMb: c[18] === undefined || c[18] === "" || c[18] === "0" ? null : ramMaxDe(c[18]), cpuWeight: kb(c[19]),
      box, pressao: pressaoDe(box, ramMaxMb),
      apelido: (c[13] ?? "").trim(), ligado: c[14] !== "0", pronto: c[15] === "1",
      backendInstalado: backends.has(c[1]!), backendVersao: backends.get(c[1]!) ?? null,
    });
  }
  const hm = /^HERMES=(global|sem-transcritor|root|nenhum)$/m.exec(out)?.[1];
  const hermes = hm === "global" || hm === "sem-transcritor" || hm === "root" || hm === "nenhum" ? hm : null;
  return { root, discoKb, cota, ram, userSlice, cpus, hermes, usuarios: usuarios.sort((a, b) => a.uid - b.uid) };
}

/**
 * Boxes cujo backend do meu-bot está atrás do que este app traz (`deveAtualizar`: só sobe, nunca desce; sem versão
 * gravada conta como antigo). Sem backend, com sudo ou protegidas ficam de fora. `doApp` null (app sem VERSION) = nenhuma.
 */
export function boxesDesatualizadas(usuarios: readonly UsuarioMaquina[], doApp: string | null): string[] {
  return usuarios.filter((u) => u.backendInstalado && !u.sudo && !RESERVADOS.has(u.nome) && !PROTEGIDOS.has(u.nome) && deveAtualizar(u.backendVersao, doApp)).map((u) => u.nome);
}

/**
 * Pressão de uma box, para quem não pensa. Sinais que valem: a memória anônima (a que o kernel não solta) perto do
 * MemoryHigh, a PSI (quanto tempo os processos dela ficaram parados esperando memória/CPU), bater no MemoryMax e o
 * OOM matar alguém. O que não vale: `memory.current` (70% é cache descartável) e `events high` (uma box saudável tem
 * centenas: é só o kernel recolhendo cache no MemoryHigh). Contadores `max`/`oom_kill` são cumulativos desde que a
 * fatia subiu (zeram só ao recriar a fatia ou reiniciar).
 */
export function pressaoDe(b: PressaoBox | null, ramMaxMb: number | null): Pressao | null {
  if (b === null) return null;
  const highMb = ramMaxMb === null ? null : Math.floor(ramMaxMb * 0.9);
  const anonMb = Math.round(b.anonKb / 1024);
  const dicaMem = `aumente a RAM máx dele (hoje ${ramMaxMb === null ? "sem teto" : `${ramMaxMb} MB`}) ou veja o que pesa na box`;
  const dicaCpu = "a box está pesada de CPU: aumente o CPU % dele ou veja o que roda";
  if (b.oomKill > 0) return { estado: "estrangulada", motivo: `o Linux já matou ${b.oomKill} processo${b.oomKill === 1 ? "" : "s"} dele por falta de memória desde que a box subiu`, dica: dicaMem };
  if (b.psiMem60 >= 25) return { estado: "estrangulada", motivo: `${b.psiMem60}% do último minuto parada esperando memória`, dica: dicaMem };
  if (b.psiCpu60 >= 50) return { estado: "estrangulada", motivo: `${b.psiCpu60}% do último minuto parada esperando CPU`, dica: dicaCpu };
  if (b.evMax > 0 && b.psiMem60 >= 10) return { estado: "estrangulada", motivo: `encostou no teto de memória ${b.evMax} vez${b.evMax === 1 ? "" : "es"} e segue apertada (${b.psiMem60}%)`, dica: dicaMem };
  if (b.psiMem60 >= 10) return { estado: "apertada", motivo: `${b.psiMem60}% do último minuto esperando memória`, dica: dicaMem };
  if (b.psiCpu60 >= 25) return { estado: "apertada", motivo: `${b.psiCpu60}% do último minuto esperando CPU`, dica: dicaCpu };
  if (b.evMax > 0) return { estado: "apertada", motivo: `já encostou no teto de memória ${b.evMax} vez${b.evMax === 1 ? "" : "es"}`, dica: dicaMem };
  if (highMb !== null && anonMb >= highMb * 0.85) return { estado: "apertada", motivo: `${anonMb} MB de memória própria, perto do aperto em ${highMb} MB`, dica: dicaMem };
  return { estado: "folgada", motivo: `${anonMb} MB de memória própria${highMb !== null ? ` de ${highMb} MB` : ""}, sem espera`, dica: "" };
}

/** Quanto do total fica para o sistema (sshd, nginx, túnel, journald): o maior entre 3 GB e 10%. */
export const RESERVA_HOST = { minMb: 3072, pct: 10 } as const;
/** Teto e proteção do user.slice (todos os usuários juntos) para uma máquina com `totalKb` de RAM. */
export function reservaDe(totalKb: number): { capMb: number; lowMb: number } {
  if (!Number.isInteger(totalKb) || totalKb <= 0) throw new Error("RAM total inválida");
  const totalMb = Math.floor(totalKb / 1024);
  const reserva = Math.max(RESERVA_HOST.minMb, Math.floor((totalMb * RESERVA_HOST.pct) / 100));
  const capMb = totalMb - reserva;
  if (capMb < 1024) throw new Error("máquina com RAM de menos para reservar algo ao sistema");
  return { capMb, lowMb: Math.floor(capMb / 2) };
}
/**
 * A reserva para o sistema: teto em `user.slice` (todos os usuários juntos), MemoryLow pela metade (com
 * memory_recursiveprot, o MemoryLow de cada box só vale até o do pai) e CPUWeight igual ao system.slice. Guarda em
 * `anon` do user.slice (não em memory.current, que é cache do root): recusa se os usuários já usam de verdade mais de
 * 90% do teto. `set-property` persiste e vale na hora, sem reiniciar nada. Saída `RESERVA=ok <capMb>` ou `ERRO=`.
 */
export function reservaHostSh(capMb: number, lowMb: number): string {
  if (!Number.isInteger(capMb) || capMb < 1024 || !Number.isInteger(lowMb) || lowMb < 0 || lowMb > capMb) throw new Error("reserva inválida");
  return `[ "$(id -u)" = 0 ] || { echo "ERRO=só o root reserva memória"; exit 0; }
A=$(awk '$1=="anon"{print int($2/1048576)}' /sys/fs/cgroup/user.slice/memory.stat 2>/dev/null); A=\${A:-0}
[ "$A" -le $(( ${capMb} * 9 / 10 )) ] || { echo "ERRO=os usuários já usam $A MB de memória de verdade, acima de 90% do teto de ${capMb} MB: não dá para reservar sem apertar alguém"; exit 0; }
systemctl set-property user.slice MemoryMax=${capMb}M MemoryLow=${lowMb}M CPUWeight=100 >/dev/null 2>&1 && echo "RESERVA=ok ${capMb}" || echo "ERRO=o systemd recusou a reserva"`;
}

/** Isolamento que toda box leva além dos tetos: swap própria pequena, um piso de memória protegida e peso de CPU igual. */
export const ISOLAMENTO_PADRAO = { swapMb: 256, lowMb: 640, cpuWeight: 100 } as const;
/**
 * Aplica o isolamento às boxes que já existem (só as três propriedades novas; MemoryHigh/Max e CPUQuota de cada uma
 * ficam como estão), para cada usuário de login sem sudo. Linhas `ISOLAMENTO=ok <n> <nomes>` e `FALHOU=<nome>`.
 */
export function isolamentoTodosSh(): string {
  const { swapMb, lowMb, cpuWeight } = ISOLAMENTO_PADRAO;
  return `[ "$(id -u)" = 0 ] || { echo "ERRO=só o root aplica o isolamento"; exit 0; }
N=0; L=""
for n in $(awk -F: '$3>=1000 && $3<60000 && $7 !~ /(nologin|false)$/ {print $1}' /etc/passwd); do
  case " $(id -nG "$n" 2>/dev/null) " in *" sudo "*|*" wheel "*|*" admin "*) continue ;; esac
  u=$(id -u "$n")
  if systemctl set-property "user-$u.slice" MemorySwapMax=${swapMb}M MemoryLow=${lowMb}M CPUWeight=${cpuWeight} >/dev/null 2>&1; then N=$((N+1)); L="$L $n"; else echo "FALHOU=$n"; fi
done
echo "ISOLAMENTO=ok $N$L"`;
}

/** Quantas boxes cabem: o teto do user.slice (o aplicado, ou o planejado) dividido pelo teto padrão por box; e a CPU prometida. */
export function capacidadeDe(o: { totalKb: number; userSliceMaxKb: number | null; cpus: number | null; padraoMb: number; usuarios: readonly UsuarioMaquina[] }): Capacidade {
  const boxes = o.usuarios.filter((u) => !u.sudo && u.uid >= 1000 && !RESERVADOS.has(u.nome) && !PROTEGIDOS.has(u.nome));
  const planejado = reservaDe(o.totalKb).capMb;
  const capMb = o.userSliceMaxKb === null ? planejado : Math.round(o.userSliceMaxKb / 1024);
  const cpuPrometidoPct = boxes.reduce((s, u) => s + (u.cpuMaxPct ?? (o.cpus ?? 1) * 100), 0);
  return { boxes: boxes.length, cabem: Math.max(0, Math.floor(capMb / o.padraoMb)), capMb, padraoMb: o.padraoMb, reservaAplicada: o.userSliceMaxKb !== null, cpuNucleos: o.cpus, cpuPrometidoPct };
}
/** O que falta da governança: a reserva no user.slice e as boxes que nunca receberam o isolamento (sem MemorySwapMax). */
export function governancaDe(l: Pick<ListaUsuarios, "userSlice" | "usuarios">): { reserva: boolean; semIsolamento: string[] } {
  return {
    reserva: l.userSlice !== null && l.userSlice.maxKb !== null,
    semIsolamento: l.usuarios.filter((u) => !u.sudo && u.uid >= 1000 && !RESERVADOS.has(u.nome) && !PROTEGIDOS.has(u.nome) && u.swapMaxMb === null && u.box !== null).map((u) => u.nome),
  };
}

/** Limite em KB para `pct`% do disco (inteiro de 1 a 100); 0 = sem limite. */
export function limiteKbDe(pct: number, discoKb: number): number {
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new Error("o limite é uma porcentagem inteira de 0 a 100 (0 = sem limite)");
  return pct === 0 ? 0 : Math.max(1024, Math.floor((discoKb * pct) / 100));
}

/**
 * Liga a cota de usuário no disco principal, uma vez por máquina e sem reiniciar: instala o pacote quota, guarda uma
 * cópia do /etc/fstab, acrescenta `usrquota` à linha de /, confere o fstab (desfaz se não passar), remonta, cria o
 * arquivo de cota e liga. Já ligada: não faz nada. Saída: `COTA=ok` ou `ERRO=<motivo>`.
 */
export const COTA_LIGAR_SH = `if quotaon -pu / 2>/dev/null | grep -q " is on"; then echo COTA=ok; exit 0; fi
command -v quotaon >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120 install -y -q quota >/dev/null 2>&1 || { echo "ERRO=não consegui instalar o pacote quota"; exit 0; }
modprobe quota_v2 >/dev/null 2>&1 || true
B=/etc/fstab.bak-meu-bot-$(date +%Y%m%d-%H%M%S); cp /etc/fstab "$B" || { echo "ERRO=não consegui guardar a cópia do /etc/fstab"; exit 0; }
python3 - <<'PY' || { cp "$B" /etc/fstab; echo "ERRO=não consegui ajustar o /etc/fstab (a cópia voltou)"; exit 0; }
p = "/etc/fstab"; out = []
for l in open(p).read().split("\\n"):
    c = l.split()
    if len(c) >= 4 and not l.lstrip().startswith("#") and c[1] == "/" and "usrquota" not in c[3].split(","):
        c[3] = c[3] + ",usrquota"; l = "\\t".join(c)
    out.append(l)
open(p, "w").write("\\n".join(out))
PY
findmnt --verify --tab-file /etc/fstab >/dev/null 2>&1 || { cp "$B" /etc/fstab; echo "ERRO=o /etc/fstab novo não passou na conferência (a cópia voltou)"; exit 0; }
systemctl daemon-reload >/dev/null 2>&1 || true
mount -o remount,usrquota / || { cp "$B" /etc/fstab; systemctl daemon-reload >/dev/null 2>&1; echo "ERRO=o disco não aceitou a cota (a cópia do fstab voltou)"; exit 0; }
quotacheck -cum / >/dev/null 2>&1 || true
quotaon -u / >/dev/null 2>&1 || true
quotaon -pu / 2>/dev/null | grep -q " is on" && echo COTA=ok || echo "ERRO=a cota não ligou neste disco"`;

/** Folga entre o limite macio (o que a pessoa vê) e o duro: 10% ou 300 MB, o que for maior; durante 7 dias acima do macio ainda grava. */
export const FOLGA_HARD = { pct: 10, minKb: 300 * 1024 } as const;
/** Limite duro a partir do macio (0 = sem limite): com ele o aviso de "acabou" ainda sai pelo WhatsApp e o Hermes ainda grava por uns dias. */
export const hardKbDe = (kb: number): number => (kb === 0 ? 0 : kb + Math.max(Math.floor((kb * FOLGA_HARD.pct) / 100), FOLGA_HARD.minKb));
/** Grava o limite (KB; 0 = sem limite) do usuário `nome` (já validado): macio = o limite, duro = com a folga, carência de 7 dias. Saída `LIMITE=ok` ou `ERRO=`. */
export const limiteSh = (nome: string, limiteKb: number): string => `id '${nome}' >/dev/null 2>&1 || { echo "ERRO=não existe o usuário ${nome}"; exit 0; }
setquota -u '${nome}' ${limiteKb} ${hardKbDe(limiteKb)} 0 0 / && { setquota -t 604800 604800 / >/dev/null 2>&1 || true; echo LIMITE=ok; } || echo "ERRO=não consegui gravar o limite"`;

/** Apaga o usuário `nome` (já validado) e a pasta dele; recusa quem tem sudo ou uid de sistema. Saída `APAGADO=` ou `ERRO=`. */
export const apagarSh = (nome: string): string => `N='${nome}'
id "$N" >/dev/null 2>&1 || { echo "ERRO=não existe o usuário $N"; exit 0; }
[ "$(id -u "$N")" -ge 1000 ] || { echo "ERRO=$N é um usuário do sistema"; exit 0; }
case " $(id -nG "$N") " in *" sudo "*|*" wheel "*|*" admin "*) echo "ERRO=$N tem sudo: tire o sudo antes de apagar"; exit 0 ;; esac
U=$(id -u "$N")
loginctl disable-linger "$N" >/dev/null 2>&1 || true
setquota -u "$N" 0 0 0 0 / >/dev/null 2>&1 || true
# Com linger, matar os processos não basta: o systemd sobe outro "systemd --user" na hora e o userdel recusa
# ("currently used by process"). Para o serviço do usuário, encerra as sessões e tenta de novo por alguns segundos.
for i in 1 2 3 4 5; do
  systemctl stop "user@$U.service" >/dev/null 2>&1 || true
  loginctl terminate-user "$N" >/dev/null 2>&1 || true
  pkill -KILL -u "$N" >/dev/null 2>&1 || true
  E=$(userdel -r "$N" 2>&1); id "$N" >/dev/null 2>&1 || break
  sleep 1
done
id "$N" >/dev/null 2>&1 && { echo "ERRO=não consegui apagar $N: $(printf '%s' "$E" | grep -v 'mail spool' | tail -1)"; exit 0; }
# Os tetos de RAM/CPU ficam no systemd por número de usuário: sem limpar, quem reaproveitar o número herdaria.
rm -rf "/etc/systemd/system.control/user-$U.slice.d" "/etc/systemd/system/user-$U.slice.d" 2>/dev/null; systemctl daemon-reload >/dev/null 2>&1 || true
echo "APAGADO=$N"`;

/**
 * O que ocupa espaço na pasta do usuário (para o admin escolher o que apagar antes de baixar o limite): as maiores
 * pastas e arquivos até 2 níveis, sem a própria pasta. Linhas `I<TAB>kb<TAB>d|f<TAB>caminho`.
 */
export const maioresSh = (nome: string): string => `H=$(getent passwd '${nome}' | cut -d: -f6); [ -n "$H" ] && [ -d "$H" ] || { echo "ERRO=não achei a pasta de ${nome}"; exit 0; }
echo "HOME=$H"
du -xak --max-depth=2 "$H" 2>/dev/null | sort -rn | awk -v h="$H" '$2 != h' | head -25 | while IFS="$(printf '\\t')" read -r k p; do [ -d "$p" ] && t=d || t=f; printf 'I\\t%s\\t%s\\t%s\\n' "$k" "$t" "$p"; done`;

export function lerMaiores(out: string): { home: string | null; itens: { kb: number; pasta: boolean; caminho: string }[] } {
  const home = /^HOME=(.+)$/m.exec(out)?.[1] ?? null;
  const itens: { kb: number; pasta: boolean; caminho: string }[] = [];
  for (const l of out.split("\n")) {
    const c = l.split("\t");
    if (c[0] !== "I" || c.length < 4 || !/^\d+$/.test(c[1] ?? "") || home === null || !caminhoDentro(home, c[3] ?? "")) continue;
    itens.push({ kb: Number(c[1]), pasta: c[2] === "d", caminho: c[3]! });
  }
  return { home, itens };
}

/** O caminho fica dentro da pasta do usuário (nunca a própria pasta, nem com `..`)? */
export const caminhoDentro = (home: string, p: string): boolean =>
  home.startsWith("/home/") && p.startsWith(`${home}/`) && !p.split("/").includes("..") && !/[\n\r]/.test(p) && p.length > home.length + 1;

/** Apaga um item (pasta ou arquivo) dentro da pasta do usuário; o caminho chega em base64 e é conferido de novo. */
export const apagarItemSh = (nome: string, caminhoB64: string): string => `H=$(getent passwd '${nome}' | cut -d: -f6); [ -n "$H" ] || { echo "ERRO=não achei a pasta de ${nome}"; exit 0; }
P=$(printf '%s' '${caminhoB64}' | base64 -d); R=$(realpath -m -- "$P")
case "$R" in "$H"/?*) ;; *) echo "ERRO=o caminho não está dentro da pasta de ${nome}"; exit 0 ;; esac
rm -rf -- "$R" && echo "APAGADO=$R" || echo "ERRO=não consegui apagar"`;

/** MemoryMax do systemd (bytes ou "infinity") → MB; null = sem teto. */
export function ramMaxDe(v: string | undefined): number | null {
  if (v === undefined || !/^\d+$/.test(v.trim())) return null;
  return Math.round(Number(v.trim()) / 1024 / 1024);
}
/** CPUQuotaPerSecUSec do systemd ("1s", "500ms", "1.500s", "infinity") → % de um núcleo; null = sem teto. */
export function cpuMaxDe(v: string | undefined): number | null {
  const t = (v ?? "").trim();
  const m = /^(\d+(?:\.\d+)?)(s|ms|us)$/.exec(t);
  if (m === null) return null;
  const s = Number(m[1]) / (m[2] === "s" ? 1 : m[2] === "ms" ? 1000 : 1_000_000);
  return Math.round(s * 100);
}

/**
 * Tetos de RAM (MB; 0 = sem teto) e CPU (% de um núcleo; 0 = sem teto) na fatia do usuário, pelo systemd: vale para
 * tudo o que ele roda (agente, terminal…), persiste sem reiniciar e é o mesmo para qualquer agente. MemoryHigh a 90%
 * do máximo: o Linux aperta antes de matar. Leva junto o isolamento (ISOLAMENTO_PADRAO). Saída `RECURSOS=ok` ou `ERRO=`.
 */
export function recursosSh(nome: string, ramMb: number, cpuPct: number): string {
  if (!Number.isInteger(ramMb) || ramMb < 0 || ramMb > 1_048_576) throw new Error("RAM máxima: um número inteiro de MB (0 = sem teto)");
  if (!Number.isInteger(cpuPct) || cpuPct < 0 || cpuPct > 6400) throw new Error("CPU: uma porcentagem inteira de um núcleo (100 = um núcleo; 0 = sem teto)");
  const mem = ramMb === 0 ? "MemoryHigh=infinity MemoryMax=infinity" : `MemoryHigh=${Math.floor(ramMb * 0.9)}M MemoryMax=${ramMb}M`;
  const cpu = cpuPct === 0 ? "CPUQuota=" : `CPUQuota=${cpuPct}%`;
  // O isolamento vai junto (sempre): swap própria pequena (sem teto de RAM, sem teto de swap), piso protegido e peso igual.
  const iso = `MemorySwapMax=${ramMb === 0 ? "infinity" : `${ISOLAMENTO_PADRAO.swapMb}M`} MemoryLow=${ISOLAMENTO_PADRAO.lowMb}M CPUWeight=${ISOLAMENTO_PADRAO.cpuWeight}`;
  return `U=$(id -u '${nome}' 2>/dev/null) || { echo "ERRO=não existe o usuário ${nome}"; exit 0; }
[ "$U" -ge 1000 ] || { echo "ERRO=${nome} é um usuário do sistema"; exit 0; }
systemctl set-property "user-$U.slice" ${mem} ${cpu} ${iso} >/dev/null 2>&1 && echo RECURSOS=ok || echo "ERRO=o systemd recusou os limites"`;
}

/**
 * Memória de reserva (swap) de `gb` GB num arquivo, quando a máquina não tem nenhuma: sem ela, RAM cheia faz o Linux
 * matar processos (um agente some) em vez de desacelerar. Backup do /etc/fstab, conferência, desfaz se falhar;
 * swappiness 10 (só usa quando aperta). Já tem swap: não faz nada. Saída `SWAP=ok` ou `ERRO=`.
 */
export function swapLigarSh(gb: number): string {
  if (!Number.isInteger(gb) || gb < 1 || gb > 64) throw new Error("swap: de 1 a 64 GB");
  return `if [ "$(swapon --noheadings --show=SIZE 2>/dev/null | wc -l)" -gt 0 ]; then echo SWAP=ok; exit 0; fi
F=/swapfile; [ -e "$F" ] && { echo "ERRO=já existe um /swapfile que não está ligado; confira à mão"; exit 0; }
L=$(df -k --output=avail / | tail -1 | tr -d ' '); [ "$L" -gt $(( ${gb} * 1024 * 1024 + 2097152 )) ] || { echo "ERRO=pouco espaço livre no disco para ${gb} GB de swap"; exit 0; }
B=/etc/fstab.bak-meu-bot-$(date +%Y%m%d-%H%M%S); cp /etc/fstab "$B" || { echo "ERRO=não consegui guardar a cópia do /etc/fstab"; exit 0; }
fallocate -l ${gb}G "$F" && chmod 600 "$F" && mkswap "$F" >/dev/null && swapon "$F" || { swapoff "$F" 2>/dev/null; rm -f "$F"; echo "ERRO=não consegui criar a swap"; exit 0; }
grep -qE '^/swapfile[[:space:]]' /etc/fstab || printf '/swapfile none swap sw 0 0\\n' >> /etc/fstab
findmnt --verify --tab-file /etc/fstab >/dev/null 2>&1 || { cp "$B" /etc/fstab; echo "ERRO=o /etc/fstab novo não passou na conferência (a cópia voltou; a swap fica ligada só até reiniciar)"; exit 0; }
printf 'vm.swappiness=10\\n' > /etc/sysctl.d/90-meu-bot-swap.conf; sysctl -q -w vm.swappiness=10 >/dev/null 2>&1 || true
systemctl daemon-reload >/dev/null 2>&1 || true
echo SWAP=ok`;
}

/** A mesma versão que o install-grok-oauth.sh pede: com ela no PATH de todos, o instalador não baixa cópia por usuário. */
export const HERMES_VERSAO = "0.22.2";
/** Node do Hermes compartilhado: o mesmo do backend (install.sh). */
const HERMES_NODE = "v20.20.2";

/**
 * Hermes para todos os usuários da máquina: o programa em /opt/hermes (Node próprio + pacote npm, dono root, só
 * leitura para os outros) e o /usr/local/bin/hermes apontando para lá. Os dados continuam por usuário (~/.hermes).
 * Antes, o Hermes do root morava em /root/.local (pasta 700): o atalho global dava "Permission denied" para os
 * outros e o instalador do Grok baixava uma cópia de ~900 MB em cada conta. Idempotente; o atalho que não for nosso
 * fica guardado ao lado. Saída `HERMES=ok <versão>` ou `ERRO=`.
 *
 * CONTORNO #6 (Hermes): o lançador npm (lib/python-launcher.js) não repassa SIGTERM ao filho Python; com o
 * KillMode=mixed do unit, o systemd mata só o Node e dá SIGKILL no gateway ("exited UNCLEANLY") (issue upstream a abrir; ver a tabela).
 * O que fazemos: o atalho do serviço (<código>/.hermes/bin/hermes) dá exec direto no venv/bin/hermes, com o ambiente do lançador.
 * Sai quando: `grep -q 'process.on("SIGTERM"' /opt/hermes/lib/node_modules/hermes-agent/lib/python-launcher.js` achar.
 * Tabela: docs/guia/contornos.md.
 */
export function hermesGlobalSh(): string {
  return `D=/opt/hermes; V='${HERMES_VERSAO}'; NV='${HERMES_NODE}'; W=/usr/local/bin/hermes
mkdir -p "$D" || { echo "ERRO=não consegui criar $D"; exit 0; }
if ! "$D/node/bin/node" -v >/dev/null 2>&1; then
  case "$(uname -m)" in aarch64|arm64) a=arm64;; x86_64) a=x64;; *) echo "ERRO=arquitetura $(uname -m) não suportada"; exit 0;; esac
  t=$(mktemp -d); curl -fsSL "https://nodejs.org/dist/$NV/node-$NV-linux-$a.tar.gz" -o "$t/node.tar.gz" || { rm -rf "$t"; echo "ERRO=não consegui baixar o Node $NV"; exit 0; }
  rm -rf "$D/node"; mkdir -p "$D/node"; tar -xzf "$t/node.tar.gz" -C "$D/node" --strip-components=1; rm -rf "$t"
fi
export PATH="$D/bin:$D/node/bin:$PATH"
P="$D/lib/node_modules/hermes-agent"
grep -q "\"version\": \"$V\"" "$P/package.json" 2>/dev/null || npm install -g --prefix "$D" "hermes-agent@$V" >/tmp/meu-bot-hermes-global.log 2>&1 || { echo "ERRO=a instalação do Hermes $V falhou (log em /tmp/meu-bot-hermes-global.log)"; exit 0; }
# As dependências do bridge do WhatsApp: cada usuário roda o bridge daqui e não pode gravar em /opt.
B="$P/runtime/hermes-agent/scripts/whatsapp-bridge"
if [ -f "$B/bridge.js" ] && [ ! -d "$B/node_modules" ]; then ( cd "$B" && npm install --no-audit --no-fund >>/tmp/meu-bot-hermes-global.log 2>&1 ) || { echo "ERRO=não consegui instalar as dependências do bridge do WhatsApp (log em /tmp/meu-bot-hermes-global.log)"; exit 0; }; fi
chmod -R a+rX "$D"
[ -e "$W" ] && ! grep -q meu-bot-hermes-global "$W" && cp -P "$W" "$W.antes-do-meu-bot"
cat > "$W" <<'EOF'
#!/bin/sh
# meu-bot-hermes-global: o Hermes de todos os usuários (programa em /opt/hermes; os dados de cada um em ~/.hermes).
export PATH="/opt/hermes/bin:/opt/hermes/node/bin:$PATH"
# O código do Hermes é um repositório git do root: sem isto o git dos outros recusa ("dubious ownership") e a versão sai "vunknown".
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0=/opt/hermes/lib/node_modules/hermes-agent/runtime/hermes-agent
exec /opt/hermes/bin/hermes "$@"
EOF
chmod 755 "$W"
# O serviço do gateway que o Hermes grava para cada usuário chama <código>/.hermes/bin/hermes, e só o root cria arquivos
# em /opt: sem este atalho, o gateway de quem não é root não sobe ("Unable to locate executable"). Ele leva ao mesmo
# Hermes de todos. Uma reinstalação do pacote apaga a pasta; rodar de novo a recria.
G="$P/runtime/hermes-agent/.hermes/bin"; mkdir -p "$G"
[ -e "$G/hermes" ] && ! grep -q meu-bot-hermes-global "$G/hermes" && mv "$G/hermes" "$G/hermes.antes-do-meu-bot"
cat > "$G/hermes" <<'EOF'
#!/bin/sh
# meu-bot-hermes-global: o atalho que o serviço do gateway de cada usuário chama.
P=/opt/hermes/lib/node_modules/hermes-agent; R="$P/runtime/hermes-agent"
# Sem o venv, cai no caminho de sempre (o lançador Node).
[ -x "$R/venv/bin/hermes" ] || exec /usr/local/bin/hermes "$@"
export PATH="/opt/hermes/bin:/opt/hermes/node/bin:$PATH"
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0="$R"
export VIRTUAL_ENV="$R/venv" HERMES_NPM_BRIDGE=1 HERMES_NPM_PACKAGE_ROOT="$P" HERMES_NPM_PACKAGE_VERSION=@V@ HERMES_NPM_RELEASE_TAG=v@V@
unset PYTHONHOME PYTHONPATH
exec "$R/venv/bin/hermes" "$@"
EOF
sed -i "s/@V@/$V/g" "$G/hermes"
chmod 755 "$P/runtime/hermes-agent/.hermes" "$G" "$G/hermes"
# Confere como um usuário sem privilégio, que é quem vai usar.
H=$(mktemp -d); chmod 777 "$H"
O=$(runuser -u nobody -- env HOME="$H" "$W" --version 2>&1 | head -1); rm -rf "$H"
case "$O" in *"v$V"*) echo "HERMES=ok $V" ;; *) echo "ERRO=o Hermes instalou, mas um usuário comum não conseguiu rodar: $O" ;; esac`;
}

/** faster-whisper e o PyAV que funcionam juntos (o av 19 quebrou o decode_audio: "unexpected keyword metadata_errors"). */
const TRANSCRITOR_PIP = "faster-whisper==1.2.1 av==18.1.0";

/**
 * Transcritor para todos os usuários da máquina, no mesmo padrão do /opt/hermes: /opt/transcriber com dono root e 755
 * (todos leem e executam, só o root grava). Um ambiente Python com o faster-whisper, o modelo small (copiado de
 * /opt/hermes/modelos quando já está lá, senão baixado) e o bin/transcrever, que cada Hermes chama como o próprio
 * usuário pelo provedor local_command (HERMES_LOCAL_STT_COMMAND). Evita ~1,5 GB por usuário (extra + modelo) e o
 * "tools not on PATH" do hermes pm. Idempotente; confere como `nobody`. Saída `TRANSCRITOR=ok` ou `ERRO=`.
 */
export function transcritorSh(): string {
  return `T=/opt/transcriber; L=/tmp/meu-bot-transcritor.log; M="$T/modelos/whisper-small"
mkdir -p "$T/bin" "$T/modelos" || { echo "ERRO=não consegui criar $T"; exit 0; }
if ! "$T/venv/bin/python" -c "import faster_whisper, av" >/dev/null 2>&1; then
  rm -rf "$T/venv"
  python3 -m venv "$T/venv" >>"$L" 2>&1 || { DEBIAN_FRONTEND=noninteractive apt-get install -y -q python3-venv >>"$L" 2>&1; rm -rf "$T/venv"; python3 -m venv "$T/venv" >>"$L" 2>&1; } || { echo "ERRO=não consegui criar o ambiente Python em $T (log em $L)"; exit 0; }
  "$T/venv/bin/python" -m pip install -q ${TRANSCRITOR_PIP} >>"$L" 2>&1 || { echo "ERRO=não consegui instalar o faster-whisper em $T (log em $L)"; exit 0; }
fi
if [ ! -s "$M/model.bin" ]; then
  if [ -s /opt/hermes/modelos/whisper-small/model.bin ]; then rm -rf "$M"; cp -a /opt/hermes/modelos/whisper-small "$M"
  else "$T/venv/bin/python" -c 'import sys; from huggingface_hub import snapshot_download; snapshot_download("Systran/faster-whisper-small", local_dir=sys.argv[1])' "$M" >>"$L" 2>&1 || { echo "ERRO=não consegui baixar o modelo de transcrição (log em $L)"; exit 0; }; fi
fi
cat > "$T/bin/transcrever" <<'PYEOF'
#!/opt/transcriber/venv/bin/python
"""meu-bot-transcritor: o transcritor de todos os usuários da máquina (dono root; os outros só leem e executam).

Cada Hermes chama como o próprio usuário, pelo provedor local_command:
  HERMES_LOCAL_STT_COMMAND="/opt/transcriber/bin/transcrever {input_path} {output_dir} {language}"
Grava <output_dir>/<nome do áudio>.txt com o texto.
"""
import os, sys
from pathlib import Path

MODELO = "/opt/transcriber/modelos/whisper-small"

def main() -> int:
    if len(sys.argv) < 3:
        print("uso: transcrever <audio> <pasta-saida> [idioma]", file=sys.stderr)
        return 2
    audio, saida = Path(sys.argv[1]), Path(sys.argv[2])
    idioma = (sys.argv[3] if len(sys.argv) > 3 else "pt") or "pt"
    from faster_whisper import WhisperModel
    modelo = WhisperModel(MODELO, device="cpu", compute_type="int8", cpu_threads=min(4, os.cpu_count() or 1))
    partes, _info = modelo.transcribe(str(audio), language=None if idioma == "auto" else idioma, vad_filter=True)
    texto = " ".join(p.text.strip() for p in partes).strip()
    saida.mkdir(parents=True, exist_ok=True)
    (saida / f"{audio.stem}.txt").write_text(texto + "\\n", encoding="utf-8")
    return 0

if __name__ == "__main__":
    sys.exit(main())
PYEOF
chown -R root:root "$T"; chmod -R u=rwX,go=rX "$T"; chmod 755 "$T/bin/transcrever"
# Confere como um usuário sem privilégio, que é quem vai usar: um segundo de silêncio tem de virar um .txt.
H=$(mktemp -d); chmod 777 "$H"
runuser -u nobody -- "$T/venv/bin/python" -c 'import sys, wave; w = wave.open(sys.argv[1], "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(bytes(32000)); w.close()' "$H/teste.wav" >>"$L" 2>&1
runuser -u nobody -- "$T/bin/transcrever" "$H/teste.wav" "$H/saida" pt >>"$L" 2>&1
if [ -f "$H/saida/teste.txt" ]; then echo "TRANSCRITOR=ok"; else echo "ERRO=o transcritor instalou, mas um usuário comum não conseguiu rodar (log em $L)"; fi
rm -rf "$H"`;
}

/**
 * Linger: os serviços de usuário dele (o Hermes do WhatsApp roda com `systemctl --user`) seguem rodando quando ele
 * sai da máquina e voltam sozinhos ao reiniciar. Sem isso o agente morre junto com a última sessão SSH dele.
 * Saída `LINGER=ok` ou `ERRO=`.
 */
export const lingerSh = (nome: string): string => `id '${nome}' >/dev/null 2>&1 || { echo "ERRO=não existe o usuário ${nome}"; exit 0; }
loginctl enable-linger '${nome}' >/dev/null 2>&1; [ -e '/var/lib/systemd/linger/${nome}' ] && echo LINGER=ok || echo "ERRO=o systemd não deixou ${nome} sempre ligado"`;

/** Quanto do limite macio o usuário já usou: `perto` a partir de 80% (quando a pessoa recebe o 1º aviso), `cheio` em 100% (ainda grava por 7 dias, com a folga). */
export function nivelUso(usadoKb: number | null, limiteKb: number | null): "ok" | "perto" | "cheio" {
  if (usadoKb === null || limiteKb === null || limiteKb <= 0) return "ok";
  return usadoKb >= limiteKb ? "cheio" : usadoKb >= limiteKb * 0.8 ? "perto" : "ok";
}

/** Apelido aceito: até 40 caracteres, sem ":", "," nem quebra (são separadores do /etc/passwd). Vazio = sem apelido. */
/** Marca do apelido no GECOS: só o que vem depois dela é apelido do meu-bot ("root", "Ubuntu" e afins ficam de fora). ":" não entra no GECOS. */
export const GECOS_MARCA = "meu-bot=";
/** O apelido como dá para gravar: tira o que o GECOS e o parser não aceitam (dois-pontos, vírgula, barra, quebras) em vez de recusar. */
export const apelidoLimpo = (v: string): string => v.replace(/[:,\\\n\r\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
export function apelidoValido(v: unknown): string {
  if (typeof v !== "string") throw new Error("apelido inválido");
  const a = v.replace(/\s+/g, " ").trim();
  if (a.length > 40 || /[:,\n\r\t\\]/.test(a)) throw new Error("apelido: até 40 caracteres, sem dois-pontos nem vírgula");
  return a;
}
/** Grava o apelido no campo de descrição do usuário (GECOS); login e pasta não mudam. Saída `APELIDO=ok` ou `ERRO=`. */
export const apelidoSh = (nome: string, apelido: string): string => `id '${nome}' >/dev/null 2>&1 || { echo "ERRO=não existe o usuário ${nome}"; exit 0; }
A=$(printf '%s' '${Buffer.from(apelido, "utf8").toString("base64")}' | base64 -d)
usermod -c "$([ -n "$A" ] && printf '%s%s' '${GECOS_MARCA}' "$A")" '${nome}' && echo APELIDO=ok || echo "ERRO=não consegui gravar o apelido"`;

/** Nome do Host no ~/.ssh/config para o usuário de uma máquina: `<máquina>-<usuário>` (só letras, números, - e .). */
export function aliasDoUsuario(maquina: string, nome: string): string {
  const m = maquina.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "maquina";
  return `${m}-${nome}`.slice(0, 63);
}
/** O bloco que entra no ~/.ssh/config deste Mac (com a chave do admin, que já está no authorized_keys do usuário). */
export function blocoSshUsuario(o: { alias: string; hostname: string; port: string; user: string; chave: string; maquina: string }): string {
  return `# meu-bot-admin: usuário ${o.user} da máquina ${o.maquina}
Host ${o.alias}
    HostName ${o.hostname}
    User ${o.user}
    Port ${o.port}
    IdentityFile ${o.chave}
    IdentitiesOnly yes
`;
}
/** O ~/.ssh/config já tem um Host com esse nome (em qualquer posição da linha Host)? */
export const configTemHost = (texto: string, alias: string): boolean =>
  texto.split("\n").some((l) => { const m = /^\s*Host\s+(.+)$/i.exec(l); return m !== null && m[1]!.trim().split(/\s+/).includes(alias); });

/**
 * Tetos com que todo usuário novo nasce (mudam na linha dele): um agente travado não derruba a máquina. 1,25 GB (30 out,
 * decisão de produto: 22 boxes em 32 GB): o uso próprio medido é ~0,3-0,4 GB, mas o transcritor de áudio roda dentro
 * da box e chega a ~0,6 GB por áudio, então perto do MemoryHigh (1152 MB) a box fica apertada durante um áudio; a
 * coluna Pressão mostra, e a medição com 10 boxes decide se muda.
 */
export const RECURSOS_PADRAO = { ramMb: 1280, cpuPct: 200 } as const;

const CHAVE_PUB_RE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) [A-Za-z0-9+/=]{20,}( [\w@.:-]{0,80})?$/;
/**
 * Usuário comum (sem sudo, bash, home própria) com estas chaves no authorized_keys, como root na máquina. `seExistir`:
 * "erro" (aba Usuários do meu-bot-admin: nome novo) ou "chaves" (meu-bot-admin-mac ligando uma conta do Mac à VM: o
 * usuário que já existe só ganha as chaves que faltam). Imprime `CRIADO=<n>` ou `JAEXISTIA=<n>`, ou `ERRO=<motivo>`.
 */
export function usuarioComChavesSh(nome: string, chaves: readonly string[], seExistir: "erro" | "chaves"): string {
  if (!NOME_USUARIO_RE.test(nome) || RESERVADOS.has(nome)) throw new Error("nome inválido");
  if (chaves.length === 0 || !chaves.every((c) => CHAVE_PUB_RE.test(c.trim()))) throw new Error("chave pública inválida");
  // Uma por linha, com a quebra no fim: o `read` do shell pula a última linha sem quebra.
  const b64 = Buffer.from(`${chaves.map((c) => c.trim()).join("\n")}\n`, "utf8").toString("base64");
  return `set -e
[ "$(id -u)" = 0 ] || { echo "ERRO=o admin não entra como root nesta máquina"; exit 0; }
N='${nome}'
if id "$N" >/dev/null 2>&1; then
  ${seExistir === "erro" ? `echo "ERRO=já existe um usuário $N nesta máquina"; exit 0` : `if [ "$(id -u "$N")" -lt 1000 ] || id -nG "$N" | tr ' ' '\\n' | grep -qxE 'sudo|wheel|admin'; then echo "ERRO=o usuário $N desta máquina é do sistema ou tem sudo"; exit 0; fi; ACAO=JAEXISTIA`}
else useradd -m -s /bin/bash "$N"; ACAO=CRIADO; fi
H=$(getent passwd "$N" | cut -d: -f6)
install -d -m 700 -o "$N" -g "$N" "$H/.ssh"
touch "$H/.ssh/authorized_keys"
printf '%s' '${b64}' | base64 -d | while IFS= read -r k; do [ -n "$k" ] && ! grep -qF "$(echo "$k" | cut -d' ' -f2)" "$H/.ssh/authorized_keys" && echo "$k" >> "$H/.ssh/authorized_keys"; done; true
chown "$N:$N" "$H/.ssh/authorized_keys"; chmod 600 "$H/.ssh/authorized_keys"
echo "$ACAO=$N"`;
}

/** Usuários que entram sozinhos nos seletores: comuns (sem sudo, fora do meu-bot e do sistema) e com a chave deste Mac. */
export const candidatosAoSeletor = (usuarios: UsuarioMaquina[]): UsuarioMaquina[] =>
  usuarios.filter((u) => !u.sudo && !u.meuBot && u.chave && !RESERVADOS.has(u.nome) && !PROTEGIDOS.has(u.nome));
/** Comuns que ficam de fora por não terem a chave deste Mac (o admin não entra neles para pô-los no seletor). */
export const semChaveDesteMac = (usuarios: UsuarioMaquina[]): string[] =>
  usuarios.filter((u) => !u.sudo && !u.meuBot && !u.chave && !RESERVADOS.has(u.nome) && !PROTEGIDOS.has(u.nome)).map((u) => u.nome);

/**
 * Tira do ~/.ssh/config só o bloco que o admin escreveu para `alias` (`blocoSshUsuario`): o comentário-marca, a linha
 * `Host` e as linhas indentadas dela, e a linha em branco antes. Sem a marca logo acima, o bloco não é do admin e fica.
 * (O `removeSshHost` corta até o próximo Host e levaria junto o comentário do bloco seguinte.)
 */
export function removerBlocoUsuario(texto: string, alias: string): { texto: string; removido: boolean } {
  const linhas = texto.split("\n");
  const i = linhas.findIndex((l) => { const m = /^Host\s+(\S+)\s*$/.exec(l); return m !== null && m[1] === alias; });
  if (i < 1 || !/^# meu-bot-admin: usuário \S+ da máquina /.test(linhas[i - 1]!)) return { texto, removido: false };
  let fim = i + 1;
  while (fim < linhas.length && /^\s+\S/.test(linhas[fim]!)) fim++;
  const ini = i - 1 > 0 && linhas[i - 2]!.trim() === "" ? i - 2 : i - 1;
  return { texto: [...linhas.slice(0, ini), ...linhas.slice(fim)].join("\n"), removido: true };
}

/**
 * Grava (ou apaga, com `alvoJson` null) o whatsapp-alvo.json de um usuário da máquina, como root: onde vive o WhatsApp
 * dele (conta e agente num gateway de outro usuário). Dono do formato: src/main/whatsapp/whatsapp-capacidades.ts.
 */
export const whatsappAlvoSh = (nome: string, alvoJson: string | null): string => `H=$(getent passwd '${nome}' | cut -d: -f6); [ -n "$H" ] && [ -d "$H" ] || { echo "ERRO=não achei a pasta de ${nome}"; exit 0; }
D=$H/.local/share/meu-bot; F=$D/whatsapp-alvo.json
install -d -m 700 -o '${nome}' -g '${nome}' "$D" 2>/dev/null || mkdir -p "$D"
${alvoJson === null
    ? `rm -f "$F" && echo ALVO=ok || echo "ERRO=não consegui apagar o alvo"`
    : `printf '%s' '${Buffer.from(alvoJson, "utf8").toString("base64")}' | base64 -d > "$F.tmp" && chown '${nome}':'${nome}' "$F.tmp" && chmod 600 "$F.tmp" && mv "$F.tmp" "$F" && echo ALVO=ok || echo "ERRO=não consegui gravar o alvo"`}`;
