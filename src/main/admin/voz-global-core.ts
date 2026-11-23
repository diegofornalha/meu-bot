/**
 * Voz para todos (parte pura): UM Kokoro na máquina, instalado pelo root (backend-colima/install-voz-global.sh) em
 * /opt/meu-bot-voz e usado por todas as contas, que deixam de baixar ~600 MB cada (ambiente Python, modelo e vozes).
 * Aqui fica o que o "Preparar máquina" lê; quem liga a conta a ele é o install-voz.sh dela.
 */
export const VOZ_GLOBAL_DIR = "/opt/meu-bot-voz";
export const VOZ_GLOBAL_MARCA = `${VOZ_GLOBAL_DIR}/global.json`;

/**
 * Estado para o Preparar, numa linha `VG=<marca> <completo>`: a marca existe (só é gravada no fim da instalação) e o
 * ambiente, o modelo e as vozes continuam lá e legíveis.
 */
export const VG_ESTADO_SH = `VGM=0; [ -r ${VOZ_GLOBAL_MARCA} ] && VGM=1
VGC=0; [ -x ${VOZ_GLOBAL_DIR}/venv/bin/python ] && [ -r ${VOZ_GLOBAL_DIR}/kokoro-v1.0.onnx ] && [ -r ${VOZ_GLOBAL_DIR}/voices-v1.0.bin ] && VGC=1
echo "VG=$VGM $VGC"`;
