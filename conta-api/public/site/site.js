// Site do meu-bot: a home (landing page) e a página de obrigado. Analytics pelo public/analytics.js (no-op sem GA_ID):
// page_view limpo, "baixar_mac" com a origem do clique e, na obrigado, "download_iniciado" (o único evento principal de
// download) antes de navegar; o link "use este link" é "download_repetido", que não conta como conversão.
(() => {
  const cfg = window.MEU_BOT_CONTA || {};
  const $ = (id) => document.getElementById(id);
  // Staging se apresenta: faixa no topo da home, selo ao lado da marca e o título, para ninguém confundir com produção.
  // Planos e respostas por canal: produção vende (R$ 97/mês com o chip da Coflow); staging é o ensaio, grátis para beta testers.
  for (const el of document.querySelectorAll("[data-canal]")) el.hidden = el.dataset.canal !== (cfg.canal === "staging" ? "staging" : "producao");
  if (cfg.canal === "staging") {
    const r = $("rascunho"); if (r) r.hidden = false;
    const m = document.querySelector(".marca"); if (m) { const s = document.createElement("span"); s.className = "selo-canal"; s.textContent = "staging"; m.append(s); }
    document.title += " · staging";
  }
  const ga = window.meuBotGa || { pagina() {}, evento() {} };
  ga.pagina();
  // Home: no celular ou no Windows o download vira "mandar o link para o meu Mac"; cada CTA leva data-ev e a origem.
  if (document.querySelector("[data-ev]")) {
    if (/Android|iPhone|iPad|iPod|Windows/i.test(navigator.userAgent)) {
      document.body.classList.add("mobile");
      const fixo = $("cta-fixo"); const wa = $("cta-cel-wa");
      if (fixo && wa) { fixo.href = wa.href; fixo.dataset.ev = "link_celular"; fixo.dataset.via = "whatsapp"; fixo.textContent = "Mandar o link para o meu Mac"; }
    }
    document.addEventListener("click", (e) => {
      const a = e.target instanceof Element ? e.target.closest("[data-ev]") : null;
      if (!a) return;
      if (a.dataset.ev === "link_celular") ga.evento("link_celular", { via: a.dataset.via || "whatsapp" });
      else if (a.dataset.ev === "plano_interesse") ga.evento("plano_interesse", { plano: a.dataset.plano || "chip-coflow" });
      else ga.evento("baixar_mac", { origem: a.dataset.origem || "home" });
    });
  }
  let versao = "";
  if ($("btn-denovo")) {
    const ver = /[?&]ver=1/.test(location.search);
    $("btn-denovo").addEventListener("click", () => ga.evento("download_repetido", { versao: versao || "desconhecida" }));
    // O download começa sozinho (?ver=1 só mostra a página): o evento sai antes de navegar.
    if (!ver) setTimeout(() => { ga.evento("download_iniciado", { versao: versao || "desconhecida" }); location.href = "/download/mac"; }, 900);
  }
  if (typeof cfg.console === "string") { for (const id of ["link-console", "link-conta"]) { const a = $(id); if (a) a.href = `${cfg.console}/account/overview`; } }
  const mb = (n) => (n > 0 ? `${(n / 1048576).toFixed(0)} MB` : "");
  const data = (iso) => { const t = Date.parse(iso || ""); return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" }); };
  const linhaVersao = (t) => { const v = $("versao"); if (v) v.textContent = t; };
  fetch("/download/mac.json", { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d || typeof d.versao !== "string") { linhaVersao("Versão mais nova em github.com/diegofornalha/meu-bot/releases"); return; }
      versao = d.versao;
      linhaVersao(["Versão " + d.versao, data(d.publicadoEm), mb(d.tamanho)].filter(Boolean).join(" · "));
      // Dados estruturados ganham a versão e a data da release (o Google executa o JS ao indexar).
      const ld = $("ld-app");
      if (ld) { try { const j = JSON.parse(ld.textContent); j.softwareVersion = d.versao; if (d.publicadoEm) j.datePublished = d.publicadoEm.slice(0, 10); if (d.tamanho > 0) j.fileSize = mb(d.tamanho); ld.textContent = JSON.stringify(j); } catch { /* fica como está */ } }
    })
    .catch(() => linhaVersao(""));
})();
