/**
 * Link Público Global (parte pura): os scripts que o admin roda como root na máquina. Cada usuário ganha um link
 * `https://<nome>.<domínio>/` servido pela pasta dele (`~/publico` → `/var/www/publico/<nome>`), por um nginx só em
 * 127.0.0.1 atrás de um Cloudflare Tunnel do root (a máquina não abre porta nenhuma; o TLS é da Cloudflare). O
 * domínio fica na conta Cloudflare do root (login uma vez, como o Claude Code Global); o agente de cada usuário dá
 * links com o comando `publicar`, ensinado por uma skill do Hermes e um bloco no CLAUDE.md. O nome do link a pessoa
 * troca sozinha (`link-publico-nome`, tutorial 12): a pasta é dela numa pasta com sticky bit, sem passar pelo root.
 */
import type { LpAgente, LpAviso, LpEstado, LpItem } from "../../shared/ipc";
import { NOME_USUARIO_RE } from "./usuarios-core";

export const LP_ETC = "/etc/meu-bot-link-publico";
export const LP_WWW = "/var/www/publico";
export const LP_PORTA = 8099;
export const LP_TUNEL = "meu-bot-publico";
export const LP_LOGIN_LOG = "/tmp/meu-bot-cf-login.log";
/** Maior arquivo que vale publicar: a Cloudflare não entrega mais que 100 MB por resposta pelo túnel. */
export const LP_MAX_BYTES = 100 * 1024 * 1024;
/** Domínio raiz dos links (ex.: agentesgrok.com): só letras minúsculas, números, hífen e pontos. */
export const DOMINIO_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** Nome do link (subdomínio): o que o nginx aceita e o `link-publico-nome` confere. */
export const NOME_LINK_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Nome de um item no ar (o que o `publicar` grava depois de limpar o nome): sem barra, sem ponto inicial, até 128. */
export const ITEM_LINK_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Pasta de passagem do upload do admin: o root cria em /tmp com um token gerado no Mac. */
export const STAGE_RE = /^\/tmp\/meu-bot-publicar-[a-f0-9]{12}$/;
/** O arquivo dentro da pasta de passagem: nome fixo, só a extensão vem do Mac (um .md continua .md, para virar página). */
export const ARQUIVO_STAGE_RE = /^arquivo(\.[A-Za-z0-9]{1,10})?$/;

const nomeOk = (nome: string): string => { if (!NOME_USUARIO_RE.test(nome)) throw new Error("nome de usuário inválido"); return nome; };
const itemOk = (item: string): string => { if (!ITEM_LINK_RE.test(item)) throw new Error("nome de item inválido: só letras, números, ponto, hífen e sublinhado, sem começar com ponto"); return item; };
const stageOk = (s: string): string => { if (!STAGE_RE.test(s)) throw new Error("pasta de passagem inválida"); return s; };

/** Nome no link a partir do nome do arquivo no Mac: sem acento, minúsculas, só [a-z0-9._-] (o `publicar` trocaria cada byte do acento por "-"); null se não sobrar nada. */
export function nomeNoLinkDe(nome: string): string | null {
  const s = nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-{2,}/g, "-").replace(/-+(?=\.)|(?<=\.)-+/g, "").replace(/^[-.]+|-+$/g, "").slice(0, 128);
  return ITEM_LINK_RE.test(s) ? s : null;
}
const AVISOS: readonly LpAviso[] = ["sem-hermes", "sem-workspace"];
const avisosDe = (s: string): LpAviso[] => [...new Set(s.trim().split(/\s+/).filter((a): a is LpAviso => (AVISOS as readonly string[]).includes(a)))];
/** Frase para a tela com o que o ligar pulou e o que fazer. */
export const textoAvisos = (a: LpAviso[]): string => a.length === 0 ? "" : `${a.map((x) => x === "sem-hermes" ? "a conta não tem Hermes (a skill não foi copiada)" : "a conta não tem agent-workspace (o CLAUDE.md não foi tocado)").join("; ")}: prepare a conta na aba Usuários e ligue o link de novo`;
const dominioOk = (d: string): string => { if (!DOMINIO_RE.test(d)) throw new Error("domínio inválido: use algo como agentesgrok.com"); return d; };

const SO_ROOT = `[ "$(id -u)" = 0 ] || { echo "NAOROOT"; exit 0; }`;

/** Comando `publicar` de todo usuário: copia para a pasta do link e imprime a URL. Lê o domínio de ${LP_ETC}/config.json. */
export const PUBLICAR_SH = `#!/bin/sh
# meu-bot: publica um arquivo (ou pasta) no link público deste usuário e imprime a URL.
# Uso: publicar <arquivo|pasta> [nome-no-link]   ·   publicar --lista   ·   publicar --remover <nome-no-link>
# Um .md vira página: <nome>/index.html (renderizado por ${LP_ETC}/md2html.py) + o .md original ao lado; a URL é https://<link>/<nome>/.
# Erros saem como "ERRO: …" no stderr (o meu-bot mostra a frase); o admin também chama este comando como o usuário (runuser).
set -u
DOM=$(python3 -c 'import json; print(json.load(open("${LP_ETC}/config.json"))["dominio"])' 2>/dev/null) || { echo "ERRO: o link público não está instalado nesta máquina (é o admin quem instala, no meu-bot-admin › Link Público Global)." >&2; exit 1; }
P="$HOME/publico"
ALVO=$(readlink -f "$P" 2>/dev/null || true)
case "$ALVO" in ${LP_WWW}/*) ;; *) echo "ERRO: o seu link público não está ligado: peça ao admin para ligar o Link Público Global para $USER." >&2; exit 1;; esac
[ -d "$ALVO" ] || { echo "ERRO: a pasta do seu link ($ALVO) não existe: peça ao admin para ligar de novo." >&2; exit 1; }
NOME=$(basename "$ALVO")
case "\${1:-}" in
  --lista) ls -1Ap "$ALVO" 2>/dev/null | sed "s|^|https://$NOME.$DOM/|"; exit 0 ;;
  --remover) [ -n "\${2:-}" ] || { echo "Uso: publicar --remover <nome-no-link>" >&2; exit 1; }; N=$(basename "$2"); case "$N" in ""|.|..|.*) echo "ERRO: nome inválido" >&2; exit 1;; esac; [ -e "$ALVO/$N" ] || { echo "ERRO: não está no ar: $N" >&2; exit 1; }; rm -rf "$ALVO/$N"; echo "fora do ar: https://$NOME.$DOM/$N"; exit 0 ;;
  ""|-h|--help) echo "Uso: publicar <arquivo|pasta> [nome-no-link]   ·   publicar --lista   ·   publicar --remover <nome>" >&2; echo "Seu link: https://$NOME.$DOM/" >&2; exit 1 ;;
esac
ARQ="$1"; [ -e "$ARQ" ] || { echo "ERRO: não existe: $ARQ" >&2; exit 1; }
DEST=$(basename "\${2:-$ARQ}"); DEST=$(printf '%s' "$DEST" | tr -c 'A-Za-z0-9._-' '-'); DEST=\${DEST#.}
[ -n "$DEST" ] || { echo "ERRO: nome inválido" >&2; exit 1; }
MD=0; case "$ARQ" in *.md|*.MD|*.markdown) [ -f "$ARQ" ] && MD=1 ;; esac
SEM_ESPACO="ERRO: não consegui copiar para o seu link (sem espaço na sua cota?)"
if [ -d "$ARQ" ]; then rm -rf "$ALVO/$DEST"; cp -r "$ARQ" "$ALVO/$DEST" || { rm -rf "$ALVO/$DEST"; echo "$SEM_ESPACO" >&2; exit 1; }; chmod -R u+rwX,go+rX "$ALVO/$DEST"; echo "https://$NOME.$DOM/$DEST/"
elif [ "$MD" = 1 ]; then
  DEST=\${DEST%.md}; DEST=\${DEST%.MD}; DEST=\${DEST%.markdown}; [ -n "$DEST" ] || { echo "ERRO: nome inválido" >&2; exit 1; }
  rm -rf "$ALVO/$DEST"; mkdir -p "$ALVO/$DEST"
  python3 ${LP_ETC}/md2html.py "$ARQ" > "$ALVO/$DEST/index.html" || { rm -rf "$ALVO/$DEST"; echo "ERRO: não consegui transformar o markdown em página." >&2; exit 1; }
  cp -f "$ARQ" "$ALVO/$DEST/$DEST.md" || { rm -rf "$ALVO/$DEST"; echo "$SEM_ESPACO" >&2; exit 1; }; chmod 755 "$ALVO/$DEST"; chmod 644 "$ALVO/$DEST/index.html" "$ALVO/$DEST/$DEST.md"
  echo "https://$NOME.$DOM/$DEST/"
else cp -f "$ARQ" "$ALVO/$DEST" || { echo "$SEM_ESPACO" >&2; exit 1; }; chmod 644 "$ALVO/$DEST"; echo "https://$NOME.$DOM/$DEST"; fi
`;

/**
 * Conversor markdown → página (vai para ${LP_ETC}/md2html.py; o `publicar` chama para todo .md). Usa o python3-markdown
 * do Debian (tabelas, código, ids nos títulos); sem o módulo, cai num <pre> para a página nunca faltar. Título = 1º "# ".
 */
export const MD2HTML_PY = `#!/usr/bin/env python3
# meu-bot: markdown -> página HTML completa (o comando publicar usa para .md). Uso: md2html.py arquivo.md > index.html
import html, os, re, sys
src = open(sys.argv[1], encoding="utf-8", errors="replace").read()
m = re.search(r"^#\\s+(.+?)\\s*#*\\s*$", src, re.M)
titulo = m.group(1) if m else re.sub(r"\\.(md|markdown)$", "", os.path.basename(sys.argv[1]), flags=re.I)
try:
    import markdown
    corpo = markdown.markdown(src, extensions=["extra", "sane_lists", "toc"], output_format="html5")
except ImportError:
    corpo = "<pre>" + html.escape(src) + "</pre>"
css = """
:root{color-scheme:light dark;--bg:#fff;--fg:#1b1b1b;--muted:#6b6b6b;--line:#e4e4e4;--code:#f3f3f3;--link:#0b57d0}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#e8e8e8;--muted:#9c9c9c;--line:#2d2d2d;--code:#1f1f1f;--link:#8ab4f8}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:720px;margin:0 auto;padding:32px 20px 64px}
h1,h2,h3,h4{line-height:1.25}h1{font-size:1.9em;margin:.2em 0 .6em}
h2{font-size:1.4em;margin:1.6em 0 .5em;padding-bottom:.2em;border-bottom:1px solid var(--line)}h3{font-size:1.15em;margin:1.3em 0 .4em}
p,ul,ol{margin:.6em 0}li{margin:.25em 0}a{color:var(--link)}img{max-width:100%}
code{background:var(--code);padding:.1em .35em;border-radius:4px;font-size:.92em}
pre{background:var(--code);padding:14px;border-radius:8px;overflow-x:auto}pre code{padding:0;background:none}
table{border-collapse:collapse;display:block;overflow-x:auto;max-width:100%}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left}th{background:var(--code)}
blockquote{margin:1em 0;padding:.2em 1em;border-left:4px solid var(--line);color:var(--muted)}
hr{border:0;border-top:1px solid var(--line);margin:2em 0}
"""
sys.stdout.write('<!doctype html>\\n<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
                 '<title>' + html.escape(titulo) + '</title><style>' + css + '</style></head><body><main>\\n' + corpo + '\\n</main></body></html>\\n')
`;

/** Comando `link-publico-nome` de todo usuário: troca o subdomínio dele (renomeia a pasta, que é dele, e refaz ~/publico). */
export const LINK_NOME_SH = `#!/bin/sh
# meu-bot: troca o nome do link público deste usuário (<nome>.<domínio>). Uso: link-publico-nome <novo-nome>   ·   link-publico-nome --ver
set -u
DOM=$(python3 -c 'import json; print(json.load(open("${LP_ETC}/config.json"))["dominio"])' 2>/dev/null) || { echo "ERRO: o link público não está instalado nesta máquina." >&2; exit 1; }
P="$HOME/publico"; ALVO=$(readlink -f "$P" 2>/dev/null || true)
case "$ALVO" in ${LP_WWW}/*) ;; *) echo "ERRO: o seu link público não está ligado (peça ao admin)." >&2; exit 1;; esac
ATUAL=$(basename "$ALVO")
[ "\${1:-}" = "--ver" ] && { echo "https://$ATUAL.$DOM/"; exit 0; }
NOVO=$(printf '%s' "\${1:-}" | tr 'A-Z' 'a-z')
printf '%s' "$NOVO" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' || { echo "ERRO: nome inválido: só letras minúsculas, números e hífen (2 a 63 caracteres, sem começar ou terminar com hífen)." >&2; exit 1; }
case "$NOVO" in www|admin|api|mail|ftp|smtp|imap|pop|ns1|ns2|root|meu|meu-bot|suporte|status|app|login|dash|cdn|static) echo "ERRO: esse nome é reservado." >&2; exit 1;; esac
if [ "$NOVO" != "$USER" ] && getent passwd "$NOVO" >/dev/null 2>&1; then echo "ERRO: esse nome é de outro usuário desta máquina." >&2; exit 1; fi
[ "$NOVO" = "$ATUAL" ] && { echo "https://$ATUAL.$DOM/"; exit 0; }
[ -e "${LP_WWW}/$NOVO" ] && { echo "ERRO: o nome $NOVO já está em uso." >&2; exit 1; }
mv "${LP_WWW}/$ATUAL" "${LP_WWW}/$NOVO" || { echo "ERRO: não consegui renomear a pasta do link." >&2; exit 1; }
ln -sfn "${LP_WWW}/$NOVO" "$P"
mkdir -p "$HOME/.local/share/meu-bot"; printf '{"url": "https://%s.%s/", "nome": "%s", "dominio": "%s"}\\n' "$NOVO" "$DOM" "$NOVO" "$DOM" > "$HOME/.local/share/meu-bot/link-publico.json"
echo "https://$NOVO.$DOM/"
`;

/** Skill do Hermes (vai para ~/.hermes/skills/meu-bot-link-publico/SKILL.md de quem tem o link ligado). */
export const skillLinkPublico = (dominio: string): string => `---
name: meu-bot-link-publico
description: Dar um link público (URL https) de um arquivo, página HTML ou pasta desta máquina com o comando \`publicar\`. Use quando pedirem "link", "URL", "me manda o link", "publica", "compartilha", "coloca no ar" ou um site/página para alguém ver.
version: 1.1.0
author: meu-bot
platforms: [linux]
metadata:
  hermes:
    tags: [meu-bot, link, publicar, site, url]
---
# Link público (meu-bot)

Cada usuário desta máquina tem um link público próprio, \`https://<nome>.${dominio}/\`, servido pela pasta \`~/publico\`.
Você CONSEGUE gerar link público: nunca diga que não tem como.

## Como dar o link de um arquivo
1. Rode \`publicar /caminho/do/arquivo\` (opcional, o nome que aparece no link: \`publicar fluxo-atendimento.md fluxo\`). O comando imprime a URL.
2. Responda com a URL que ele imprimiu, sem inventar outra.

Um \`.md\` vira uma página pronta, com título e formatação: \`publicar fluxo-atendimento.md\` abre em \`https://<nome>.${dominio}/fluxo-atendimento/\`
(o .md original fica ao lado, em \`fluxo-atendimento/fluxo-atendimento.md\`). Não precisa converter nada antes.

## Regras
- Tudo em \`~/publico\` fica visível para qualquer pessoa na internet, sem senha. Não publique dados pessoais, senhas ou arquivos de terceiros sem a pessoa pedir.
- Para uma página feita à mão, gere um \`.html\` e publique; \`publicar pasta/ nome\` publica uma pasta inteira, e \`index.html\` abre na raiz.
- \`publicar --lista\` mostra o que está no ar; \`publicar --remover <nome>\` tira do ar.
- \`link-publico-nome --ver\` mostra o link; \`link-publico-nome <novo-nome>\` troca o nome (só se a pessoa pedir).
- Se o comando disser que o link "não está ligado" ou "não está instalado", diga que o admin precisa ligar o Link Público Global no meu-bot-admin.
`;

/** Bloco do CLAUDE.md do workspace do agente da máquina (marcadores idempotentes, como o do wa-enviar). */
export const claudeMdLinkPublico = (dominio: string): string => `<!-- meu-bot:link-publico v1 inicio -->
## Link público (meu-bot)
Para dar um link público de um arquivo, página ou pasta: \`publicar <arquivo> [nome-no-link]\`, que imprime a URL (\`https://<nome>.${dominio}/...\`, a pasta \`~/publico\`).
Um \`.md\` vira página pronta (\`publicar fluxo.md\` → \`https://<nome>.${dominio}/fluxo/\`), sem converter antes. Responda com a URL impressa. Tudo ali é público na internet: não publique dados pessoais ou segredos sem a pessoa pedir.
\`publicar --lista\` mostra o que está no ar; \`publicar --remover <nome>\` tira; \`link-publico-nome <novo>\` troca o nome do link (só se a pessoa pedir).
<!-- meu-bot:link-publico v1 fim -->
`;

/** O site do nginx: `<nome>.<domínio>` → `${LP_WWW}/<nome>`, só em 127.0.0.1 (atrás do túnel), sem listar pastas nem seguir symlink de outro dono. `.md` sai como texto utf-8 (sem o tipo, o navegador baixava em vez de mostrar); redirect relativo (`/pasta/`), senão o nginx mandava `http://…:8099/`. */
export const nginxSite = (dominio: string): string => `# meu-bot: link público de cada usuário da máquina (<nome>.${dominio} → ${LP_WWW}/<nome>), atrás do Cloudflare Tunnel.
server {
    listen 127.0.0.1:${LP_PORTA};
    server_name "~^(?<sub>[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)\\.${dominio.replace(/\./g, "\\.")}$";
    root ${LP_WWW}/$sub;
    index index.html index.htm;
    include /etc/nginx/mime.types;
    types { text/markdown md markdown; }
    charset utf-8;
    charset_types text/html text/plain text/markdown text/css application/javascript application/json;
    absolute_redirect off;
    autoindex off;
    disable_symlinks if_not_owner from=${LP_WWW};
    client_max_body_size 1m;
    add_header X-Content-Type-Options nosniff;
    location ~ /\\. { return 404; }
    location / { try_files $uri $uri/ =404; }
}
server { listen 127.0.0.1:${LP_PORTA} default_server; server_name _; return 404; }
`;

/**
 * Estado para a tela, numa linha `ESTADO=<json>`: instalado (nginx + cloudflared + config), nginx no ar, login do root
 * na Cloudflare (cert.pem), túnel criado e serviço no ar, rota curinga no DNS, domínio, e os usuários com o link
 * ligado (nome do link, quantos arquivos no ar, até 50 itens do primeiro nível e o estado da skill/CLAUDE.md do agente dele, só leitura).
 */
export const LP_ESTADO_SH = `${SO_ROOT}
NGINX=0; command -v nginx >/dev/null 2>&1 && [ -f /etc/nginx/sites-enabled/meu-bot-publico ] && NGINX=1
NGATIVO=0; systemctl is-active --quiet nginx 2>/dev/null && NGATIVO=1
CF=0; command -v cloudflared >/dev/null 2>&1 && CF=1
LOGIN=0; [ -s /root/.cloudflared/cert.pem ] && LOGIN=1
TID=$(sed -n 's/^tunnel: *//p' /etc/cloudflared/config.yml 2>/dev/null | head -1)
SERV=0; systemctl is-active --quiet cloudflared 2>/dev/null && SERV=1
DOM=$(python3 -c 'import json; print(json.load(open("${LP_ETC}/config.json"))["dominio"])' 2>/dev/null)
ROTA=0; [ -n "$DOM" ] && getent hosts "meu-bot-sonda.$DOM" >/dev/null 2>&1 && ROTA=1
LOGINURL=$(grep -o 'https://dash.cloudflare.com/argotunnel[^ ]*' ${LP_LOGIN_LOG} 2>/dev/null | head -1)
pgrep -f '^cloudflared tunnel login' >/dev/null 2>&1 || LOGINURL=""
NGINX=$NGINX NGATIVO=$NGATIVO CF=$CF LOGIN=$LOGIN TID="$TID" SERV=$SERV DOM="$DOM" ROTA=$ROTA LOGINURL="$LOGINURL" python3 -c '
import json, os, pwd, re, stat
www = "${LP_WWW}"; etc = "${LP_ETC}"
ITEM = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
def itens_de(alvo):
    out = []
    for x in os.listdir(alvo):
        if x.startswith(".") or not ITEM.fullmatch(x): continue
        c = os.path.join(alvo, x)
        try: st = os.lstat(c)
        except OSError: continue
        if stat.S_ISDIR(st.st_mode): tipo = "pagina" if os.path.isfile(os.path.join(c, "index.html")) else "pasta"; b = None
        elif stat.S_ISREG(st.st_mode): tipo = "arquivo"; b = st.st_size
        else: continue
        out.append({"nome": x, "tipo": tipo, "bytes": b, "mtime": int(st.st_mtime)})
    out.sort(key=lambda i: -i["mtime"]); return out[:50]
def le(p, uid, teto=262144):
    try: fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError: return None
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != uid or st.st_size > teto: return None
        return os.read(fd, teto)
    except OSError: return None
    finally: os.close(fd)
def modelo(nome):
    try: return open(os.path.join(etc, nome), "rb").read()
    except OSError: return None
SKILL = modelo("SKILL.md"); BLOCO = (modelo("claude.md") or b"").rstrip(b"\\n")
def agente_de(p):
    h = p.pw_dir
    if not os.path.isdir(os.path.join(h, ".hermes")): skill = "sem-hermes"
    else:
        s = le(os.path.join(h, ".hermes", "skills", "meu-bot-link-publico", "SKILL.md"), p.pw_uid)
        skill = "faltando" if s is None else ("ok" if SKILL is not None and s == SKILL else "antiga")
    if not os.path.isdir(os.path.join(h, "agent-workspace")): cm = "sem-workspace"
    else:
        t = le(os.path.join(h, "agent-workspace", "CLAUDE.md"), p.pw_uid)
        if t is None or b"<!-- meu-bot:link-publico v1 inicio -->" not in t: cm = "faltando"
        else: cm = "ok" if BLOCO and BLOCO in t else "antigo"
    return {"skill": skill, "claudeMd": cm}
usuarios = []
for p in pwd.getpwall():
    if p.pw_uid < 1000 or p.pw_uid >= 60000 or p.pw_shell.endswith(("nologin", "false")): continue
    alvo = None
    try:
        a = os.readlink(os.path.join(p.pw_dir, "publico"))
        if a.startswith(www + "/") and os.path.isdir(a) and os.stat(a).st_uid == p.pw_uid: alvo = a
    except OSError: pass
    n = 0; itens = []; agente = None
    if alvo:
        try: n = len([x for x in os.listdir(alvo) if not x.startswith(".")]); itens = itens_de(alvo)
        except OSError: n = 0
        agente = agente_de(p)
    usuarios.append({"nome": p.pw_name, "ligado": alvo is not None, "link": os.path.basename(alvo) if alvo else None, "arquivos": n, "itens": itens, "agente": agente})
usuarios.sort(key=lambda x: x["nome"])
e = os.environ
print("ESTADO=" + json.dumps({
    "instalado": e["NGINX"] == "1" and e["CF"] == "1" and bool(e["DOM"]), "nginx": e["NGATIVO"] == "1",
    "login": e["LOGIN"] == "1", "loginUrl": e["LOGINURL"] or None, "tunel": e["TID"] or None, "servico": e["SERV"] == "1", "rota": e["ROTA"] == "1",
    "dominio": e["DOM"] or None, "usuarios": usuarios}))
'`;

/**
 * Instala (idempotente): nginx e cloudflared (pacote .deb do GitHub), a pasta dos links (root, 1733: cada usuário cria
 * a sua, ninguém lista as outras), o site do nginx, os modelos (skill e bloco do CLAUDE.md), o config.json com o
 * domínio, o conversor md2html.py (com o python3-markdown do Debian) e os comandos `publicar` e `link-publico-nome` em
 * /usr/local/bin. Saída `INSTALADO=ok` ou `ERRO=`.
 */
export function lpInstalarSh(dominio: string): string {
  const d = dominioOk(dominio);
  return `${SO_ROOT}
export DEBIAN_FRONTEND=noninteractive; LOG=/tmp/meu-bot-link-publico.log
command -v nginx >/dev/null 2>&1 || { apt-get -qq update >>$LOG 2>&1 || true; apt-get -y -qq install nginx >>$LOG 2>&1 || { echo "ERRO=não consegui instalar o nginx (log em $LOG)"; exit 0; }; }
if ! command -v cloudflared >/dev/null 2>&1; then
  a=$(dpkg --print-architecture); t=$(mktemp -d)
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$a.deb" -o "$t/cf.deb" && dpkg -i "$t/cf.deb" >>$LOG 2>&1 || { rm -rf "$t"; echo "ERRO=não consegui instalar o cloudflared (log em $LOG)"; exit 0; }
  rm -rf "$t"
fi
python3 -c 'import markdown' >/dev/null 2>&1 || { apt-get -qq update >>$LOG 2>&1 || true; apt-get -y -qq install python3-markdown >>$LOG 2>&1 || true; }
mkdir -p ${LP_WWW}; chown root:root ${LP_WWW}; chmod 1733 ${LP_WWW}
mkdir -p ${LP_ETC}; chmod 755 ${LP_ETC}
printf '{"dominio": "${d}", "porta": ${LP_PORTA}}\\n' > ${LP_ETC}/config.json
cat > ${LP_ETC}/SKILL.md <<'EOF_SKILL'
${skillLinkPublico(d)}EOF_SKILL
cat > ${LP_ETC}/claude.md <<'EOF_CLAUDE'
${claudeMdLinkPublico(d)}EOF_CLAUDE
cat > ${LP_ETC}/md2html.py <<'EOF_MD'
${MD2HTML_PY}EOF_MD
chmod 644 ${LP_ETC}/config.json ${LP_ETC}/SKILL.md ${LP_ETC}/claude.md ${LP_ETC}/md2html.py
cat > /etc/nginx/sites-available/meu-bot-publico <<'EOF_NGINX'
${nginxSite(d)}EOF_NGINX
ln -sfn /etc/nginx/sites-available/meu-bot-publico /etc/nginx/sites-enabled/meu-bot-publico
rm -f /etc/nginx/sites-enabled/default
nginx -t >>$LOG 2>&1 || { echo "ERRO=a configuração do nginx não passou (log em $LOG)"; exit 0; }
systemctl enable --now nginx >>$LOG 2>&1; systemctl reload nginx >>$LOG 2>&1 || systemctl restart nginx >>$LOG 2>&1
cat > /usr/local/bin/publicar <<'EOF_PUB'
${PUBLICAR_SH}EOF_PUB
cat > /usr/local/bin/link-publico-nome <<'EOF_NOME'
${LINK_NOME_SH}EOF_NOME
chmod 755 /usr/local/bin/publicar /usr/local/bin/link-publico-nome
systemctl is-active --quiet nginx || { echo "ERRO=o nginx não subiu (journalctl -u nginx)"; exit 0; }
echo "INSTALADO=ok"`;
}

/**
 * Login do root na Cloudflare: sobe `cloudflared tunnel login` solto (setsid), que espera a autorização e baixa o
 * cert.pem sozinho; imprime `URL=<link>` para a pessoa abrir no navegador. Saída `ERRO=` se o link não apareceu.
 */
export const LP_LOGIN_SH = `${SO_ROOT}
command -v cloudflared >/dev/null 2>&1 || { echo "ERRO=o cloudflared não está instalado: instale o Link Público Global antes"; exit 0; }
pkill -f '^cloudflared tunnel login' 2>/dev/null; sleep 1
rm -f /root/.cloudflared/cert.pem ${LP_LOGIN_LOG}
setsid nohup cloudflared tunnel login >${LP_LOGIN_LOG} 2>&1 </dev/null &
u=""; for i in $(seq 1 30); do u=$(grep -o 'https://dash.cloudflare.com/argotunnel[^ ]*' ${LP_LOGIN_LOG} 2>/dev/null | head -1); [ -n "$u" ] && break; sleep 1; done
[ -n "$u" ] && echo "URL=$u" || echo "ERRO=o cloudflared não mostrou o link de login (veja ${LP_LOGIN_LOG})"`;

/**
 * Com o cert.pem do root: cria o túnel (uma vez), grava /etc/cloudflared/config.yml (curinga `*.<domínio>` → nginx,
 * resto 404), aponta o DNS curinga para o túnel e instala/sobe o serviço. Saída `TUNEL=ok <id>` ou `ERRO=`.
 */
export function lpTunelSh(dominio: string): string {
  const d = dominioOk(dominio);
  return `${SO_ROOT}
[ -s /root/.cloudflared/cert.pem ] || { echo "ERRO=o root ainda não entrou na Cloudflare"; exit 0; }
LOG=/tmp/meu-bot-link-publico.log
ID=$(cloudflared tunnel list -o json 2>/dev/null | python3 -c 'import json, sys
try:
    for t in json.load(sys.stdin):
        if t.get("name") == "${LP_TUNEL}" and str(t.get("deleted_at", "0001")).startswith("0001"): print(t["id"]); break
except Exception: pass')
if [ -z "$ID" ]; then
  cloudflared tunnel create ${LP_TUNEL} >>$LOG 2>&1 || { echo "ERRO=não consegui criar o túnel (log em $LOG)"; exit 0; }
  ID=$(cloudflared tunnel list -o json 2>/dev/null | python3 -c 'import json, sys
for t in json.load(sys.stdin):
    if t.get("name") == "${LP_TUNEL}" and str(t.get("deleted_at", "0001")).startswith("0001"): print(t["id"]); break')
fi
[ -n "$ID" ] && [ -f "/root/.cloudflared/$ID.json" ] || { echo "ERRO=o túnel não tem credencial em /root/.cloudflared"; exit 0; }
mkdir -p /etc/cloudflared
cat > /etc/cloudflared/config.yml <<EOF_CF
# meu-bot: Link Público Global. *.${d} → nginx local (${LP_WWW}/<nome>); o resto, 404.
tunnel: $ID
credentials-file: /root/.cloudflared/$ID.json
ingress:
  - hostname: "*.${d}"
    service: http://127.0.0.1:${LP_PORTA}
  - service: http_status:404
EOF_CF
cloudflared tunnel route dns ${LP_TUNEL} "*.${d}" >>$LOG 2>&1 || grep -q "already exists" $LOG || { echo "ERRO=não consegui apontar *.${d} para o túnel (o domínio está nesta conta da Cloudflare? log em $LOG)"; exit 0; }
if [ ! -f /etc/systemd/system/cloudflared.service ]; then cloudflared --config /etc/cloudflared/config.yml service install >>$LOG 2>&1 || { echo "ERRO=não consegui instalar o serviço do cloudflared (log em $LOG)"; exit 0; }; fi
systemctl daemon-reload; systemctl enable --now cloudflared >>$LOG 2>&1; systemctl restart cloudflared >>$LOG 2>&1
sleep 3; systemctl is-active --quiet cloudflared || { echo "ERRO=o serviço do cloudflared não subiu (journalctl -u cloudflared)"; exit 0; }
echo "TUNEL=ok $ID"`;
}

/**
 * O que o usuário grava no próprio home ao ligar (e ao atualizar a instalação), rodado como ele via `runuser … sh -c`:
 * `$1` = pasta do link, o json vem no stdin. Imprime `sem-hermes` / `sem-workspace` quando pula a skill ou o CLAUDE.md
 * (a conta não tem ~/.hermes ou ~/agent-workspace), para o admin ver em vez de um "ok" que não gravou nada.
 */
export const LP_AGENTE_SH = `
  ln -sfn "$1" "$HOME/publico"
  mkdir -p "$HOME/.local/share/meu-bot" && cat > "$HOME/.local/share/meu-bot/link-publico.json"
  if [ -d "$HOME/.hermes" ]; then mkdir -p "$HOME/.hermes/skills/meu-bot-link-publico" && cp -f ${LP_ETC}/SKILL.md "$HOME/.hermes/skills/meu-bot-link-publico/SKILL.md"; else echo sem-hermes; fi
  if [ -d "$HOME/agent-workspace" ]; then python3 - "$HOME/agent-workspace/CLAUDE.md" <<"PY"
import re, sys
p = sys.argv[1]; bloco = open("${LP_ETC}/claude.md").read().rstrip("\\n")
try: t = open(p).read()
except FileNotFoundError: t = ""
t2 = re.sub(r"\\n?<!-- meu-bot:link-publico v1 inicio -->.*?<!-- meu-bot:link-publico v1 fim -->\\n?", "\\n", t, flags=re.S).rstrip("\\n")
t2 = (t2 + "\\n\\n" if t2 else "") + bloco + "\\n"
if t2 != t: open(p, "w").write(t2)
PY
  else echo sem-workspace; fi`;

/** `LINK=ok <nome> [sem-hermes] [sem-workspace]` → o nome do link e o que o ligar pulou; null se não ligou. */
export function lerLinkOk(out: string): { nome: string; avisos: LpAviso[] } | null {
  const m = /^LINK=ok (\S+)(.*)$/m.exec(out);
  if (m === null || !NOME_LINK_RE.test(m[1]!)) return null;
  return { nome: m[1]!, avisos: avisosDe(m[2]!) };
}

/**
 * Refaz, para todo usuário com o link ligado (~/publico apontando para a pasta dele em ${LP_WWW}), o que ele tem no
 * home (skill, bloco do CLAUDE.md, json), como ele. É o que "Atualizar a instalação" roda depois de regravar os
 * modelos: sem isto, quem já estava ligado ficava com a skill velha. Linhas `AGENTE=<usuário> <nome> [avisos]`, fim `AGENTES=ok <n>`.
 */
export function lpAtualizarAgentesSh(): string {
  return `${SO_ROOT}
DOM=$(python3 -c 'import json; print(json.load(open("${LP_ETC}/config.json"))["dominio"])' 2>/dev/null) || { echo "ERRO=o Link Público Global ainda não está instalado nesta máquina"; exit 0; }
N=0
for u in $(getent passwd | awk -F: '$3>=1000 && $3<60000 && $7 !~ /(nologin|false)$/ {print $1}'); do
  H=$(getent passwd "$u" | cut -d: -f6); [ -d "$H" ] || continue
  A=$(runuser -u "$u" -- readlink -f "$H/publico" 2>/dev/null || true)
  case "$A" in ${LP_WWW}/*) ;; *) continue;; esac
  [ "$(stat -c %U "$A" 2>/dev/null)" = "$u" ] || continue
  NOME=$(basename "$A"); J=$(printf '{"url": "https://%s.%s/", "nome": "%s", "dominio": "%s"}' "$NOME" "$DOM" "$NOME" "$DOM")
  AV=$(printf '%s\\n' "$J" | runuser -u "$u" -- sh -c '${LP_AGENTE_SH}' sh "$A" | tr '\\n' ' '); AV=\${AV% }
  echo "AGENTE=$u $NOME\${AV:+ $AV}"; N=$((N+1))
done
echo "AGENTES=ok $N"`;
}
/** Lê as linhas `AGENTE=` (usuário e nome do link validados). */
export function lerAgentes(out: string): { usuario: string; nome: string; avisos: LpAviso[] }[] {
  const r: { usuario: string; nome: string; avisos: LpAviso[] }[] = [];
  for (const m of out.matchAll(/^AGENTE=(\S+) (\S+)(.*)$/gm)) {
    if (!NOME_USUARIO_RE.test(m[1]!) || !NOME_LINK_RE.test(m[2]!)) continue;
    r.push({ usuario: m[1]!, nome: m[2]!, avisos: avisosDe(m[3]!) });
  }
  return r;
}

/** Pasta de passagem do upload do admin (700 do root até o scp acabar). Saída `STAGE=ok` ou `ERRO=`. */
export function lpStageSh(stage: string): string {
  return `${SO_ROOT}
mkdir -m 700 '${stageOk(stage)}' && echo "STAGE=ok" || echo "ERRO=não consegui criar a pasta de passagem em /tmp"`;
}

/**
 * Publica, COMO o usuário, um arquivo que o admin deixou na pasta de passagem: o `publicar` dele copia (a cópia nasce
 * dele, na cota dele), renderiza .md e limpa o nome, igual ao que o agente faz. O root só entrega o arquivo (chown do
 * grupo em /tmp, fora do home) e apaga a passagem no fim, deu certo ou não. Saída `PUBLICADO=<url>` ou `ERRO=`.
 */
export function lpPublicarSh(nome: string, stage: string, arquivo: string, nomeNoLink: string): string {
  const n = nomeOk(nome); const s = stageOk(stage); const d = itemOk(nomeNoLink);
  if (!ARQUIVO_STAGE_RE.test(arquivo)) throw new Error("nome de arquivo inválido");
  return `${SO_ROOT}
S='${s}'; F="$S/${arquivo}"
getent passwd ${n} >/dev/null 2>&1 || { rm -rf "$S"; echo "ERRO=usuário ${n} não existe"; exit 0; }
[ -f "$F" ] || { rm -rf "$S"; echo "ERRO=o arquivo não chegou na máquina"; exit 0; }
chown root:${n} "$S" "$F" && chmod 750 "$S" && chmod 640 "$F" || { rm -rf "$S"; echo "ERRO=não consegui entregar o arquivo para ${n}"; exit 0; }
OUT=$(runuser -u ${n} -- /usr/local/bin/publicar "$F" '${d}' 2>&1); RC=$?
rm -rf "$S"
if [ "$RC" = 0 ]; then echo "PUBLICADO=$(printf '%s\\n' "$OUT" | tail -1)"; else echo "ERRO=$(printf '%s\\n' "$OUT" | tail -1 | sed 's/^ERRO: //')"; fi`;
}

/** Tira um item do ar COMO o usuário (`publicar --remover`), nunca um rm do root. Saída `REMOVIDO=<url>` ou `ERRO=`. */
export function lpRemoverSh(nome: string, item: string): string {
  const n = nomeOk(nome); const i = itemOk(item);
  return `${SO_ROOT}
OUT=$(runuser -u ${n} -- /usr/local/bin/publicar --remover '${i}' 2>&1); RC=$?
if [ "$RC" = 0 ]; then echo "REMOVIDO=$(printf '%s\\n' "$OUT" | tail -1 | sed 's/^fora do ar: //')"; else echo "ERRO=$(printf '%s\\n' "$OUT" | tail -1 | sed 's/^ERRO: //')"; fi`;
}

/**
 * Liga o link do usuário: a pasta `${LP_WWW}/<nome>` (dona ele, 755; se ele já trocou o nome, fica o que ele escolheu;
 * se estava desligado, volta a pasta guardada), e, gravados por ele dentro do home (symlink plantado não leva o root a
 * lugar nenhum): `~/publico`, o json que a tela dele lê, a skill do Hermes e o bloco no CLAUDE.md. Saída `LINK=ok <nome>`.
 */
export function lpLigarSh(nome: string): string {
  const n = nomeOk(nome);
  return `${SO_ROOT}
DOM=$(python3 -c 'import json; print(json.load(open("${LP_ETC}/config.json"))["dominio"])' 2>/dev/null) || { echo "ERRO=o Link Público Global ainda não está instalado nesta máquina"; exit 0; }
H=$(getent passwd ${n} | cut -d: -f6); [ -n "$H" ] && [ -d "$H" ] || { echo "ERRO=usuário ${n} não existe"; exit 0; }
A=$(runuser -u ${n} -- readlink -f "$H/publico" 2>/dev/null || true)
case "$A" in ${LP_WWW}/*) [ "$(stat -c %U "$A" 2>/dev/null)" = "${n}" ] && NOME=$(basename "$A") || NOME=${n} ;; *) NOME=${n} ;; esac
D="${LP_WWW}/$NOME"
[ -d "${LP_WWW}/.desligado-${n}" ] && [ ! -e "$D" ] && mv "${LP_WWW}/.desligado-${n}" "$D"
if [ ! -e "$D" ]; then mkdir "$D"; chown ${n}:${n} "$D"; chmod 755 "$D"; fi
J=$(printf '{"url": "https://%s.%s/", "nome": "%s", "dominio": "%s"}' "$NOME" "$DOM" "$NOME" "$DOM")
AV=$(printf '%s\\n' "$J" | runuser -u ${n} -- sh -c '${LP_AGENTE_SH}' sh "$D" | tr '\\n' ' '); AV=\${AV% }
echo "LINK=ok $NOME\${AV:+ $AV}"`;
}

/** Desliga o link do usuário: a pasta sai do ar (guardada em `.desligado-<nome>`, para voltar igual), e some o que era dele no home. Saída `LINK=desligado`. */
export function lpDesligarSh(nome: string): string {
  const n = nomeOk(nome);
  return `${SO_ROOT}
H=$(getent passwd ${n} | cut -d: -f6); [ -n "$H" ] || { echo "ERRO=usuário ${n} não existe"; exit 0; }
A=$(runuser -u ${n} -- readlink -f "$H/publico" 2>/dev/null || true)
case "$A" in ${LP_WWW}/*) [ "$(stat -c %U "$A" 2>/dev/null)" = "${n}" ] && [ -d "$A" ] && { rm -rf "${LP_WWW}/.desligado-${n}"; mv "$A" "${LP_WWW}/.desligado-${n}"; } ;; esac
runuser -u ${n} -- sh -c '
  rm -f "$HOME/publico" "$HOME/.local/share/meu-bot/link-publico.json"; rm -rf "$HOME/.hermes/skills/meu-bot-link-publico"
  [ -f "$HOME/agent-workspace/CLAUDE.md" ] && python3 - "$HOME/agent-workspace/CLAUDE.md" <<"PY"
import re, sys
p = sys.argv[1]; t = open(p).read()
t2 = re.sub(r"\\n?<!-- meu-bot:link-publico v1 inicio -->.*?<!-- meu-bot:link-publico v1 fim -->\\n?", "\\n", t, flags=re.S)
if t2 != t: open(p, "w").write(t2)
PY
  true'
echo "LINK=desligado"`;
}

const TIPOS_ITEM = new Set<string>(["arquivo", "pasta", "pagina"]);
const SKILL_ESTADOS = new Set<string>(["ok", "antiga", "faltando", "sem-hermes"]);
const CLAUDE_ESTADOS = new Set<string>(["ok", "antigo", "faltando", "sem-workspace"]);
/** Itens do `ESTADO=`: só nomes seguros, tipo conhecido (senão arquivo), até 50. */
export function itensDe(v: unknown): LpItem[] {
  if (!Array.isArray(v)) return [];
  const r: LpItem[] = [];
  for (const i of v) {
    const x = (i ?? {}) as { nome?: unknown; tipo?: unknown; bytes?: unknown; mtime?: unknown };
    if (typeof x.nome !== "string" || !ITEM_LINK_RE.test(x.nome)) continue;
    r.push({ nome: x.nome, tipo: typeof x.tipo === "string" && TIPOS_ITEM.has(x.tipo) ? (x.tipo as LpItem["tipo"]) : "arquivo", bytes: typeof x.bytes === "number" && x.bytes >= 0 ? x.bytes : null, mtime: typeof x.mtime === "number" ? x.mtime : 0 });
    if (r.length === 50) break;
  }
  return r;
}
const agenteDe = (v: unknown, ligado: boolean): LpAgente | null => {
  if (!ligado) return null;
  const a = (v ?? {}) as { skill?: unknown; claudeMd?: unknown };
  return { skill: typeof a.skill === "string" && SKILL_ESTADOS.has(a.skill) ? (a.skill as LpAgente["skill"]) : "faltando", claudeMd: typeof a.claudeMd === "string" && CLAUDE_ESTADOS.has(a.claudeMd) ? (a.claudeMd as LpAgente["claudeMd"]) : "faltando" };
};

/** Lê a linha `ESTADO=` (null se o script não respondeu ou não é root). */
export function lerEstadoLp(out: string): LpEstado | null {
  const m = /^ESTADO=(.*)$/m.exec(out);
  if (m === null) return null;
  try {
    const v = JSON.parse(m[1]!) as Partial<LpEstado>;
    return {
      instalado: v.instalado === true, nginx: v.nginx === true, login: v.login === true,
      loginUrl: typeof v.loginUrl === "string" && /^https:\/\/dash\.cloudflare\.com\//.test(v.loginUrl) ? v.loginUrl : null,
      tunel: typeof v.tunel === "string" && /^[a-f0-9-]{36}$/.test(v.tunel) ? v.tunel : null, servico: v.servico === true, rota: v.rota === true,
      dominio: typeof v.dominio === "string" && DOMINIO_RE.test(v.dominio) ? v.dominio : null,
      usuarios: Array.isArray(v.usuarios) ? v.usuarios.filter((u) => NOME_USUARIO_RE.test(String(u?.nome))).map((u) => ({ nome: String(u.nome), ligado: u.ligado === true, link: typeof u.link === "string" && NOME_LINK_RE.test(u.link) ? u.link : null, arquivos: typeof u.arquivos === "number" ? u.arquivos : 0, itens: u.ligado === true ? itensDe(u.itens) : [], agente: agenteDe(u.agente, u.ligado === true) })) : [],
    };
  } catch { return null; }
}
