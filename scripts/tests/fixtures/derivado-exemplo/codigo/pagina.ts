/**
 * Derivado de exemplo (testes do core): a página própria, na janela. Só `import type` do contrato; o painel, a aba e
 * a conversa com o processo principal chegam em `api`. Mostra um texto e o que o canal `eco` devolveu.
 */
import type { MontarExtensao } from "meu-bot/extensao-pagina";

export const montar: MontarExtensao = (api) => {
  const painel = document.createElement("section");
  painel.className = "acervo-panel";
  painel.hidden = true;
  api.panelsEl.append(painel);
  const texto = document.createElement("p");
  texto.textContent = "Página de exemplo de um app derivado.";
  const eco = document.createElement("p");
  painel.append(texto, eco);
  const page = api.definePage("extensao", "Exemplo", painel, () => {
    void api.invocar("eco", { zoom: api.zoomFactorNow() }).then(
      (r) => { eco.textContent = `eco: ${JSON.stringify(r)}`; },
      (e: unknown) => { eco.textContent = `o canal eco falhou: ${e instanceof Error ? e.message : String(e)}`; },
    );
  });
  return { open: () => { api.openPage(page); } };
};
