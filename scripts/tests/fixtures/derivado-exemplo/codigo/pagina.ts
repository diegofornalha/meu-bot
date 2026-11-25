/**
 * Derivado de exemplo (testes do core): a página própria, na janela. Só `import type` do contrato; o painel, a aba e
 * a conversa com o processo principal chegam em `api`, fora o que é da própria pasta `codigo/` (./comum.js). Mostra um
 * texto e o que o canal `eco` devolveu.
 */
import type { MontarExtensao } from "meu-bot/extensao-pagina";
// Na janela o import relativo termina em .js: o arquivo é carregado como módulo ES, e o navegador não adivinha a extensão.
import { CANAL_ECO, textoDoEco } from "./comum.js";

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
    void api.invocar(CANAL_ECO, { zoom: api.zoomFactorNow() }).then(
      (r) => { eco.textContent = textoDoEco(r); },
      (e: unknown) => { eco.textContent = `o canal eco falhou: ${e instanceof Error ? e.message : String(e)}`; },
    );
  });
  return { open: () => { api.openPage(page); } };
};
