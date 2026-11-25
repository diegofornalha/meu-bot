/** Página Tutoriais: o catálogo de cartões (tour, trilha, arquivados, "Pular", "Refazer do zero"). O guia ao vivo é tutoriais.ts. */
import { byId as $, el } from "../lib/dom.js";
import type { PageTab } from "../lib/pages-types.js";
import { ONBOARD_STEPS, TOUR_CARD } from "../lib/onboarding.js";
import { guideView, tutorialBadge, tutorialKnown } from "../lib/tutoriais.js";
import { ctx } from "../app/ctx.js";
import { restartTour } from "../inicio/inicio.js";
import { TUT_ICONS, TUT_VISIVEIS, loadGuideFlags, loadTutPulados, loadTutSeen, markTutSeen, openGuide, paintTutCount, reportProgress, resetTutorial, setTutPulado, tourDone, tutArchivedEl, tutCounts, tutList, tutNovoLabels, tutResetMsg, tutResetting, tutState, visibleNow } from "./tutoriais.js";

/** Acabou de concluir o tour: Tutoriais destaca o próximo (o primeiro pendente) até a pessoa começar algum. */
export let tutNext = false;
export function setTutNext(v: boolean): void { tutNext = v; }
/** A página Tutoriais (criada em `ligarCatalogo`, quando o `ctx` já vale). */
export let tutoriaisPage!: PageTab;
/** Liga a página Tutoriais (o catálogo de cartões); o renderer.ts chama uma vez, antes de `ligarTutoriais`. */
export function ligarCatalogo(): void {
  tutoriaisPage = ctx.definePage("tutoriais", "Tutoriais", $<HTMLElement>("tutoriais-panel"), () => {
    tutList.replaceChildren();
    let nextMarked = false;
    const showArchived = tutArchivedEl.checked;
    // Abrir a página é o "visto": o que está à vista agora deixa de ser novidade (a etiqueta "Novo" fica só nesta visita).
    const vis = visibleNow();
    const seen = loadTutSeen();
    const unseen = vis.filter((t) => !seen.has(t.id)).map((t) => t.id);
    if (unseen.length > 0) { markTutSeen(unseen); for (const id of unseen) tutNovoLabels.add(id); }
    const active: HTMLElement[] = [];
    // Arquivados saem pelo número (o tour, sem número, primeiro): a trilha ordena só os pendentes.
    const archived: { n: number; card: HTMLElement }[] = [];
    const pulados = loadTutPulados();
    // Primeiro cartão: o tour (onboarding). Começar/Rever fecha Tutoriais e começa o guia sobre a janela. "Pular" grava
    // onboarding = "skipped" (o mesmo que o botão do próprio tour): vai para Arquivados, de onde "Começar" o inicia (30 out).
    {
      const done = tourDone();
      const pulado = !done && ctx.settings?.onboarding === "skipped";
      const card = el("article", `tut-card${done ? " finished archived" : ""}${pulado ? " archived" : ""}`);
      const icon = el("span", "tut-icon"); icon.innerHTML = TUT_ICONS.tour;
      const body = el("div", "tut-body");
      const n = ONBOARD_STEPS.length;
      body.append(el("span", "tut-badge", done ? "Concluído" : pulado ? "Pulado" : `Comece por aqui · ${n} passos · ${TOUR_CARD.minutes} min`), el("h3", "", TOUR_CARD.title), el("p", "", TOUR_CARD.summary));
      const start = el("button", "btn tut-start", done ? "Rever" : "Começar"); start.type = "button";
      start.addEventListener("click", () => { tutNext = false; ctx.closePage(tutoriaisPage); void restartTour(); });
      const head = el("div", "tut-head"); head.append(icon, body);
      if (!done && !pulado) {
        const skip = el("button", "btn btn-ghost btn-small tut-skip", "Pular"); skip.type = "button";
        skip.title = "Tira o tour da lista (fica em Arquivados; nada muda na máquina)";
        skip.addEventListener("click", () => {
          void window.meuBot.setSettings({ onboarding: "skipped" }).then((v) => { ctx.applySettings(v); reportProgress(); tutoriaisPage.render(); }).catch(() => undefined);
        });
        head.append(skip);
      }
      head.append(start);
      card.append(head);
      if (done || pulado) archived.push({ n: 0, card }); else active.push(card);
    }
    for (const t of vis) {
      const view = guideView(t, ctx.waStatus, loadGuideFlags(t), ctx.guideCtx());
      const state = tutState(t);
      const known = tutorialKnown(t, ctx.guideCtx());
      const started = known && view.done.some(Boolean);
      const soon = t.comingSoon === true;
      const done = !soon && state === "done";
      // Fontes ainda a caminho e sem lembrança: o cartão espera, quieto, em vez de nascer "pendente" e mudar depois.
      const checking = !soon && state === "unknown";
      const pulado = !soon && !done && !checking && pulados.has(t.id);
      const next = tutNext && !nextMarked && !soon && !done && !checking && !pulado && tourDone();
      if (next) nextMarked = true;
      const novo = !done && !checking && !pulado && tutNovoLabels.has(t.id);
      const card = el("article", `tut-card${done ? " finished archived" : ""}${pulado ? " archived" : ""}${soon ? " soon" : ""}${next ? " next" : ""}${checking ? " checking" : ""}`);
      const icon = el("span", "tut-icon"); icon.innerHTML = TUT_ICONS[t.icon ?? "target"];
      const body = el("div", "tut-body");
      // "NOVO · SEU PRÓXIMO PASSO · TUTORIAL 3 · 2 DE 4 · 3 MIN": número sempre; progresso quando começou.
      const badge = done ? `Tutorial ${t.number} · Concluído`
        : pulado ? `Tutorial ${t.number} · Pulado${started ? ` · ${view.done.filter(Boolean).length} de ${t.steps.length}` : ""}`
        : checking ? `Tutorial ${t.number} · verificando a máquina…`
        : [novo ? "Novo" : null, next ? "Seu próximo passo" : null, `Tutorial ${t.number}`, started ? `${view.done.filter(Boolean).length} de ${t.steps.length} · ${t.minutes} min` : tutorialBadge(t, false)].filter((x): x is string => x !== null).join(" · ");
      body.append(el("span", "tut-badge", badge), el("h3", "", t.title), el("p", "", t.summary));
      const start = el("button", soon || checking ? "btn btn-ghost tut-soon" : "btn tut-start", soon ? "Em breve" : checking ? "Aguarde…" : done ? "Rever" : pulado ? "Retomar" : started ? "Continuar" : "Começar"); start.type = "button";
      if (soon || checking) start.disabled = true;
      else start.addEventListener("click", () => { tutNext = false; if (pulado) { setTutPulado(t.id, false); paintTutCount(); } openGuide(t); });
      const head = el("div", "tut-head"); head.append(icon, body);
      // "Pular": o pendente sai da lista e da contagem (vai para Arquivados, de onde "Retomar" o traz de volta).
      if (!soon && !checking && !done && !pulado) {
        const skip = el("button", "btn btn-ghost btn-small tut-skip", "Pular"); skip.type = "button";
        skip.title = "Tira este tutorial da lista (fica em Arquivados; nada muda na máquina)";
        skip.addEventListener("click", () => { setTutPulado(t.id, true); paintTutCount(); tutoriaisPage.render(); });
        head.append(skip);
      }
      head.append(start);
      card.append(head);
      // Concluído: "Refazer do zero" desfaz na máquina o que o tutorial fez e volta ao passo 1 (dois cliques).
      if (done && t.reset !== undefined && ctx.caps.install) {
        const foot = el("div", "tut-reset");
        const btn = el("button", "btn btn-ghost btn-small", tutResetting === t.id ? "Desfazendo…" : "Refazer do zero"); btn.type = "button"; btn.disabled = tutResetting !== null;
        btn.title = `Desfaz: ${t.reset.what}. Depois o tutorial volta ao passo 1.`;
        btn.addEventListener("click", () => ctx.armConfirm(btn, "Confirmar? desfaz na máquina", () => { void resetTutorial(t); }));
        foot.append(btn, el("span", "hint", t.reset.what));
        if (tutResetMsg?.id === t.id) foot.append(el("span", `hint ${tutResetMsg.bad ? "guide-pair-note" : "audio-ok"}`, tutResetMsg.text));
        card.append(foot);
      }
      if (done || pulado) archived.push({ n: t.number, card }); else active.push(card);
    }
    // Resumo: "Você fez 2 de 6 · próximo: 3 · Status line · 1 novo · 2 em breve" (o tour conta; "em breve" não).
    const c = tutCounts();
    $<HTMLElement>("tutoriais-summary").textContent = [
      c.todo === 0 && c.pulados === 0 ? `Você fez ${c.total} de ${c.total}: tudo feito` : `Você fez ${c.archived - c.pulados} de ${c.total}`,
      ...(c.next !== null ? [`próximo: ${c.next.number} · ${c.next.short}`] : []),
      ...(c.novos > 0 ? [`${c.novos} ${c.novos === 1 ? "novo" : "novos"}`] : []),
      ...(c.soon > 0 ? [`${c.soon} em breve`] : []),
      ...(c.pulados > 0 ? [`${c.pulados} ${c.pulados === 1 ? "pulado" : "pulados"}`] : []),
      ...(c.checking > 0 ? [`verificando ${c.checking} na máquina…`] : []),
    ].join(" · ");
    paintTutCount();
    // Nada pendente não é "nenhum tutorial": com arquivados, diz o que há neles (pulado não é feito) e onde estão.
    if (active.length === 0) {
      const ondeVer = showArchived ? "" : " Ligue \"arquivados\" para ver.";
      const vazio = archived.length === 0 ? "Nenhum tutorial ainda."
        : c.pulados > 0 ? `Nada pendente: ${c.pulados} ${c.pulados === 1 ? "pulado está" : "pulados estão"} nos arquivados.${ondeVer}`
        : showArchived ? "Tudo feito por aqui." : "Tudo feito por aqui. Ligue \"arquivados\" para rever um tutorial.";
      tutList.append(el("div", "acervo-empty", vazio));
    }
    // Só os dois primeiros à vista: concluir ou pular um traz o próximo, para a lista não pesar.
    tutList.append(...active.slice(0, TUT_VISIVEIS));
    if (active.length > TUT_VISIVEIS) tutList.append(el("div", "acervo-empty", `Mais ${active.length - TUT_VISIVEIS} aparecem conforme você conclui estes.`));
    if (showArchived && archived.length > 0) { tutList.append(el("div", "tut-group", "Arquivados"), ...archived.sort((a, b) => a.n - b.n).map((x) => x.card)); }
  });
}
