/**
 * Modo grátis no Mac (tutorial 16): a parte pura do ollamaLocal.ts. Versão e checksum fixos do Ollama, o modelo pela
 * memória do Mac, a porta própria deste app e a entrada do providers.json. Testável com node --test.
 */
import { mesclarProvider, providerPorNome, semProvider } from "../maquina/providers-local-core";

/** Versão fixa do Ollama que o app baixa (ollama-darwin.tgz do GitHub Releases, binário universal). */
export const OLLAMA_VERSION_LOCAL = "0.40.15";
export const OLLAMA_URL_LOCAL = `https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION_LOCAL}/ollama-darwin.tgz`;
/** sha256 do ollama-darwin.tgz dessa versão (o "digest" do asset no GitHub, conferido no download). */
export const OLLAMA_SHA256_LOCAL = "607c79d5d6315ef9d896db83adde736a4c0057196329843544e79b95afb260a8";
/** Tamanho do pacote (bytes), para o progresso do download e o espaço que ele pede. */
export const OLLAMA_PACOTE_BYTES = 185_971_671;

/** Nome do provedor no providers.json e do modelo que o chat pede ao backend. */
export const OLLAMA_PROVIDER = "ollama-local";

/**
 * Porta própria do `ollama serve` deste app: a do backend local - 200 (8590 no meu-bot, 8591 no staging). Não é a
 * 11434 padrão de propósito: um Ollama que a pessoa já tenha continua intocado na dele.
 */
export const ollamaPortaLocal = (portaBackend: number): number => portaBackend - 200;
export const ollamaUrlLocal = (porta: number): string => `http://127.0.0.1:${porta}`;

export interface ModeloOllama { id: string; rotulo: string; downloadMb: number }
const PEQUENO: ModeloOllama = { id: "qwen2.5:3b", rotulo: "Qwen 2.5 3B (leve)", downloadMb: 1_900 };
const MEDIO: ModeloOllama = { id: "qwen2.5:7b", rotulo: "Qwen 2.5 7B", downloadMb: 4_700 };

/** Modelo pela memória total: até 8 GB (dividida com o macOS e o app) vai o leve; acima, o 7B. Sem saber, o leve. */
export function modeloParaMemoria(memMb: number | null): ModeloOllama {
  return memMb !== null && memMb > 8 * 1024 ? MEDIO : PEQUENO;
}

/** Espaço que a instalação pede: o pacote extraído (~3x o .tgz), o modelo e 2 GB de folga. */
export const espacoNecessarioMb = (m: ModeloOllama): number => Math.ceil((OLLAMA_PACOTE_BYTES * 3) / 1_048_576) + m.downloadMb + 2_048;

/** Entrada do providers.json: openai local (sem chave), última na prioridade; timeout longo (modelo frio no Mac). */
export function entradaOllama(porta: number, modelo: string): { name: string; type: "openai"; priority: number; base_url: string; model: string; timeout_ms: number; description: string } {
  return { name: OLLAMA_PROVIDER, type: "openai", priority: 9, base_url: `${ollamaUrlLocal(porta)}/v1`, model: modelo, timeout_ms: 300_000, description: "Modo grátis: Ollama neste Mac (tutorial 16)" };
}

export const providersComOllama = (raw: string | null, porta: number, modelo: string): string => mesclarProvider(raw, entradaOllama(porta, modelo));
export const providersSemOllama = (raw: string | null): string => semProvider(raw, OLLAMA_PROVIDER);

/** Modelo do Ollama que o providers.json deste app usa (apontando a porta deste app), ou null = não preparado. */
export function modeloNoProviders(raw: string | null, porta: number): string | null {
  const p = providerPorNome(raw, OLLAMA_PROVIDER);
  if (p === null || p["base_url"] !== `${ollamaUrlLocal(porta)}/v1` || typeof p["model"] !== "string") return null;
  return p["model"];
}

/** O providers.json tem o Ollama em qualquer porta? (o backend local pode subir sem o Claude). */
export const temOllamaNoProviders = (raw: string | null): boolean => providerPorNome(raw, OLLAMA_PROVIDER) !== null;

/** Um processo na porta é o `ollama serve` deste app (de uma abertura anterior)? Pelo binário na pasta do meu-bot. */
export function ehNossoOllamaOrfao(comando: string, prefixo: string): boolean {
  const c = comando.trim();
  return c.startsWith(prefixo) && /\/ollama serve\b/.test(c);
}

/** Linha de progresso de um evento do POST /api/pull ({status, total, completed}); null = nada a mostrar. */
export function linhaDoPull(ev: unknown, ultimaPct: number): { texto: string; pct: number } | null {
  if (typeof ev !== "object" || ev === null) return null;
  const e = ev as { status?: unknown; total?: unknown; completed?: unknown; error?: unknown };
  if (typeof e.error === "string") return { texto: `erro: ${e.error}`, pct: ultimaPct };
  const total = typeof e.total === "number" ? e.total : 0;
  const feito = typeof e.completed === "number" ? e.completed : 0;
  if (total > 50 * 1_048_576 && feito > 0) {
    const pct = Math.floor((feito / total) * 100);
    if (pct < ultimaPct + 5 && pct < 100) return null; // de 5 em 5%: o log não vira uma enxurrada
    const gb = (b: number): string => (b / 1_073_741_824).toFixed(1).replace(".", ",");
    return { texto: `baixando o modelo: ${pct}% (${gb(feito)} de ${gb(total)} GB)`, pct };
  }
  if (typeof e.status === "string" && !/^pulling [0-9a-f]{6,}/.test(e.status)) return { texto: e.status, pct: ultimaPct };
  return null;
}
