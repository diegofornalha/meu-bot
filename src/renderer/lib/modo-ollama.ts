/** O ollama-local no menu "Modos do agente": quando aparece, quando dá para escolher e o que a linha diz. */
export interface ModoOllamaEntrada {
  /** O modo grátis é oferecido nesta janela (este Mac com chip Apple ou máquina Linux x86_64, canal de staging). */
  oferecido: boolean;
  /** O Ollama do meu-bot está instalado com um modelo. */
  instalado: boolean;
  /** Modelo instalado ("qwen2.5:7b"); null = nenhum. */
  modelo: string | null;
  /** A conversa aberta já usa o ollama-local (veio do tutorial, da paleta ou do modelo padrão). */
  emUso: boolean;
  /** O Ollama é o da máquina por SSH desta janela, não o deste Mac. */
  remoto?: boolean;
}
export interface ModoOllama { mostrar: boolean; disponivel: boolean; texto: string }

/** "qwen2.5:7b" → "Qwen 2.5 7B"; outro modelo sai como veio. */
export function rotuloDoModelo(modelo: string | null): string {
  const m = modelo === null ? null : /^qwen(\d+(?:\.\d+)?)(?::(\d+(?:\.\d+)?)b)?$/i.exec(modelo);
  if (m === null || m === undefined) return modelo ?? "Qwen 2.5";
  return `Qwen ${m[1]}${m[2] !== undefined ? ` ${m[2]}B` : ""}`;
}

/**
 * A lista de modelos da máquina vem da sondagem da abertura, anterior à instalação do Ollama: por ela o modo
 * apareceria como "não existe nesta máquina" logo depois de instalado. Aqui quem decide é o estado do Ollama.
 * Fora de onde o modo grátis é oferecido a linha some, a não ser que a conversa já esteja nele.
 */
export function modoOllama(e: ModoOllamaEntrada): ModoOllama {
  const disponivel = e.oferecido && e.instalado && e.modelo !== null;
  return { mostrar: e.oferecido || e.emUso, disponivel, texto: `ollama-local · ${rotuloDoModelo(e.modelo)} no Ollama ${e.remoto === true ? "desta máquina, grátis" : "deste Mac, grátis e sem internet"}` };
}
