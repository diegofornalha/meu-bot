// Carrossel da abertura da home: rola de lado por CSS (funciona sem este arquivo); aqui entram as setas, as bolinhas
// e o avanço sozinho a cada 5 s, que para quando a pessoa interage e não acontece com "reduzir movimento" ligado.
(() => {
  /** O quadro seguinte (ou anterior, com passo -1), dando a volta nas pontas. */
  const proximo = (atual, total, passo) => (total <= 0 ? 0 : (((atual + passo) % total) + total) % total);
  /** Qual quadro está à vista, pela rolagem e pela distância entre dois quadros. */
  const maisPerto = (rolagem, passoPx, total) => (passoPx <= 0 || total <= 0 ? 0 : Math.max(0, Math.min(total - 1, Math.round(rolagem / passoPx))));
  if (typeof window !== "undefined") window.MEU_BOT_CARROSSEL = { proximo, maisPerto };
  if (typeof document === "undefined") return;
  const caixa = document.getElementById("carrossel"), trilho = document.getElementById("carrossel-trilho");
  if (!caixa || !trilho) return;
  const quadros = [...trilho.children], bolas = [...document.querySelectorAll("#carrossel-bolinhas button")], n = quadros.length;
  if (n < 2) return;
  let atual = 0, parado = false, pausa = false;
  const passoPx = () => quadros[1].offsetLeft - quadros[0].offsetLeft;
  const marcar = (i) => { atual = i; bolas.forEach((b, k) => b.setAttribute("aria-current", k === i ? "true" : "false")); };
  const ir = (i, suave) => { trilho.scrollTo({ left: i * passoPx(), behavior: suave ? "smooth" : "auto" }); marcar(i); };
  const menos = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  trilho.addEventListener("scroll", () => marcar(maisPerto(trilho.scrollLeft, passoPx(), n)), { passive: true });
  for (const ev of ["pointerdown", "touchstart", "wheel", "keydown"]) trilho.addEventListener(ev, () => { parado = true; }, { passive: true });
  document.getElementById("carrossel-ant")?.addEventListener("click", () => { parado = true; ir(proximo(atual, n, -1), !menos); });
  document.getElementById("carrossel-prox")?.addEventListener("click", () => { parado = true; ir(proximo(atual, n, 1), !menos); });
  bolas.forEach((b, k) => b.addEventListener("click", () => { parado = true; ir(k, !menos); }));
  caixa.addEventListener("mouseenter", () => { pausa = true; });
  caixa.addEventListener("mouseleave", () => { pausa = false; });
  caixa.addEventListener("focusin", () => { pausa = true; });
  caixa.addEventListener("focusout", () => { pausa = false; });
  if (!menos) setInterval(() => { if (!parado && !pausa && !document.hidden) ir(proximo(atual, n, 1), true); }, 5000);
})();
