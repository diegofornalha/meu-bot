// Site do meu-bot: a home (landing page) e a página de obrigado. Analytics pelo public/analytics.js (no-op sem GA_ID):
// page_view limpo, "baixar_mac" com a origem do clique e, na obrigado, "download_iniciado" (o único evento principal de
// download) antes de navegar; o link "use este link" é "download_repetido", que não conta como conversão.
(() => {
  const cfg = window.MEU_BOT_CONTA || {};
  const $ = (id) => document.getElementById(id);
  // Staging se apresenta: faixa no topo da home, selo ao lado da marca e o título, para ninguém confundir com produção.
  // É só isso que muda: planos, preços, botões e respostas são os da produção (o HTML servido é o mesmo nos dois).
  if (cfg.canal === "staging") {
    if (location.pathname === "/") { const f = document.createElement("div"); f.className = "rasc"; f.textContent = "Staging: o mesmo site da produção, em conferência. O site de produção é agentesgrok.com."; document.body.prepend(f); }
    const m = document.querySelector(".marca"); if (m) { const s = document.createElement("span"); s.className = "selo-canal"; s.textContent = "staging"; m.append(s); }
    document.title += " · staging";
  }
  const ga = window.meuBotGa || { pagina() {}, evento() {} };
  ga.pagina();
  // Quem chega de Windows (anúncio de Pesquisa não separa Mac de Windows) não baixa o app do Mac: o botão principal
  // leva à /baixar-windows (versão de teste, cliente de máquina remota; evento pagina_windows) e a lista de espera
  // fica como segunda saída, para a versão que roda no próprio Windows (evento lista_windows). Windows Phone conta
  // como celular.
  // O código do clique do anúncio (gclid e afins) fica na aba para a lista de espera saber de qual anúncio veio o contato.
  try { const q = new URLSearchParams(location.search); const cl = q.get("gclid") || q.get("gbraid") || q.get("wbraid"); if (cl) sessionStorage.setItem("mb-clique", cl.slice(0, 200)); } catch { /* sem sessionStorage */ }
  const ua = navigator.userAgent;
  // celular.js (só a home carrega) tem a conta pura: quem é celular, o link para o Mac e a referência do anúncio.
  const cel = window.MEU_BOT_CELULAR || null;
  const celular = cel ? cel.ehCelular(ua, navigator.maxTouchPoints) : /Android|iPhone|iPad|iPod|Windows Phone/i.test(ua);
  const windows = !celular && /Windows/i.test(ua);
  // Home: no celular o download vira conversa no WhatsApp (e, em segundo plano, "mandar o link para o meu Mac"); cada
  // CTA leva data-ev e a origem.
  if (document.querySelector("[data-ev]")) {
    const fixo = $("cta-fixo");
    if (cel) {
      // O link que a pessoa manda para si leva a campanha da visita; a conversa leva de qual anúncio ela veio.
      const ref = cel.refDoAnuncio(location.search);
      for (const a of document.querySelectorAll('a[data-ev="link_celular"]')) {
        const link = cel.linkParaMac(location.search, a.closest(".win") ? "windows" : "celular", location.origin);
        a.href = a.dataset.via === "email" ? `mailto:?subject=${encodeURIComponent("meu-bot para Mac")}&body=${encodeURIComponent(`Baixar no Mac: ${link}`)}` : `https://wa.me/?text=${encodeURIComponent(`Baixar o meu-bot no Mac: ${link}`)}`;
      }
      // O código da visita vai na mensagem de toda conversa com a gente (uma por aba: recarregar não troca o código).
      let codigo = null;
      try { codigo = sessionStorage.getItem("mb-lead"); } catch { /* sem sessionStorage */ }
      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(codigo || "")) { try { codigo = cel.codigoVisita(crypto.getRandomValues(new Uint8Array(6))); sessionStorage.setItem("mb-lead", codigo); } catch { /* sem crypto ou sem sessionStorage: fica o que deu */ } }
      for (const a of document.querySelectorAll('a[data-ev="falar_whatsapp"], a[data-ev="lista_windows"]')) if (a.href.startsWith("https://wa.me/55")) a.href = cel.zapComRef(a.href, a.dataset.ev === "falar_whatsapp" ? ref : null, codigo);
      // O código só é gravado quando a pessoa clica (POST /lead-ref), com a visita do Analytics já lida.
      if (codigo) {
        let visita = null, mandou = false;
        if (typeof ga.visita === "function") void ga.visita().then((v) => { visita = v; });
        document.addEventListener("click", (e) => {
          const a = e.target instanceof Element ? e.target.closest('a[data-ev="falar_whatsapp"], a[data-ev="lista_windows"]') : null;
          if (!a || mandou || !a.href.startsWith("https://wa.me/55")) return;
          mandou = true;
          let clique = null; try { clique = sessionStorage.getItem("mb-clique"); } catch { /* sem sessionStorage */ }
          try { void fetch("/lead-ref", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify(cel.corpoDoLead(codigo, a.dataset.origem, location.search, visita, clique)) }).catch(() => { mandou = false; }); } catch { mandou = false; }
        });
      }
    }
    if (celular) {
      document.body.classList.add("mobile");
      const zap = $("cta-cel-zap");
      if (fixo && zap) { fixo.href = zap.href; fixo.target = "_blank"; fixo.rel = "noopener"; fixo.dataset.ev = "falar_whatsapp"; fixo.dataset.origem = "fixo"; fixo.textContent = "Falar no WhatsApp"; }
    } else if (windows) {
      document.body.classList.add("windows");
      const baixar = $("cta-win-baixar");
      if (fixo && baixar) { fixo.href = baixar.href; fixo.dataset.ev = "pagina_windows"; fixo.dataset.origem = "fixo"; fixo.textContent = "Baixar para Windows"; }
      // O botão do topo dizia "Baixar para Mac" a quem está no Windows.
      const topo = document.querySelector("a.nav-cta");
      if (topo && baixar) { topo.href = baixar.href; topo.dataset.ev = "pagina_windows"; topo.dataset.origem = "topo"; topo.textContent = "Baixar para Windows"; }
    }
    document.addEventListener("click", (e) => {
      const a = e.target instanceof Element ? e.target.closest("[data-ev]") : null;
      if (!a) return;
      if (a.dataset.ev === "link_celular") ga.evento("link_celular", { via: a.dataset.via || "whatsapp" });
      else if (a.dataset.ev === "lista_windows") ga.evento("lista_windows", { origem: a.dataset.origem || "home", via: "whatsapp" });
      else if (a.dataset.ev === "plano_interesse") ga.evento("plano_interesse", { plano: a.dataset.plano || "chip-coflow" });
      else if (a.dataset.ev === "falar_whatsapp") ga.evento("falar_whatsapp", { origem: a.dataset.origem || "home" });
      else if (a.dataset.ev === "baixar_windows") ga.evento("baixar_windows", { origem: a.dataset.origem || "baixar-windows" });
      else if (a.dataset.ev === "pagina_windows") ga.evento("pagina_windows", { origem: a.dataset.origem || "home" });
      else ga.evento("baixar_mac", { origem: a.dataset.origem || "home" });
    });
  }
  // Marketplace: a vitrine vista, o item visto e os cliques, com o mesmo item_id que o servidor manda na compra
  // ("<id>-mensal": compraGa4). Os dados do item vêm do HTML (data-item, data-nome, data-tipo), que o Worker monta.
  const mkItem = (e) => ({ item_id: `${e.dataset.item}-mensal`, item_name: e.dataset.nome || e.dataset.item, item_category: e.dataset.tipo || "" });
  const mkCartoes = [...document.querySelectorAll('a[data-mk="ver"][data-item]')], mkContratar = document.querySelector('a[data-mk="contratar"][data-item]');
  if (mkCartoes.length > 0) ga.evento("view_item_list", { item_list_id: "marketplace", items: mkCartoes.map(mkItem) });
  if (mkContratar) ga.evento("view_item", { currency: "BRL", value: Number(mkContratar.dataset.valor) || 0, items: [mkItem(mkContratar)] });
  if (mkCartoes.length > 0 || mkContratar) document.addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest("a[data-mk][data-item]") : null;
    if (!a) return;
    if (a.dataset.mk === "ver") ga.evento("select_item", { item_list_id: "marketplace", items: [mkItem(a)] });
    else ga.evento("marketplace_contratar", { items: [mkItem(a)] });
  });
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
    // No Windows o .dmg não serve: a página oferece a versão de teste (/baixar-windows) e a lista de espera (o link do
    // Mac continua lá embaixo).
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
      .then((d) => { const hw = $("hash-windows"); if (hw && d && typeof d.sha256 === "string") { hw.textContent = d.sha256; const bloco = $("bloco-hash-windows"); if (bloco) bloco.hidden = false; } vw.textContent = d && typeof d.versao === "string" ? ["Versão " + d.versao, data(d.publicadoEm), mb(d.tamanho)].filter(Boolean).join(" · ") : "O instalador do Windows ainda não saiu em nenhuma versão de teste."; })
      .catch(() => { vw.textContent = ""; });
  }
  // /marketplace: a busca esconde os cartões que não combinam. Cada cartão traz em data-busca o texto em que procurar
  // (nome, resumo, categoria e exemplo de pedido); todas as palavras digitadas têm de aparecer, sem diferenciar acento.
  const busca = $("mk-busca");
  if (busca) {
    const semAcento = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const cartoes = [...document.querySelectorAll(".mk-cartao[data-busca]")].map((c) => ({ c, alvo: semAcento(c.dataset.busca || "") }));
    const filtrar = () => {
      const palavras = semAcento(busca.value).split(/\s+/).filter(Boolean);
      let visiveis = 0;
      for (const { c, alvo } of cartoes) { const ok = palavras.every((p) => alvo.includes(p)); c.hidden = !ok; if (ok) visiveis++; }
      const vazio = $("mk-busca-vazio"); if (vazio) vazio.hidden = visiveis > 0;
    };
    busca.addEventListener("input", filtrar);
  }
})();
