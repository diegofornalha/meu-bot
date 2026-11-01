/**
 * O que dizer quando o túnel abre mas o backend não responde (parte pura de backend.ts › readyTunnel). Até 1/11 a
 * sonda GET /v1/models devolvia só `false`: o log dizia "túnel sem resposta" sem motivo e a pessoa lia "a VM pode estar
 * pausada pelo host" com o SSH respondendo na hora. Naquele dia os quatro backends da VM estavam em loop de
 * MODULE_NOT_FOUND e a porta recusava: era o serviço, não a VM. Aqui a falha ganha tipo, texto e, quando dá, a dica
 * tirada do log do serviço na máquina (journalctl ou backend.log).
 */
import { BACKEND_DIR_SH } from "./backend-dir-core";

export type TipoFalhaPreflight = "cortada" | "recusada" | "timeout" | "http";
export interface FalhaPreflight { tipo: TipoFalhaPreflight; codigo: string; status: number | null }

/** Classifica o erro (ou o status HTTP) da sonda. `err` null com status ≥ 500 = o backend respondeu, mas mal. */
export function classificarPreflight(err: { code?: string; message?: string; name?: string } | null, status: number | null): FalhaPreflight {
  if (err === null) return { tipo: "http", codigo: `HTTP ${status ?? "?"}`, status };
  const code = err.code ?? "";
  const msg = err.message ?? "";
  if (code === "ECONNREFUSED") return { tipo: "recusada", codigo: code, status: null };
  if (code === "ETIMEDOUT_LOCAL" || code === "ETIMEDOUT" || err.name === "AbortError" || /timed? ?out/i.test(msg)) return { tipo: "timeout", codigo: code || "timeout", status: null };
  if (code === "ECONNRESET" || code === "EPIPE" || code === "UND_ERR_SOCKET" || /socket hang up/i.test(msg)) return { tipo: "cortada", codigo: code || "ECONNRESET", status: null };
  return { tipo: "cortada", codigo: code || (msg.slice(0, 40) || "erro"), status: null };
}

const maquina = (local: boolean): string => (local ? "deste Mac" : "desta máquina");

/** Uma frase, sem ponto final, para a pill, a faixa e o log. */
export function textoPreflight(f: FalhaPreflight, porta: number, local = false): string {
  switch (f.tipo) {
    case "cortada": return `o backend ${maquina(local)} não está respondendo na porta ${porta} (${f.codigo}: o túnel entrou, mas ninguém escuta nessa porta)`;
    case "recusada": return `o túnel SSH não está escutando na porta local (${f.codigo})`;
    case "timeout": return `o backend ${maquina(local)} não respondeu na porta ${porta} em 8 s (travado, ou a VM pausada)`;
    case "http": return `o backend ${maquina(local)} respondeu ${f.codigo} na porta ${porta}`;
  }
}

/** O `detail` do backend:status enquanto insiste. Com erro de SSH mantém o texto de sempre (a VM é mesmo a suspeita). */
export function detalheTentativa(falha: FalhaPreflight | null, sshErr: string | null, porta: number, esperaS: number, vez: number, local = false): string {
  const fim = `tentando de novo em ${esperaS} s (${vez}ª vez)…`;
  if (falha !== null) return `${textoPreflight(falha, porta, local)}; ${fim}`;
  if (sshErr !== null && sshErr !== "") return `VM sem resposta (${sshErr.slice(0, 80)}); ${fim}`;
  return `VM sem resposta; ${fim}`;
}

export interface ErroFinalParams {
  falha: FalhaPreflight | null;
  sshErr: string | null;
  porta: number;
  segundos: number;
  interativo: boolean;
  dica: string | null;
  local?: boolean;
}
/** A mensagem que chega à conversa quando o prazo acaba. */
export function erroFinal(p: ErroFinalParams): string {
  const local = p.local === true;
  if (p.falha !== null) {
    const ultimo = p.dica !== null && p.dica !== "" ? ` Último erro do backend: ${p.dica}.` : "";
    if (p.falha.tipo === "timeout") return `O backend ${maquina(local)} não respondeu na porta ${p.porta} em ${p.segundos} s (timeout): ele pode estar travado, ou a VM pausada pelo host. Tente de novo daqui a pouco.${ultimo}`;
    const conserto = local ? "Feche e abra a janela desta máquina para subir o backend de novo." : "O serviço meu-bot-backend pode ter caído: \"Reinstalar backend\" no seletor sobe o serviço de novo.";
    return `O backend ${maquina(local)} não respondeu na porta ${p.porta} em ${p.segundos} s (${p.falha.codigo}). ${conserto}${ultimo}`;
  }
  const why = p.sshErr !== null && p.sshErr !== "" ? ` (${p.sshErr})` : "";
  return p.interativo
    ? `A VM não respondeu pelo túnel em ${p.segundos} s, mesmo reabrindo. Ela pode estar pausada pelo host; tente de novo daqui a pouco.${why}`
    : `A VM não respondeu pelo túnel, mesmo depois de reabrir.${why}`;
}

/**
 * Lê na máquina o estado e as últimas linhas do serviço: root → unidade de sistema; usuário → a de usuário e, se
 * existir, a de sistema; depois o backend.log da pasta do backend (pm2/nohup). Tudo em até 80 linhas, nunca falha.
 */
export const COMANDO_LOG_BACKEND = [
  `J(){ journalctl "$@" -u meu-bot-backend -n 40 --no-pager -o short-iso 2>/dev/null; }`,
  `S(){ systemctl "$@" show -p ActiveState -p Result -p NRestarts meu-bot-backend 2>/dev/null | tr '\\n' ' '; }`,
  `if [ "$(id -u)" -eq 0 ]; then echo "unidade=sistema $(S)"; J; else echo "unidade=usuario $(S --user)"; J --user; if [ -f /etc/systemd/system/meu-bot-backend.service ]; then echo "unidade=sistema $(S)"; J; fi; fi`,
  BACKEND_DIR_SH,
  `if [ -f "$BD/backend.log" ]; then echo "--- backend.log"; tail -n 40 "$BD/backend.log"; fi`,
  `true`,
].join("; ") + " 2>/dev/null | tail -n 80";

const REGRAS: { re: RegExp; dica: (m: RegExpMatchArray) => string }[] = [
  { re: /Cannot find module '([^']+)'/, dica: (m) => `MODULE_NOT_FOUND ${m[1]!}` },
  { re: /EADDRINUSE/, dica: () => "EADDRINUSE: porta já em uso" },
  { re: /SyntaxError: (.{1,80})/, dica: (m) => `SyntaxError: ${m[1]!.trim()}` },
  { re: /start request repeated too quickly/, dica: () => "systemd desistiu de reiniciar (start-limit)" },
  { re: /Failed with result '([^']+)'/, dica: (m) => `serviço falhou (${m[1]!})` },
  { re: /\b(?:[A-Za-z]+Error|Error): (.{1,120})/, dica: (m) => m[0]!.slice(0, 120).trim() },
];
/** A causa mais provável nas últimas linhas do log, por prioridade (a mais recente de cada regra). */
export function dicaDoLog(linhas: readonly string[]): string | null {
  for (const r of REGRAS) {
    for (let i = linhas.length - 1; i >= 0; i--) {
      const m = r.re.exec(linhas[i]!);
      if (m !== null) return r.dica(m);
    }
  }
  return null;
}

/** Um diagnóstico por episódio: não repete dentro de `minMs` (o log não muda e o ssh custa). */
export const podeDiagnosticar = (ultimoEm: number | null, agora: number, minMs = 120_000): boolean => ultimoEm === null || agora - ultimoEm >= minMs;
