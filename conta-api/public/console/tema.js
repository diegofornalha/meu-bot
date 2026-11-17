// Tema do console (Sistema, Claro ou Escuro), aplicado antes da primeira pintura: carregado no <head>, sem defer.
// A escolha fica só neste navegador (localStorage); sem escolha, vale o tema do sistema (console.css).
(() => {
  const CH = "meu-bot.console.tema";
  const ler = () => { try { const t = localStorage.getItem(CH); return t === "claro" || t === "escuro" ? t : "sistema"; } catch { return "sistema"; } };
  const aplicar = (t) => { if (t === "sistema") document.documentElement.removeAttribute("data-tema"); else document.documentElement.dataset.tema = t; };
  aplicar(ler());
  window.MEU_BOT_TEMA = {
    atual: ler,
    definir(t) { const v = t === "claro" || t === "escuro" ? t : "sistema"; try { if (v === "sistema") localStorage.removeItem(CH); else localStorage.setItem(CH, v); } catch { /* sem armazenamento: vale só nesta página */ } aplicar(v); },
  };
})();
