/**
 * Variante: admin. Aba "Link Público Global", abaixo do Claude Code Global: cada usuário desta máquina com um link
 * `https://<nome>.<domínio>/` servido pela pasta dele, atrás de um Cloudflare Tunnel do root (sem abrir porta). A gestão
 * é só daqui: instalar (nginx + cloudflared com o domínio), entrar na Cloudflare (o link abre no navegador deste Mac;
 * esta aba confirma sozinha), subir o túnel e ligar ou desligar o link por usuário. O nome do link cada pessoa troca
 * no meu-bot dela (tutorial 12). Fábrica como claude-global-page.ts; o main confere tudo como root.
 */
import type { LpAgente, LpAviso, LpEstado, LpItem, LpUsuario, MeuBotApi } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { carregando as espera } from "../lib/carregando.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";

export interface LinkPublicoPageDeps {
  who: string;
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  api: Pick<MeuBotApi, "adminLinkPublico" | "adminLinkPublicoInstalar" | "adminLinkPublicoEntrar" | "adminLinkPublicoTunel" | "adminLinkPublicoUsuario" | "adminLinkPublicoPublicar" | "adminLinkPublicoRemover" | "on">;
}

/** Domínio sugerido quando a máquina ainda não tem um (o da Karen). */
export const DOMINIO_SUGERIDO = "agentesgrok.com";
const DOMINIO_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** O passo em que a máquina está, para a aba contar a história em ordem. */
export function etapaLp(e: LpEstado): "instalar" | "entrar" | "tunel" | "pronto" {
  if (!e.instalado) return "instalar";
  if (!e.login) return "entrar";
  if (e.tunel === null || !e.servico) return "tunel";
  return "pronto";
}

/** URL de um item no ar: arquivo é `/nome`; pasta e página terminam em `/`. */
export const urlDoItem = (link: string, dominio: string, it: Pick<LpItem, "nome" | "tipo">): string => `https://${link}.${dominio}/${it.nome}${it.tipo === "arquivo" ? "" : "/"}`;
/** Coluna "Agente": o que o agente do usuário tem do link; `falta` = algo a fazer (e o título diz o quê). */
export function resumoAgente(a: LpAgente | null): { texto: string; falta: boolean; titulo: string } {
  if (a === null) return { texto: "—", falta: false, titulo: "" };
  const skill = a.skill === "ok" ? "skill ✓" : a.skill === "antiga" ? "skill antiga" : a.skill === "faltando" ? "sem a skill" : "sem Hermes";
  const cm = a.claudeMd === "ok" ? "CLAUDE.md ✓" : a.claudeMd === "antigo" ? "CLAUDE.md antigo" : a.claudeMd === "faltando" ? "sem o bloco no CLAUDE.md" : "sem agent-workspace";
  const falta = a.skill !== "ok" || a.claudeMd !== "ok";
  const dicas: string[] = [];
  if (a.skill === "antiga" || a.claudeMd === "antigo" || a.skill === "faltando" || a.claudeMd === "faltando") dicas.push("clique em \"Atualizar a instalação\" (refaz a skill e o CLAUDE.md de quem está ligado)");
  if (a.skill === "sem-hermes" || a.claudeMd === "sem-workspace") dicas.push("prepare a conta na aba Usuários e ligue o link de novo");
  return { texto: `${skill} · ${cm}`, falta, titulo: falta ? dicas.join("; ") : "O agente dele já dá links com `publicar` e sabe que .md vira página" };
}
/** Frase do que o ligar pulou (a mesma do main, para a tela). */
export const textoAvisosLp = (a: LpAviso[]): string => a.length === 0 ? "" : `${a.map((x) => x === "sem-hermes" ? "a conta não tem Hermes (a skill não foi copiada)" : "a conta não tem agent-workspace (o CLAUDE.md não foi tocado)").join("; ")}: prepare a conta na aba Usuários e ligue o link de novo`;
const tamanho = (b: number): string => b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
const icone = (tipo: LpItem["tipo"]): string => tipo === "pagina" ? "📝" : tipo === "pasta" ? "📁" : "📄";

export function mountLinkPublicoPage(deps: LinkPublicoPageDeps): { open: () => void } {
  let page: PageTab | null = null;
  let estado: LpEstado | null = null;
  let erro: string | null = null;
  let ocupado: string | null = null;
  let msg: { text: string; bad: boolean } | null = null;
  let dominio: string | null = null;
  /** Usuário com a lista "No ar" aberta; item armado para tirar do ar (dois cliques); última URL publicada (para copiar). */
  let aberto: string | null = null;
  let itemArmado: string | null = null;
  let ultimaUrl: string | null = null;
  /** Link de login aberto nesta sessão (a página mostra para copiar se o navegador não abriu). */
  let loginUrl: string | null = null;
  let vigia: ReturnType<typeof setInterval> | null = null;

  async function ler(): Promise<void> {
    erro = null; render();
    try { estado = await deps.api.adminLinkPublico(); } catch (e) { erro = ipcErrorText(e); }
    render();
  }
  /** `f` devolve o estado novo (mensagem `ok`), ou `{ estado, texto, bad }` quando a frase depende do resultado (texto vazio = sem mensagem). */
  async function rodar(chave: string, f: () => Promise<LpEstado | void | { estado: LpEstado; texto: string; bad?: boolean }>, ok: string): Promise<boolean> {
    ocupado = chave; msg = null; ultimaUrl = null; render();
    try {
      const r = await f();
      if (r && "estado" in r) { estado = r.estado; msg = r.texto === "" ? null : { text: r.texto, bad: r.bad === true }; }
      else { if (r) estado = r; msg = { text: ok, bad: false }; }
      return true;
    }
    catch (e) { msg = { text: `✗ ${ipcErrorText(e)}`, bad: true }; return false; }
    finally { ocupado = null; render(); }
  }
  /** Acompanha o login aberto no navegador: relê a cada 10 s até o cert chegar ou 15 min. */
  function vigiar(): void {
    if (vigia !== null) clearInterval(vigia);
    const ate = Date.now() + 15 * 60_000;
    vigia = setInterval(() => {
      if (Date.now() > ate) { if (vigia !== null) clearInterval(vigia); vigia = null; return; }
      void deps.api.adminLinkPublico().then((e) => { estado = e; if (e.login && vigia !== null) { clearInterval(vigia); vigia = null; loginUrl = null; msg = { text: "✓ Login na Cloudflare confirmado. Agora suba o túnel.", bad: false }; } render(); }).catch(() => { /* tenta de novo */ });
    }, 10_000);
  }
  // A aba Usuários liga o link da conta nova no fim do onboarding: a lista daqui relê sozinha.
  let releitura: ReturnType<typeof setTimeout> | null = null;
  deps.api.on("admin:usuarios-progresso", (p) => {
    if (page === null || !/link público|^pronto|^✗ parou|^usuário .* criado/.test(p.line)) return;
    if (releitura !== null) clearTimeout(releitura);
    releitura = setTimeout(() => { releitura = null; if (ocupado === null) void ler(); }, 1500);
  });
  const botao = (rotulo: string, chave: string, primario = false): HTMLButtonElement => {
    const b = el("button", `btn ${primario ? "btn-primary" : "btn-ghost"} btn-small`, ocupado === chave ? "…" : rotulo) as HTMLButtonElement;
    b.type = "button"; b.disabled = ocupado !== null; return b;
  };

  function render(): void {
    if (page === null) return;
    const panel = page.panel; panel.replaceChildren();
    const head = el("div", "guide-head"); const hb = el("div", "tut-body");
    hb.append(el("span", "tut-badge", "link público global"), el("h2", "", `Link Público Global · ${deps.who}`),
      el("p", "", "Cada usuário desta máquina ganha um link público próprio (https://<nome>.<domínio>/) servido pela pasta ~/publico dele, atrás de um túnel da Cloudflare do root: a máquina não abre porta nenhuma. O agente de cada um dá links com o comando `publicar`; o nome do link a pessoa troca no meu-bot dela (tutorial 12)."));
    head.append(hb); panel.append(head);
    if (estado === null) { panel.append(erro !== null ? el("p", "hint bad-hint", `✗ ${erro}`) : espera("Lendo o Link Público Global…")); return; }
    const e = estado; const etapa = etapaLp(e);

    // 1. Instalação (nginx + cloudflared) com o domínio.
    const inst = el("div", "admin-card"); inst.append(el("strong", "", "1. Domínio e instalação"));
    if (!e.instalado) {
      inst.append(el("p", "hint", "O domínio precisa estar numa conta da Cloudflare (DNS dela): os links serão <nome>.<domínio>. Instala o nginx (só em 127.0.0.1) e o cloudflared."));
      const row = el("div", "admin-actions");
      const i = el("input") as HTMLInputElement; i.type = "text"; i.placeholder = DOMINIO_SUGERIDO; i.value = dominio ?? DOMINIO_SUGERIDO; i.style.width = "220px"; i.disabled = ocupado !== null;
      i.addEventListener("input", () => { dominio = i.value; });
      const b = botao("Instalar o Link Público Global", "instalar", true);
      b.addEventListener("click", () => {
        const d = (dominio ?? DOMINIO_SUGERIDO).trim().toLowerCase();
        if (!DOMINIO_RE.test(d)) { msg = { text: "✗ Domínio inválido: use algo como agentesgrok.com.", bad: true }; render(); return; }
        void rodar("instalar", () => deps.api.adminLinkPublicoInstalar(d), `✓ Instalado para *.${d}. Agora entre na Cloudflare.`);
      });
      row.append(i, b); inst.append(row);
    } else {
      inst.append(el("p", "", `Links em https://<nome>.${e.dominio ?? "?"}/ · nginx ${e.nginx ? "no ar (127.0.0.1)" : "parado"}`));
      const b = botao("Atualizar a instalação", "instalar"); b.title = "Refaz nginx, cloudflared, comandos e modelos (idempotente) e atualiza a skill e o CLAUDE.md de quem já tem o link ligado";
      b.addEventListener("click", () => { if (e.dominio !== null) void rodar("instalar", () => deps.api.adminLinkPublicoInstalar(e.dominio!), "✓ Instalação atualizada: skill e CLAUDE.md refeitos para quem tem o link ligado."); });
      inst.append(b);
    }
    panel.append(inst);

    // 2. Login do root na Cloudflare.
    if (e.instalado) {
      const cf = el("div", "admin-card"); cf.append(el("strong", "", "2. Conta da Cloudflare do root"));
      if (!e.login) {
        cf.append(el("p", "hint", "O login abre no navegador deste Mac: entre na conta que tem o domínio, escolha a zona dele e autorize. A máquina baixa o certificado sozinha e esta aba confirma."));
        const b = botao(e.loginUrl !== null || loginUrl !== null ? "Abrir o login de novo" : "Entrar na Cloudflare", "entrar", true);
        b.addEventListener("click", () => { void rodar("entrar", async () => { loginUrl = (await deps.api.adminLinkPublicoEntrar()).url; }, "Login aberto no navegador. Esta aba confirma sozinha quando terminar.").then((ok) => { if (ok) vigiar(); }); });
        cf.append(b);
        const u = loginUrl ?? e.loginUrl;
        if (u !== null) {
          const row = el("div", "audio-row");
          const code = el("code", "conta-codigo", u); code.style.wordBreak = "break-all";
          const copy = el("button", "btn btn-ghost btn-small", "Copiar o link"); copy.type = "button";
          copy.addEventListener("click", () => { void navigator.clipboard.writeText(u).then(() => { copy.textContent = "Copiado"; window.setTimeout(() => { copy.textContent = "Copiar o link"; }, 1500); }); });
          row.append(code, copy); cf.append(el("p", "hint", "Se o navegador não abriu, copie o link:"), row);
        }
      } else cf.append(el("p", "", "✓ O root está logado na Cloudflare (certificado em /root/.cloudflared)."));
      panel.append(cf);
    }

    // 3. Túnel e rota curinga.
    if (e.instalado && e.login) {
      const tn = el("div", "admin-card"); tn.append(el("strong", "", "3. Túnel"));
      if (etapa === "tunel") {
        tn.append(el("p", "hint", `Cria o túnel "meu-bot-publico", aponta *.${e.dominio ?? "?"} para ele no DNS da Cloudflare e sobe o serviço (cloudflared) que religa sozinho.`));
        const b = botao("Subir o túnel", "tunel", true);
        b.addEventListener("click", () => { void rodar("tunel", () => deps.api.adminLinkPublicoTunel(), "✓ Túnel no ar. Os links dos usuários ligados já funcionam."); });
        tn.append(b);
      } else {
        tn.append(el("p", "", `✓ Túnel ${e.tunel ?? "?"} no ar · DNS *.${e.dominio ?? "?"} ${e.rota ? "apontado" : "ainda não resolve (propagando?)"}`));
        const b = botao("Conferir o túnel", "tunel"); b.title = "Regrava a configuração, a rota e reinicia o serviço";
        b.addEventListener("click", () => { void rodar("tunel", () => deps.api.adminLinkPublicoTunel(), "✓ Túnel conferido."); });
        tn.append(b);
      }
      panel.append(tn);
    }

    // 4. Usuários: link, estado do agente, o que está no ar (abre uma linha com os itens) e as ações, sempre como o usuário.
    if (e.instalado) {
      const us = el("div", "admin-card");
      const cab = el("div", "admin-actions"); cab.append(el("strong", "", "Usuários com link"));
      const atualizar = botao("Atualizar", "ler"); atualizar.addEventListener("click", () => { void ler(); });
      cab.append(atualizar); us.append(cab);
      if (etapa !== "pronto") us.append(el("p", "hint", "Dá para ligar já; os links só abrem na internet depois do túnel."));
      if (e.usuarios.length === 0) us.append(el("p", "hint", "Nenhum usuário de login além do root."));
      else {
        const tu = el("table", "usuarios-tabela");
        const hu = el("tr"); for (const h of ["Usuário", "Link", "Agente", "No ar", ""]) hu.append(el("th", "", h)); tu.append(hu);
        for (const u of e.usuarios) {
          const tr = el("tr");
          const link = u.ligado && u.link !== null ? `https://${u.link}.${e.dominio ?? "?"}/` : null;
          const tdLink = el("td", "");
          if (link !== null) { const a = el("a", "", link) as HTMLAnchorElement; a.href = link; a.target = "_blank"; a.rel = "noopener"; tdLink.append(a); } else tdLink.append(el("span", "hint", "desligado"));
          const ag = resumoAgente(u.agente);
          const tdAg = el("td", ""); const sAg = el("span", ag.falta ? "hint bad-hint" : "hint", ag.texto); sAg.title = ag.titulo; tdAg.append(sAg);
          const tdAr = el("td", "");
          if (!u.ligado) tdAr.append(el("span", "", "—"));
          else if (u.arquivos === 0) tdAr.append(el("span", "hint", "nada"));
          else {
            const ab = el("button", "btn btn-ghost btn-small", `${u.arquivos} ${u.arquivos === 1 ? "item" : "itens"} ${aberto === u.nome ? "▴" : "▾"}`) as HTMLButtonElement; ab.type = "button";
            ab.title = aberto === u.nome ? "Fechar a lista" : "Ver o que está no ar, abrir ou tirar do ar";
            ab.addEventListener("click", () => { aberto = aberto === u.nome ? null : u.nome; itemArmado = null; render(); });
            tdAr.append(ab);
          }
          tr.append(el("td", "", u.nome), tdLink, tdAg, tdAr);
          const td = el("td", "");
          if (u.ligado) {
            const pb = botao("Publicar arquivo…", `publicar:${u.nome}`);
            pb.title = "Escolhe um arquivo deste Mac e publica no link dele, como ele: um .md vira página; até 100 MB; um item com o mesmo nome é substituído";
            pb.addEventListener("click", () => {
              void rodar(`publicar:${u.nome}`, async () => {
                const r = await deps.api.adminLinkPublicoPublicar(u.nome);
                if (r.url === null) return { estado: r.estado, texto: "" };
                ultimaUrl = r.url; aberto = u.nome;
                return { estado: r.estado, texto: `✓ No ar no link de ${u.nome}:` };
              }, "");
            });
            td.append(pb, " ");
          }
          const b = botao(u.ligado ? "Desligar" : "Ligar", `usuario:${u.nome}`, !u.ligado);
          b.title = u.ligado ? "O link sai do ar (os arquivos ficam guardados); a skill e o comando somem para o agente dele" : "Cria a pasta ~/publico dele, a skill do Hermes e o bloco no CLAUDE.md; o agente dele passa a dar links";
          b.addEventListener("click", () => {
            void rodar(`usuario:${u.nome}`, async () => {
              const r = await deps.api.adminLinkPublicoUsuario(u.nome, !u.ligado);
              if (u.ligado) return { estado: r.estado, texto: `✓ Link de ${u.nome} desligado.` };
              return r.avisos.length === 0 ? { estado: r.estado, texto: `✓ Link de ${u.nome} ligado: o agente dele já dá links com \`publicar\`.` } : { estado: r.estado, texto: `✓ Link de ${u.nome} ligado, mas ${textoAvisosLp(r.avisos)}.`, bad: true };
            }, "");
          });
          td.append(b); tr.append(td); tu.append(tr);
          if (aberto === u.nome && u.ligado) tu.append(linhaItens(u, e.dominio));
        }
        const rolo = el("div", "usuarios-rolo"); rolo.append(tu); us.append(rolo);
      }
      panel.append(us);
    }
    if (msg !== null) {
      panel.append(el("p", `hint ${msg.bad ? "bad-hint" : "audio-ok"}`, msg.text));
      if (ultimaUrl !== null) {
        const u = ultimaUrl; const row = el("div", "audio-row");
        const code = el("code", "conta-codigo", u); code.style.wordBreak = "break-all";
        const copy = el("button", "btn btn-ghost btn-small", "Copiar o link"); copy.type = "button";
        copy.addEventListener("click", () => { void navigator.clipboard.writeText(u).then(() => { copy.textContent = "Copiado"; window.setTimeout(() => { copy.textContent = "Copiar o link"; }, 1500); }); });
        const abrir = el("a", "btn btn-ghost btn-small", "Abrir") as HTMLAnchorElement; abrir.href = u; abrir.target = "_blank"; abrir.rel = "noopener";
        row.append(code, copy, abrir); panel.append(row);
      }
    }
  }

  /** A linha aberta embaixo do usuário: os itens no ar (até 50), com abrir e tirar do ar em dois cliques. */
  function linhaItens(u: LpUsuario, dominio: string | null): HTMLElement {
    const tr = el("tr"); const td = el("td", "") as HTMLTableCellElement; td.colSpan = 5;
    if (u.itens.length === 0) td.append(el("p", "hint", "Nada com nome no padrão (só pelo terminal)."));
    else {
      const t = el("table", "auditoria-tabela");
      const cab = el("tr"); for (const h of ["Item", "Tamanho", "Quando", ""]) cab.append(el("th", "", h)); t.append(cab);
      for (const it of u.itens) {
        const url = urlDoItem(u.link ?? u.nome, dominio ?? "?", it);
        const r = el("tr");
        const a = el("a", "", `${icone(it.tipo)} ${it.nome}${it.tipo === "arquivo" ? "" : "/"}`) as HTMLAnchorElement; a.href = url; a.target = "_blank"; a.rel = "noopener"; a.title = url;
        const tdNome = el("td", ""); tdNome.append(a);
        const chave = `${u.nome}/${it.nome}`;
        const rb = el("button", "btn btn-ghost btn-small", ocupado === `remover:${chave}` ? "Tirando…" : itemArmado === chave ? "Confirmar? sai do ar" : "Tirar do ar") as HTMLButtonElement; rb.type = "button"; rb.disabled = ocupado !== null;
        rb.addEventListener("click", () => {
          if (itemArmado !== chave) { itemArmado = chave; render(); return; }
          itemArmado = null;
          void rodar(`remover:${chave}`, () => deps.api.adminLinkPublicoRemover(u.nome, it.nome), `✓ ${it.nome} saiu do ar no link de ${u.nome}.`);
        });
        const tdB = el("td", ""); tdB.append(rb);
        r.append(tdNome, el("td", "", it.bytes === null ? "—" : tamanho(it.bytes)), el("td", "", it.mtime > 0 ? new Date(it.mtime * 1000).toLocaleString("pt-BR") : "—"), tdB);
        t.append(r);
      }
      td.append(t);
    }
    const fora = u.arquivos - u.itens.length;
    if (fora > 0) td.append(el("p", "hint", `+${fora} ${fora === 1 ? "item" : "itens"} com nome fora do padrão (só pelo terminal).`));
    tr.append(td); return tr;
  }

  return {
    open: () => {
      if (page === null) {
        const panel = el("section", "acervo-panel usuarios-panel"); panel.hidden = true; deps.panelsEl.append(panel);
        page = deps.definePage("link-publico", `Link Público Global · ${deps.who}`, panel, () => { render(); void ler(); });
      }
      deps.openPage(page);
    },
  };
}
