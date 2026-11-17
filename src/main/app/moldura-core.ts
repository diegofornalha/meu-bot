/**
 * Moldura das janelas do app, por plataforma (caps().semaforoNaBarra). No macOS a barra de título some e os semáforos
 * ficam por cima da barra do app (`hiddenInset`, que só existe lá). Fora dele a janela usa a moldura do sistema, que já
 * traz minimizar, maximizar, fechar e o arrasto; o menu do app fica recolhido (Alt mostra), para não gastar uma linha.
 */
export function molduraDaJanela(semaforoNaBarra: boolean): { titleBarStyle: "hiddenInset" } | { autoHideMenuBar: true } {
  return semaforoNaBarra ? { titleBarStyle: "hiddenInset" } : { autoHideMenuBar: true };
}
