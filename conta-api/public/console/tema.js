// Tema do console, aplicado antes da primeira pintura: carregado no <head>, sem defer. O padrão é Claro, como o
// site; a pessoa pode escolher Escuro ou Sistema, e a escolha fica só neste navegador (localStorage).
(() => {
  const CH = "meu-bot.console.tema";
  const valido = (t) => (t === "escuro" || t === "sistema" ? t : "claro");
  const ler = () => { try { return valido(localStorage.getItem(CH)); } catch { return "claro"; } };
  const aplicar = (t) => { document.documentElement.dataset.tema = t; };
  aplicar(ler());
  window.MEU_BOT_TEMA = {
    atual: ler,
    definir(t) { const v = valido(t); try { if (v === "claro") localStorage.removeItem(CH); else localStorage.setItem(CH, v); } catch { /* sem armazenamento: vale só nesta página */ } aplicar(v); },
  };
})();
