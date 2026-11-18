/**
 * A ferramenta que o agente usou é uma ação do Navegador do app? Há dois caminhos, com nomes diferentes:
 * nas máquinas por SSH, o servidor MCP "navegador" instalado na máquina (`mcp__navegador__abrir`); em Este Mac, o
 * controle externo do próprio app, cujo servidor leva o nome do app (`mcp__meu-bot-staging__nav_abrir`).
 * O tutorial 9 só olhava o primeiro: em Este Mac o agente navegava e o passo "Deixar o agente navegar" nunca concluía
 * (18 nov). Puro: testável com node --test.
 */
export const ehAcaoDoNavegador = (name: string): boolean => /^mcp__navegador__/.test(name) || /^mcp__meu-bot(-[a-z0-9-]+)?__nav_/.test(name);
