# meu-bot: versões fixadas dos motores do WhatsApp. FONTE ÚNICA para os scripts da máquina; o app espelha em
# src/main/maquina/motor-versoes.ts e o teste scripts/tests/motor-versoes.test.mjs recusa divergência. Só `CHAVE=valor`
# (é lido com `.` pelos instaladores e parseado pelo teste). Nunca "latest": na VM agente (1 nov) o plugin do WhatsApp
# do ClawHub resolvia 2026.10.9 num OpenClaw 2026.9.9 e recusava instalar ("requires plugin API >=2026.10.9").
OPENCLAW_VERSAO=2026.9.9
OPENCLAW_WA_PLUGIN_VERSAO=2026.9.9
HERMES_VERSAO=0.22.2
MOTOR_NODE=v20.20.2
