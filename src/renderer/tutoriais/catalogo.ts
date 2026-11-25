/** Página Tutoriais: o catálogo (cartões dos pendentes; pulados e concluídos em linhas que abrem). O guia ao vivo é tutoriais.ts. */
import { byId as $, el } from "../lib/dom.js";
import type { PageTab } from "../lib/pages-types.js";
import { ONBOARD_STEPS, TOUR_CARD } from "../lib/onboarding.js";
import { type TutArquivo, estadoCurto, guideView, listaVaziaTexto, separarArquivados, tutorialBadge, tutorialKnown } from "../lib/tutoriais.js";
import { ctx } from "../app/ctx.js";
import { restartTour } from "../inicio/inicio.js";
import { TUT_ICONS, TUT_VISIVEIS, loadGuideFlags, loadTutPulados, loadTutSeen, markTutSeen, openGuide, paintTutCount, reportProgress, resetTutorial, setTutPulado, tourDone, tutArchivedEl, tutCounts, tutList, tutNovoLabels, tutResetMsg, tutResetting, tutState, visibleNow } from "./tutoriais.js";

/** Acabou de concluir o tour: Tutoriais destaca o próximo (o primeiro pendente) até a pessoa começar algum. */
export let tutNext = false;
export function setTutNext(v: boolean): void { tutNext = v; }
/** Linhas de arquivados abertas (id do tutorial; "tour" para o tour). Em memória: a lista é refeita a cada mudança de
 *  estado e a linha que a pessoa abriu continua aberta; fechar o app esquece. */
const tutAbertos = new Set<string>();
const TUT_CHEV = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
interface Arquivado { n: number; estado: TutArquivo; row: HTMLElement }
/** Uma linha de arquivado: o botão largo (seta, título, estado curto) abre e fecha o detalhe; a ação ("Rever",
 *  "Retomar") é um botão irmão, fora dele, então clicar nela não alterna a linha. */
function linhaArquivada(a: { id: string; titulo: string; estado: string; acao: HTMLButtonElement; detalhe: HTMLElement[] }): HTMLElement {
  const row = el("div", "tut-row");
  const line = el("div", "tut-row-line");
  const toggle = el("button", "tut-row-toggle"); toggle.type = "button";
  const chev = el("span", "tut-chev"); chev.innerHTML = TUT_CHEV; chev.setAttribute("aria-hidden", "true");
  const text = el("span", "tut-row-text"); text.append(el("span", "tut-row-title", a.titulo), el("span", "tut-row-state", a.estado));
  toggle.append(chev, text);
  const detail = el("div", "tut-row-detail"); detail.id = `tut-detalhe-${a.id}`; detail.append(...a.detalhe);
  const pinta = (): void => { const aberto = tutAbertos.has(a.id); toggle.setAttribute("aria-expanded", aberto ? "true" : "false"); detail.hidden = !aberto; };
  toggle.setAttribute("aria-controls", detail.id);
  toggle.addEventListener("click", () => { if (tutAbertos.has(a.id)) tutAbertos.delete(a.id); else tutAbertos.add(a.id); pinta(); });
  pinta();
  line.append(toggle, a.acao);
  row.append(line, detail);
  return row;
}
/** A página Tutoriais (criada em `ligarCatalogo`, quando o `ctx` já vale). */
export let tutoriaisPage!: PageTab;
/** Liga a página Tutoriais (o catálogo de cartões); o renderer.ts chama uma vez, antes de `ligarTutoriais`. */
export function ligarCatalogo(): void {
  tutoriaisPage = ctx.definePage("tutoriais", "Tutoriais", $<HTMLElement>("tutoriais-panel"), () => {
    tutList.replaceChildren();
    let nextMarked = false;
    const mostraConcluidos = tutArchivedEl.checked;
    // Abrir a página é o "visto": o que está à vista agora deixa de ser novidade (a etiqueta "Novo" fica só nesta visita).
    const vis = visibleNow();
    const seen = loadTutSeen();
    const unseen = vis.filter((t) => !seen.has(t.id)).map((t) => t.id);
    if (unseen.length > 0) { markTutSeen(unseen); for (const id of unseen) tutNovoLabels.add(id); }
    const active: HTMLElement[] = [];
    // Arquivados (pulados e concluídos) viram linhas e saem pelo número (o tour, sem número, primeiro): a trilha ordena só os pendentes.
    const archived: Arquivado[] = [];
    const pulados = loadTutPulados();
    // Primeiro cartão: o tour (onboarding). Começar/Rever fecha Tutoriais e começa o guia sobre a janela. "Pular" grava
    // onboarding = "skipped" (o mesmo que o botão do próprio tour): vai para Pulados, de onde "Retomar" o inicia (30 out).
    {
      const done = tourDone();
      const pulado = !done && ctx.settings?.onboarding === "skipped";
      const start = el("button", done || pulado ? `btn btn-ghost btn-small tut-row-act${pulado ? " retomar" : ""}` : "btn tut-start", done ? "Rever" : pulado ? "Retomar" : "Começar"); start.type = "button";
      start.addEventListener("click", () => { tutNext = false; ctx.closePage(tutoriaisPage); void restartTour(); });
      if (done || pulado) {
        const estado: TutArquivo = done ? "concluido" : "pulado";
        archived.push({ n: 0, estado, row: linhaArquivada({ id: "tour", titulo: TOUR_CARD.title, estado: estadoCurto({ number: null, estado }), acao: start, detalhe: [el("p", "", TOUR_CARD.summary)] }) });
      } else {
        const card = el("article", "tut-card");
        const icon = el("span", "tut-icon"); icon.innerHTML = TUT_ICONS.tour;
        const body = el("div", "tut-body");
        const n = ONBOARD_STEPS.length;
        body.append(el("span", "tut-badge", `Comece por aqui · ${n} passos · ${TOUR_CARD.minutes} min`), el("h3", "", TOUR_CARD.title), el("p", "", TOUR_CARD.summary));
        const head = el("div", "tut-head"); head.append(icon, body);
        const skip = el("button", "btn btn-ghost btn-small tut-skip", "Pular"); skip.type = "button";
        skip.title = "Tira o tour da lista (fica em Pulados, logo abaixo; nada muda na máquina)";
        skip.addEventListener("click", () => {
          void window.meuBot.setSettings({ onboarding: "skipped" }).then((v) => { ctx.applySettings(v); reportProgress(); tutoriaisPage.render(); }).catch(() => undefined);
        });
        head.append(skip, start);
        card.append(head);
        active.push(card);
      }
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
      const arquivado = done || pulado;
      const start = el("button", soon || checking ? "btn btn-ghost tut-soon" : arquivado ? `btn btn-ghost btn-small tut-row-act${pulado ? " retomar" : ""}` : "btn tut-start", soon ? "Em breve" : checking ? "Aguarde…" : done ? "Rever" : pulado ? "Retomar" : started ? "Continuar" : "Começar"); start.type = "button";
      if (soon || checking) start.disabled = true;
      else start.addEventListener("click", () => { tutNext = false; if (pulado) { setTutPulado(t.id, false); paintTutCount(); } openGuide(t); });
      // Concluído ou pulado: uma linha; a descrição e o "Refazer do zero" ficam no detalhe, que abre com um clique.
      if (arquivado) {
        const estado: TutArquivo = done ? "concluido" : "pulado";
        const detalhe: HTMLElement[] = [el("p", "", t.summary)];
        // Concluído: "Refazer do zero" desfaz na máquina o que o tutorial fez e volta ao passo 1 (dois cliques).
        if (done && t.reset !== undefined && ctx.caps.install) {
          const foot = el("div", "tut-reset");
          const btn = el("button", "btn btn-ghost btn-small", tutResetting === t.id ? "Desfazendo…" : "Refazer do zero"); btn.type = "button"; btn.disabled = tutResetting !== null;
          btn.title = `Desfaz: ${t.reset.what}. Depois o tutorial volta ao passo 1.`;
          btn.addEventListener("click", () => ctx.armConfirm(btn, "Confirmar? desfaz na máquina", () => { void resetTutorial(t); }));
          foot.append(btn, el("span", "hint", t.reset.what));
          if (tutResetMsg?.id === t.id) foot.append(el("span", `hint ${tutResetMsg.bad ? "guide-pair-note" : "audio-ok"}`, tutResetMsg.text));
          detalhe.push(foot);
        }
        archived.push({ n: t.number, estado, row: linhaArquivada({ id: t.id, titulo: t.title, estado: estadoCurto({ number: t.number, estado, feitos: started ? view.done.filter(Boolean).length : 0, passos: t.steps.length }), acao: start, detalhe }) });
        continue;
      }
      const card = el("article", `tut-card${soon ? " soon" : ""}${next ? " next" : ""}${checking ? " checking" : ""}`);
      const icon = el("span", "tut-icon"); icon.innerHTML = TUT_ICONS[t.icon ?? "target"];
      const body = el("div", "tut-body");
      // "NOVO · SEU PRÓXIMO PASSO · TUTORIAL 3 · 2 DE 4 · 3 MIN": número sempre; progresso quando começou.
      const badge = checking ? `Tutorial ${t.number} · verificando a máquina…`
        : [novo ? "Novo" : null, next ? "Seu próximo passo" : null, `Tutorial ${t.number}`, started ? `${view.done.filter(Boolean).length} de ${t.steps.length} · ${t.minutes} min` : tutorialBadge(t, false)].filter((x): x is string => x !== null).join(" · ");
      body.append(el("span", "tut-badge", badge), el("h3", "", t.title), el("p", "", t.summary));
      const head = el("div", "tut-head"); head.append(icon, body);
      // "Pular": o pendente sai da lista e da contagem (vai para Pulados, de onde "Retomar" o traz de volta).
      if (!soon && !checking) {
        const skip = el("button", "btn btn-ghost btn-small tut-skip", "Pular"); skip.type = "button";
        skip.title = "Tira este tutorial da lista (fica em Pulados, logo abaixo; nada muda na máquina)";
        skip.addEventListener("click", () => { setTutPulado(t.id, true); paintTutCount(); tutoriaisPage.render(); });
        head.append(skip);
      }
      head.append(start);
      card.append(head);
      active.push(card);
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
    const { pulados: linhasPuladas, concluidos: linhasFeitas } = separarArquivados(archived);
    // Nada pendente não é "nenhum tutorial": os pulados estão logo abaixo (pulado não é feito) e a frase aponta para eles.
    if (active.length === 0) tutList.append(el("div", "acervo-empty", listaVaziaTexto({ pulados: linhasPuladas.length, concluidos: linhasFeitas.length, mostraConcluidos })));
    // Só os dois primeiros à vista: concluir ou pular um traz o próximo, para a lista não pesar.
    tutList.append(...active.slice(0, TUT_VISIVEIS));
    if (active.length > TUT_VISIVEIS) tutList.append(el("div", "acervo-empty", `Mais ${active.length - TUT_VISIVEIS} aparecem conforme você conclui estes.`));
    // Pulado é pendência adiada: o grupo aparece sempre que houver. Concluídos obedecem ao interruptor "concluídos".
    const grupo = (titulo: string, linhas: Arquivado[]): void => {
      const rows = el("div", "tut-rows"); rows.append(...linhas.map((x) => x.row));
      tutList.append(el("div", "tut-group", titulo), rows);
    };
    if (linhasPuladas.length > 0) grupo("Pulados", linhasPuladas);
    if (mostraConcluidos && linhasFeitas.length > 0) grupo("Concluídos", linhasFeitas);
  });
}
