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
  /** O alfabeto do código por visita: 32 símbolos, sem I, O, 0 e 1 (o mesmo de ALFABETO_LEAD, src/lead-core.ts). */
  const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  /** O código por visita a partir de 6 bytes aleatórios (cada um escolhe um símbolo); null sem os 6 bytes. */
  const codigoVisita = (bytes) => {
    if (!bytes || bytes.length < 6) return null;
    let c = ""; for (let i = 0; i < 6; i++) c += ALFABETO[bytes[i] & 31];
    return c;
  };
  /**
   * O link do wa.me com, no fim da mensagem pronta, a referência do anúncio e o código da visita, os que houver:
   * "(ref: empresario · cód: ABC234)". Sem nenhum dos dois, o link fica como está.
   */
  const zapComRef = (href, ref, codigo) => {
    const fim = [ref ? `ref: ${ref}` : null, codigo ? `cód: ${codigo}` : null].filter(Boolean).join(" · ");
    if (!fim) return href;
    try { const u = new URL(href); const t = u.searchParams.get("text"); if (!t) return href; return `${u.origin}${u.pathname}?text=${encodeURIComponent(`${t} (${fim})`)}`; } catch { return href; }
  };
  /** O corpo do POST /lead-ref: o código, o botão, a visita do Analytics, o clique do anúncio e a campanha (só valores na forma). */
  const corpoDoLead = (codigo, origem, busca, visita, clique) => {
    const de = new URLSearchParams(busca || "");
    return { codigo, origem: origem || "site", gaClientId: (visita && visita.clientId) || null, gaSessionId: (visita && visita.sessionId) || null, gclid: clique || null, utmSource: limpo(de.get("utm_source")), utmMedium: limpo(de.get("utm_medium")), utmCampaign: limpo(de.get("utm_campaign")), utmContent: limpo(de.get("utm_content")) };
  };
  if (typeof window !== "undefined") window.MEU_BOT_CELULAR = { ehCelular, linkParaMac, refDoAnuncio, zapComRef, codigoVisita, corpoDoLead };
})();
