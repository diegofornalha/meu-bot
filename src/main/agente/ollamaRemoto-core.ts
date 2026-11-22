/**
 * Modo grátis numa máquina por SSH (tutorial 16): a parte pura. O Ollama do meu-bot roda na própria máquina (Linux
 * x86_64), instalado pelo backend-colima/install-ollama.sh como serviço do usuário; aqui ficam o script que lê o estado,
 * a leitura da resposta e o que o instalador recebe do app. Testável com node --test (o script, com bash num HOME de
 * mentira). O par deste arquivo no Mac é o ollamaLocal-core.ts.
 */
import type { OllamaStatus } from "../../shared/ipc";
import { BACKEND_DIR_SH } from "../maquina/backend-dir-core";
import { OLLAMA_PACOTE_BYTES_LINUX, OLLAMA_SHA256_LINUX, OLLAMA_URL_LINUX, OLLAMA_VERSION_LOCAL, modeloParaMaquinaRemota } from "./ollamaLocal-core";

/** Memória mínima da máquina: o modelo leve ocupa ~2,5 GB carregado, ao lado do backend e do agente do WhatsApp. */
export const MEM_MINIMA_REMOTA_MB = 5_500;
const PACOTE_MB = Math.ceil(OLLAMA_PACOTE_BYTES_LINUX / 1_048_576);
/** O pacote extraído ocupa ~2,4 GB (traz as bibliotecas de GPU); durante a instalação o .tar.zst ainda está ao lado. */
const PROGRAMA_EXTRAIDO_MB = 2_500;
/** Espaço que a instalação pede: o pacote, ele extraído, o modelo e 2 GB de folga. */
export const espacoNecessarioRemotoMb = (): number => PACOTE_MB + PROGRAMA_EXTRAIDO_MB + modeloParaMaquinaRemota().downloadMb + 2_048;

/** Variáveis que o install-ollama.sh espera (versão, sha256, URL e modelo têm fonte única no ollamaLocal-core.ts). */
export const envDoInstalador = (): string =>
  `OLLAMA_VERSION=${OLLAMA_VERSION_LOCAL} OLLAMA_SHA256=${OLLAMA_SHA256_LINUX} OLLAMA_URL='${OLLAMA_URL_LINUX}' OLLAMA_MODELO='${modeloParaMaquinaRemota().id}' OLLAMA_PACOTE_MB=${PACOTE_MB}`;

/**
 * Lê o estado do modo grátis na máquina, uma linha `chave=valor` por fato. A porta é a do backend desta conta - 200, a
 * mesma conta que o install-ollama.sh faz; o modelo só vale com a entrada ollama-local no providers.json.
 */
export const OLLAMA_STATUS_SH = [
  BACKEND_DIR_SH,
  `BPORT=$(grep -h '^PORT=' "$BD/.env" 2>/dev/null | head -1 | cut -d= -f2 | tr -dc '0-9'); [ -n "$BPORT" ] || BPORT=8080; OPORT=$((BPORT-200))`,
  `PX="$HOME/.local/share/meu-bot/ollama"`,
  `echo "os=$(uname -s)"; echo "arch=$(uname -m)"`,
  `if systemctl --user show-environment >/dev/null 2>&1; then echo sd=1; else echo sd=0; fi`,
  `if [ -f "$BD/providers.js" ]; then echo bk=1; else echo bk=0; fi`,
  `echo "mem=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null)"`,
  `echo "livre=$(df -Pm "$HOME" 2>/dev/null | awk 'NR==2{print $4}')"`,
  `if [ -x "$PX/v${OLLAMA_VERSION_LOCAL}/bin/ollama" ]; then echo inst=1; else echo inst=0; fi`,
  `M=$(head -1 "$PX/modelo" 2>/dev/null | tr -dc 'A-Za-z0-9.:_-'); grep -q '"ollama-local"' "$BD/providers.json" 2>/dev/null || M=""; echo "modelo=$M"`,
  `if curl -fsS -m 3 "http://127.0.0.1:$OPORT/api/version" >/dev/null 2>&1; then echo run=1; else echo run=0; fi`,
  `if [ -n "$M" ] && curl -fsS -m 4 "http://127.0.0.1:$OPORT/api/tags" 2>/dev/null | grep -q "\"$M\""; then echo pronto=1; else echo pronto=0; fi`,
].join("\n");

/** "ligar"/"parar" da lateral: o serviço do usuário que o instalador criou. */
export const ollamaLigarSh = (ligado: boolean): string => `systemctl --user ${ligado ? "start" : "stop"} meu-bot-ollama.service 2>&1; sleep ${ligado ? 2 : 1}`;

/** A resposta do OLLAMA_STATUS_SH no formato do status do Mac; null = a máquina não respondeu o que se esperava. */
export function lerStatusRemoto(stdout: string): OllamaStatus | null {
  const v = new Map<string, string>();
  for (const l of stdout.split("\n")) { const i = l.indexOf("="); if (i > 0) v.set(l.slice(0, i).trim(), l.slice(i + 1).trim()); }
  if (!v.has("os") || !v.has("inst")) return null;
  const num = (k: string): number | null => { const n = Number(v.get(k)); return v.get(k) !== undefined && v.get(k) !== "" && Number.isFinite(n) ? n : null; };
  const memMb = num("mem");
  const instalado = v.get("inst") === "1";
  const modelo = v.get("modelo") !== undefined && v.get("modelo") !== "" ? (v.get("modelo") as string) : null;
  const rodando = instalado && v.get("run") === "1";
  // Linux x86_64 com systemd de usuário, o backend do meu-bot com providers.js e memória para o modelo.
  const possivel = v.get("os") === "Linux" && v.get("arch") === "x86_64" && v.get("sd") === "1" && v.get("bk") === "1" && (memMb === null || memMb >= MEM_MINIMA_REMOTA_MB);
  return {
    possivel, instalado, rodando, pronto: rodando && modelo !== null && v.get("pronto") === "1", modelo,
    recomendado: modeloParaMaquinaRemota(), memMb, livreMb: num("livre"), necessarioMb: espacoNecessarioRemotoMb(), versao: OLLAMA_VERSION_LOCAL,
    remoto: true, programaMb: PACOTE_MB,
  };
}
