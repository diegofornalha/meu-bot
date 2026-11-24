/**
 * Versões fixadas dos motores do WhatsApp que o meu-bot instala nas máquinas (parte pura). Espelho de
 * backend-colima/motor-versoes.sh, a fonte única dos scripts; scripts/tests/motor-versoes.test.mjs recusa divergência
 * entre os dois, com o Hermes de todos (admin/usuarios-core.ts) e com o pedido ao agente no renderer. Regra: um motor nunca é instalado
 * como "latest" nem atualizado em segundo plano; a versão só muda num PR que altera os dois arquivos.
 */

/** OpenClaw (`npm install -g openclaw@<versão>`): a mesma das VMs em produção. */
export const OPENCLAW_VERSAO = "2026.9.9";
/** Plugin do WhatsApp do ClawHub (`clawhub:@openclaw/whatsapp@<versão>`): tem de casar com o runtime (plugin API). */
export const OPENCLAW_WA_PLUGIN_VERSAO = "2026.9.9";
/** Hermes (`hermes-agent@<versão>`): a do motor Hermes do WhatsApp e do Hermes de todos (/opt/hermes). */
export const HERMES_VERSAO = "0.22.2";
/** Node que os motores usam quando a máquina não tem um (o mesmo do backend, install.sh). */
export const MOTOR_NODE = "v20.20.2";
/** Node do OpenClaw de todos (/opt/openclaw/node): o openclaw@2026.9.9 exige Node ≥ 24.16, e o MOTOR_NODE é 20. */
export const OPENCLAW_NODE = "v24.22.2";
