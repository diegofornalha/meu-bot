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
  // Quem chega de Windows (anúncio de Pesquisa não separa Mac de Windows) não baixa o app do Mac: vira contato no
  // WhatsApp, "avise-me quando sair para Windows" (evento lista_windows). Windows Phone conta como celular.
  // O código do clique do anúncio (gclid e afins) fica na aba para a lista de espera saber de qual anúncio veio o contato.
  try { const q = new URLSearchParams(location.search); const cl = q.get("gclid") || q.get("gbraid") || q.get("wbraid"); if (cl) sessionStorage.setItem("mb-clique", cl.slice(0, 200)); } catch { /* sem sessionStorage */ }
  const ua = navigator.userAgent;
  const celular = /Android|iPhone|iPad|iPod|Windows Phone/i.test(ua);
  const windows = !celular && /Windows/i.test(ua);
  // Home: no celular o download vira "mandar o link para o meu Mac"; cada CTA leva data-ev e a origem.
  if (document.querySelector("[data-ev]")) {
    const fixo = $("cta-fixo");
    if (celular) {
      document.body.classList.add("mobile");
      const wa = $("cta-cel-wa");
      if (fixo && wa) { fixo.href = wa.href; fixo.dataset.ev = "link_celular"; fixo.dataset.via = "whatsapp"; fixo.textContent = "Mandar o link para o meu Mac"; }
    } else if (windows) {
      document.body.classList.add("windows");
      const wa = $("cta-win-wa");
      if (fixo && wa) { fixo.href = wa.href; fixo.target = "_blank"; fixo.rel = "noopener"; fixo.dataset.ev = "lista_windows"; fixo.dataset.origem = "fixo"; fixo.textContent = "Avise-me quando sair para Windows"; }
    }
    document.addEventListener("click", (e) => {
      const a = e.target instanceof Element ? e.target.closest("[data-ev]") : null;
      if (!a) return;
      if (a.dataset.ev === "link_celular") ga.evento("link_celular", { via: a.dataset.via || "whatsapp" });
      else if (a.dataset.ev === "lista_windows") ga.evento("lista_windows", { origem: a.dataset.origem || "home", via: "whatsapp" });
      else if (a.dataset.ev === "plano_interesse") ga.evento("plano_interesse", { plano: a.dataset.plano || "chip-coflow" });
      else if (a.dataset.ev === "falar_whatsapp") ga.evento("falar_whatsapp", { origem: a.dataset.origem || "home" });
      else ga.evento("baixar_mac", { origem: a.dataset.origem || "home" });
    });
  }
  // Lista de espera: grava o e-mail ou WhatsApp no próprio site (POST /lista-espera) e diz o resultado na linha do campo.
  for (const f of document.querySelectorAll("form.lista-form")) {
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const campo = f.querySelector("input[name=contato]"); const botao = f.querySelector("button"); const aviso = f.querySelector(".lista-aviso");
      if (!campo || !botao || !aviso || campo.value.trim() === "") return;
      botao.disabled = true; aviso.className = "lista-aviso"; aviso.textContent = "Anotando…";
      const visita = typeof ga.visita === "function" ? ga.visita() : Promise.resolve({ clientId: null });
      let clique = null; try { clique = sessionStorage.getItem("mb-clique"); } catch { clique = null; }
      visita.then((v) => fetch("/lista-espera", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contato: campo.value, plataforma: f.dataset.lista || "windows", origem: f.dataset.origem || "site", gaClientId: v && v.clientId, gclid: clique }) }))
        .then((r) => r.json().catch(() => null).then((j) => ({ ok: r.ok, j })))
        .then(({ ok, j }) => {
          if (ok) { aviso.className = "lista-aviso ok"; aviso.textContent = "Anotado. Avisamos assim que sair para Windows."; campo.value = ""; ga.evento("lista_windows", { origem: f.dataset.origem || "site", via: "formulario" }); }
          else { aviso.className = "lista-aviso ruim"; aviso.textContent = j && typeof j.erro === "string" ? `Não anotou: ${j.erro}.` : "Não anotou; tente de novo."; }
        })
        .catch(() => { aviso.className = "lista-aviso ruim"; aviso.textContent = "Sem conexão; tente de novo."; })
        .finally(() => { botao.disabled = false; });
    });
  }
  let versao = "";
  if ($("btn-denovo")) {
    const ver = /[?&]ver=1/.test(location.search);
    $("btn-denovo").addEventListener("click", () => ga.evento("download_repetido", { versao: versao || "desconhecida" }));
    // No Windows não há o que baixar: a página vira o convite da lista de espera (o link do Mac continua lá embaixo).
    const blocoWin = $("obrigado-win"); const blocoMac = $("obrigado-mac");
    if (windows && blocoWin && blocoMac) { blocoWin.hidden = false; blocoMac.hidden = true; const passos = $("obrigado-passos"); if (passos) passos.hidden = true; ga.evento("windows_sem_download", {}); }
    // O download começa sozinho (?ver=1 só mostra a página): o evento sai antes de navegar.
    else if (!ver) setTimeout(() => { ga.evento("download_iniciado", { versao: versao || "desconhecida" }); location.href = "/download/mac"; }, 900);
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
  // /baixar-windows: a versão de teste mais nova que trouxe o instalador.
  const vw = $("versao-windows");
  if (vw) {
    fetch("/download/windows.json", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { vw.textContent = d && typeof d.versao === "string" ? ["Versão " + d.versao, data(d.publicadoEm), mb(d.tamanho)].filter(Boolean).join(" · ") : "O instalador do Windows ainda não saiu em nenhuma versão de teste."; })
      .catch(() => { vw.textContent = ""; });
  }
})();
