/**
 * Plugin meu-bot-pausa do Hermes: instalação, remoção e leitura do que a máquina respondeu (parte pura; o IO por SSH
 * fica em hostProbe.ts/usuarios-admin.ts). O plugin em si mora em backend-colima/hermes-plugins/meu-bot-pausa/.
 *
 * CONTORNO #2 (Hermes): não há pausa por contato no WhatsApp (NousResearch/hermes-agent#146672).
 * O que fazemos: levamos o plugin para ~/.hermes/plugins/meu-bot-pausa de cada usuário e o ligamos em
 * `plugins.enabled` do config.yaml; ele descarta as mensagens de quem está pausado lendo a marca do app.
 * Sai quando: o status imprimir `pausanativa=1` (sonda HERMES_PAUSA_SH trocada pelo sinal da release que fechar a
 * issue): aí `hermesPausaPluginRemoverSh` tira o plugin e o app usa o nativo. Tabela: docs/guia/contornos.md.
 */
import { HERMES_PY_SH, HERMES_RESTART_SH, HERMES_YAML_PY } from "./whatsapp-hermes-core";

export const HERMES_PAUSA_PLUGIN = "meu-bot-pausa";
export const HERMES_PAUSA_DIR = `$HOME/.hermes/plugins/${HERMES_PAUSA_PLUGIN}`;
/** Os dois arquivos do plugin, lidos do bundle (backend-colima/hermes-plugins/meu-bot-pausa/). */
export interface PausaPluginFonte { init: string; yaml: string; versao: string }

/** `version: "1.0.0"` do plugin.yaml (com ou sem aspas); null sem a linha. */
export function versaoDoPluginYaml(yaml: string): string | null {
  const m = /^version:\s*["']?([\w.-]+)["']?\s*$/m.exec(yaml);
  return m === null ? null : m[1]!;
}

const FUSO_RE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;
/** Fuso da pessoa para os textos do plugin ("volto às 14:30"); inválido vira o padrão. */
export const fusoOk = (fuso: string): string => (FUSO_RE.test(fuso) && fuso.length <= 60 ? fuso : "America/Sao_Paulo");

/** O gateway desta conta está de pé? (serviço do systemd ou processo do usuário) */
const GATEWAY_VIVO_SH = `systemctl --user is-active hermes-gateway >/dev/null 2>&1 || pgrep -u "$(id -u)" -f "hermes.*gateway" >/dev/null 2>&1`;

/**
 * Instala ou atualiza o plugin, idempotente, como o próprio usuário. Imprime `plugin=instalado|atualizado|nada|falhou`,
 * `enabled=sim|ja|falhou` e `restart=…`; grava `.ok` (a versão) por último e só com tudo certo. Reinicia o gateway só
 * se algo mudou e ele está de pé (usuário novo sem gateway: o plugin sobe junto na primeira vez). Os arquivos vão em
 * base64 (o Python do plugin tem aspas e acentos à vontade).
 */
export function hermesPausaPluginSh(fonte: PausaPluginFonte, fuso: string): string {
  if (fonte.init.trim() === "" || fonte.yaml.trim() === "") throw new Error("plugin de pausa sem arquivos no bundle");
  if (versaoDoPluginYaml(fonte.yaml) !== fonte.versao || !/^[\w.-]+$/.test(fonte.versao)) throw new Error("versão do plugin de pausa não bate com o plugin.yaml");
  return hermesPluginSh(HERMES_PAUSA_PLUGIN, fonte, `printf '%s\\n' '${fusoOk(fuso)}' > "$HOME/.local/share/meu-bot/fuso"`);
}

/**
 * O instalador de um plugin do meu-bot no Hermes (o de pausa e o do Navegador usam o mesmo): grava os dois arquivos em
 * ~/.hermes/plugins/<nome>, liga em `plugins.enabled` (com backup do config.yaml), grava `.ok` por último e reinicia o
 * gateway só se algo mudou e ele está de pé. `antes` = linhas de shell do plugin, rodadas depois de criar as pastas.
 */
export function hermesPluginSh(nome: string, fonte: PausaPluginFonte, antes = ""): string {
  if (!/^meu-bot-[a-z-]+$/.test(nome)) throw new Error("nome de plugin inválido");
  if (fonte.init.trim() === "" || fonte.yaml.trim() === "") throw new Error(`plugin ${nome} sem arquivos no bundle`);
  if (versaoDoPluginYaml(fonte.yaml) !== fonte.versao || !/^[\w.-]+$/.test(fonte.versao)) throw new Error(`versão do plugin ${nome} não bate com o plugin.yaml`);
  const b64 = Buffer.from(JSON.stringify({ init: fonte.init, yaml: fonte.yaml }), "utf8").toString("base64");
  return `${HERMES_PY_SH}
command -v python3 >/dev/null 2>&1 || { echo "plugin=falhou: sem python3"; exit 3; }
D="$HOME/.hermes/plugins/${nome}"; mkdir -p "$D" "$HOME/.local/share/meu-bot"
${antes}
R=$(printf '%s' '${b64}' | base64 -d | python3 -c '
import json, os, sys
d = sys.argv[1]; novo = json.load(sys.stdin); mud = []
for nome, conteudo in (("__init__.py", novo["init"]), ("plugin.yaml", novo["yaml"])):
    p = os.path.join(d, nome)
    try: atual = open(p, encoding="utf-8").read()
    except FileNotFoundError: atual = None
    if atual == conteudo: continue
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f: f.write(conteudo)
    os.chmod(tmp, 0o644); os.replace(tmp, p); mud.append("novo" if atual is None else "mudou")
print("plugin=" + ("nada" if not mud else "instalado" if "novo" in mud else "atualizado"))
' "$D" 2>/dev/null || echo plugin=falhou); echo "$R"
E=$("$PY" -c '
${HERMES_YAML_PY}
pl = sub(doc, "plugins"); en = pl.get("enabled")
if not isinstance(en, list):
    en = []; pl["enabled"] = en
if "${nome}" in en: print("cfgset=ok"); print("enabled=ja")
else:
    en.append("${nome}"); salvar(); print("cfgset=ok"); print("enabled=sim")
' 2>/dev/null | grep -E "^(cfgset|enabled)=" || echo enabled=falhou); echo "$E"
case "$R $E" in *falhou*) echo "restart=nao"; exit 3;; esac
printf '%s' '${fonte.versao}' > "$D/.ok"
if [ "$R" != plugin=nada ] || printf '%s' "$E" | grep -q enabled=sim; then
  if ${GATEWAY_VIVO_SH}; then ${HERMES_RESTART_SH}
  else echo "restart=sem-servico"; fi
else echo "restart=nao-precisou"; fi`;
}

/** Tira o plugin (pasta, `plugins.enabled`, marcadores) e reinicia o gateway se estava de pé. Imprime `plugin=removido|nada`. */
export function hermesPausaPluginRemoverSh(): string {
  return `${HERMES_PY_SH}
D="${HERMES_PAUSA_DIR}"; HAVIA=0; [ -d "$D" ] && HAVIA=1
rm -rf "$D" "$HOME/.local/share/meu-bot/whatsapp-pausa.carregado"
"$PY" -c '
${HERMES_YAML_PY}
pl = doc.get("plugins") if isinstance(doc.get("plugins"), dict) else None
en = pl.get("enabled") if pl is not None else None
if isinstance(en, list) and "${HERMES_PAUSA_PLUGIN}" in en:
    en.remove("${HERMES_PAUSA_PLUGIN}"); salvar()
' >/dev/null 2>&1 || true
if [ "$HAVIA" = 1 ]; then echo "plugin=removido"; if ${GATEWAY_VIVO_SH}; then ${HERMES_RESTART_SH}; else echo "restart=sem-servico"; fi
else echo "plugin=nada"; echo "restart=nao-precisou"; fi`;
}

export interface PausaPluginSaida { plugin: "instalado" | "atualizado" | "nada" | "falhou" | "removido"; enabled: "sim" | "ja" | "falhou"; restart: string; ok: boolean }
/** O que o script imprimiu, saneado; `ok` = plugin no lugar e ligado (o reinício, se falhou, vai no texto). */
export function lerPausaPlugin(out: string): PausaPluginSaida {
  const pega = (k: string): string => new RegExp(`^${k}=(.*)$`, "m").exec(out)?.[1]?.trim() ?? "";
  const p = pega("plugin").split(":")[0]!.trim();
  const plugin = (["instalado", "atualizado", "nada", "falhou", "removido"] as const).find((v) => v === p) ?? "falhou";
  const e = pega("enabled");
  const enabled = e === "sim" || e === "falhou" ? e : "ja";
  const restart = pega("restart") || "?";
  return { plugin, enabled, restart, ok: plugin !== "falhou" && enabled !== "falhou" };
}
