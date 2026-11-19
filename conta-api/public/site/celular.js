// Visitante de celular na home: o que aqui é conta pura (testada em tests/site-core.test.mjs); quem troca os botões é o
// site.js. O celular não instala o app, então vira conversa no WhatsApp, e o link que a pessoa manda para o próprio Mac
// leva a campanha do anúncio, para o download de lá contar para o anúncio de cá.
(() => {
  /** O site de produção: só entra quando a origem da página não veio (ou não é um endereço http). */
  const PRODUCAO = "https://agentesgrok.com";
  /** Celular ou tablet. O Safari do iPad se apresenta como Mac: Mac com tela de toque é iPad. */
  const ehCelular = (ua, toques) => /Android|iPhone|iPad|iPod|Windows Phone/i.test(ua) || (/Macintosh/i.test(ua) && Number(toques) > 1);
  const limpo = (v) => (typeof v === "string" && /^[A-Za-z0-9._-]{1,60}$/.test(v) ? v : null);
  /**
   * O link do site para abrir em outro aparelho. Com campanha na visita, ela segue e o utm_content ganha o sufixo
   * ("empresario" vira "empresario-celular"); sem campanha, a origem é o sufixo. O código do clique (gclid e afins) não
   * vai junto: ele é do clique neste aparelho. `origem` é a do site em que a pessoa está (`location.origin`, que o
   * site.js passa): quem está no staging manda para si o link do staging, não o da produção.
   */
  const linkParaMac = (busca, sufixo, origem) => {
    const SITE = `${typeof origem === "string" && /^https?:\/\/[^/?#]+$/.test(origem) ? origem : PRODUCAO}/`;
    const de = new URLSearchParams(busca || ""), para = new URLSearchParams();
    const fonte = limpo(de.get("utm_source")), campanha = limpo(de.get("utm_campaign"));
    if (!fonte || !campanha) { para.set("utm_source", sufixo); return `${SITE}?${para}`; }
    para.set("utm_source", fonte);
    const meio = limpo(de.get("utm_medium")); if (meio) para.set("utm_medium", meio);
    para.set("utm_campaign", campanha);
    const conteudo = limpo(de.get("utm_content"));
    para.set("utm_content", conteudo ? `${conteudo}-${sufixo}` : sufixo);
    return `${SITE}?${para}`;
  };
  /** De qual anúncio a visita veio, para quem atende no WhatsApp: o grupo (utm_content) ou a campanha; null sem campanha. */
  const refDoAnuncio = (busca) => { const de = new URLSearchParams(busca || ""); return limpo(de.get("utm_content")) || limpo(de.get("utm_campaign")); };
  /** O link do wa.me com a referência do anúncio no fim da mensagem pronta; sem referência, o link fica como está. */
  const zapComRef = (href, ref) => {
    if (!ref) return href;
    try { const u = new URL(href); const t = u.searchParams.get("text"); if (!t) return href; return `${u.origin}${u.pathname}?text=${encodeURIComponent(`${t} (ref: ${ref})`)}`; } catch { return href; }
  };
  if (typeof window !== "undefined") window.MEU_BOT_CELULAR = { ehCelular, linkParaMac, refDoAnuncio, zapComRef };
})();
