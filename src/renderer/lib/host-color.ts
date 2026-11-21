/** Cor de destaque estável por máquina, para a faixa da janela e a bolinha do seletor. Puro. */

const LOCAL_HUE = 210;

/** FNV-1a espalhado pela razão áurea: nomes parecidos caem longe um do outro na roda de cores. */
function hashHue(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return Math.round(((h * 0.6180339887) % 1) * 360) % 360;
}

/**
 * No meu-bot-admin a máquina da pessoa é o alias `suporte-<nome>-<4 hex>` (main/support-code.ts, `supportAlias`);
 * a cor sai do `<nome>`, que é o mesmo que a pessoa vê no app dela quando a máquina se chama assim. Assim o seletor do
 * admin espelha as cores do seletor da pessoa. Outros hosts usam o nome inteiro.
 */
export function hostColorKey(host: string): string {
  const m = /^suporte-([a-z0-9-]+)-[0-9a-f]{4}$/.exec(host);
  return m?.[1] ?? host;
}

/** `hsl(h 65% 48%)`; `local` tem matiz fixo, os outros vêm de um hash do nome (ver hostColorKey). */
export function hostAccent(host: string): string {
  const key = hostColorKey(host);
  const hue = key === "local" ? LOCAL_HUE : hashHue(key);
  return `hsl(${hue} 65% 48%)`;
}
