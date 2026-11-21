/** Modo "sugere e você aprova" do WhatsApp: os textos da lista de sugestões (puro, testado com node --test). */

/** "agora", "há 5 min", "há 2 h", "há 3 d". Hora ilegível ou no futuro: "agora". */
export function haQuanto(em: string, agora: number = Date.now()): string {
  const t = Date.parse(em);
  const min = Number.isNaN(t) ? 0 : Math.floor((agora - t) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.floor(min / 60)} h`;
  return `há ${Math.floor(min / 1440)} d`;
}

/** "+5511988887777" → "5511988887777" (a chave das conversas na lista); grupo ou lixo → null. */
export const numeroDoDestino = (para: string): string | null => (/^\+\d{8,15}$/.test(para) ? para.slice(1) : null);

/** A linha de cima da caixa: o estado do modo e quantas esperam. */
export function resumoDoModo(ligado: boolean, pendentes: number): string {
  const n = pendentes === 0 ? "nenhuma sugestão esperando" : pendentes === 1 ? "1 sugestão esperando você" : `${pendentes} sugestões esperando você`;
  return ligado ? `Modo sugestão ligado · ${n}` : pendentes === 0 ? "Modo sugestão desligado" : `Modo sugestão desligado · ${n}`;
}

/** O rótulo do botão da lista "WhatsApp" com o contador ("WhatsApp · 2"); sem pendência, só o nome. */
export const rotuloComContador = (pendentes: number): string => (pendentes > 0 ? `WhatsApp · ${pendentes > 99 ? "99+" : pendentes}` : "WhatsApp");
