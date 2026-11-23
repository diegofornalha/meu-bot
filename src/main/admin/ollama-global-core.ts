/**
 * Modo grátis para todos (parte pura): UM Ollama na máquina, instalado pelo root (backend-colima/install-ollama-global.sh)
 * e usado por todas as contas, que deixam de baixar ~3,4 GB cada e de rodar um Ollama dentro do próprio teto de RAM.
 * Aqui fica o que o "Preparar máquina" lê; a marca que as contas leem está em agente/ollamaRemoto-core.ts.
 */
import { OLLAMA_GLOBAL_MARCA } from "../agente/ollamaRemoto-core";

export const OG_SERVICO = "meu-bot-ollama-global";

/**
 * Estado para o Preparar, numa linha `OG=<marca> <ativo> <modelo>`: a marca existe, o serviço está no ar e o Ollama
 * responde com o modelo da marca. A marca só é gravada no fim da instalação, com tudo pronto.
 */
export const OG_ESTADO_SH = `OGM=0; [ -r ${OLLAMA_GLOBAL_MARCA} ] && OGM=1
OGA=0; systemctl is-active --quiet ${OG_SERVICO} 2>/dev/null && OGA=1
OGT=0
if [ "$OGM" = 1 ]; then
  OGP=$(python3 -c 'import json,sys; print(int(json.load(open(sys.argv[1]))["porta"]))' ${OLLAMA_GLOBAL_MARCA} 2>/dev/null)
  OGN=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["modelo"])' ${OLLAMA_GLOBAL_MARCA} 2>/dev/null | tr -dc 'A-Za-z0-9.:_-')
  [ -n "$OGP" ] && [ -n "$OGN" ] && curl -fsS -m 4 "http://127.0.0.1:$OGP/api/tags" 2>/dev/null | grep -q "\"$OGN\"" && OGT=1
fi
echo "OG=$OGM $OGA $OGT"`;
