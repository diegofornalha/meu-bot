/**
 * A sondagem da status line numa máquina por SSH. Puro (só monta o trecho de shell): quem roda é hostProbe.ts.
 */

/** Onde o macOS guarda as settings gerenciadas do Claude Code (valem para todos os usuários da máquina). */
export const MANAGED_SETTINGS = "/Library/Application Support/ClaudeCode/managed-settings.json";

/**
 * A status line efetiva da máquina grava o cache de limites? Imprime `statusline=1` (a nossa), `statusline=0` (nenhuma)
 * ou `statusline=outra` (há uma status line, mas não é a do meu-bot: aparece no terminal e não alimenta os limites; é o
 * caso da status line global de um Mac). É a mesma regra
 * de `localStatusLine` (hostProbe.ts): num Mac, as settings gerenciadas ganham do settings.json do usuário, então se
 * elas definem statusLine só o script que elas apontam conta. Sem isso, "este Mac" visto pelo admin (por SSH) aparecia
 * "sem status line" com a status line global instalada. `managed` só muda no teste.
 */
export const statuslineSh = (managed: string = MANAGED_SETTINGS): string =>
  `SL="$HOME/.claude/statusline.sh"; MG="${managed}"; if grep -q '"statusLine"' "$MG" 2>/dev/null; then SL=$(grep -o "/[^\\"']*statusline\\.sh" "$MG" 2>/dev/null | head -1); fi; if grep -q ratelimits.json "$SL" 2>/dev/null; then echo statusline=1; elif [ -s "$SL" ]; then echo statusline=outra; else echo statusline=0; fi`;
export const STATUSLINE_SH = statuslineSh();
