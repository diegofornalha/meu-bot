"""meu-bot-navegador — plugin do Hermes Agent: o Navegador do dono para o agente do WhatsApp.

No Hermes quem roda o modelo é o backend do meu-bot na própria máquina (modelo "whatsapp"), e o pedido que chega lá não
diz quem escreveu. Este plugin é o único ponto que sabe: no hook `pre_llm_call` (uma vez por turno) ele confere o
remetente e, se for conversa direta do WhatsApp, o Navegador estiver ligado e o número estiver na lista que o dono
marcou no app (~/.local/share/meu-bot/navegador-whatsapp.json), grava um passe de uso único em
~/.local/share/meu-bot/navegador-passes/<nonce>.json e devolve `[meu-bot-nav:<nonce>]`, que o Hermes anexa à mensagem
daquele turno. O backend (navegador-whatsapp.js) tira o marcador, confere o passe e só então liga o Navegador no turno.

Falha fechada: qualquer erro, dúvida sobre quem escreveu, grupo, lista vazia ou estado desligado = nenhum passe, e o
turno segue normal, sem Navegador. Só a biblioteca padrão; este plugin nunca derruba o gateway.
"""
import json
import logging
import os
import re
import secrets
import time

VERSAO = "1.0.0"  # igual ao plugin.yaml (o teste confere)
NOME = "meu-bot-navegador"
log = logging.getLogger(NOME)

ESTADO = "navegador-whatsapp.json"
PASSES = "navegador-passes"
LIDS = "whatsapp-lid.json"
CARREGADO = "navegador-whatsapp.carregado"
PASSE_SEGUNDOS = 180
NUMERO_RE = re.compile(r"^\d{8,15}$")
SESSAO_RE = re.compile(r"^[\w:+.@=-]{1,160}$")
SESSAO_DM_RE = re.compile(r":whatsapp:dm:")


def _agora():
    """Segundos desde a época (os testes trocam esta função)."""
    return time.time()


def _home():
    return os.environ.get("HOME") or os.path.expanduser("~")


def _caminho(nome):
    return os.path.join(_home(), ".local", "share", "meu-bot", nome)


def _ler_json(caminho):
    try:
        with open(caminho, encoding="utf-8") as f:
            v = json.load(f)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _estado():
    """(ligado, números marcados). Sem arquivo ou ilegível = desligado."""
    j = _ler_json(_caminho(ESTADO))
    numeros = {n for n in (j.get("numeros") or []) if isinstance(n, str) and NUMERO_RE.match(n)} if isinstance(j.get("numeros"), list) else set()
    return j.get("on") is True, numeros


def _digitos(jid):
    """"5521…:8@s.whatsapp.net" → "5521…"; "1400…@lid" → "1400…"; None sem dígitos."""
    if not jid:
        return None
    s = re.sub(r"\D", "", str(jid).split("@", 1)[0].split(":", 1)[0])
    return s or None


def _sessao(nome):
    try:
        from gateway.session_context import get_session_env
        return str(get_session_env(nome, "") or "")
    except Exception:
        return ""


def _remetente(kwargs):
    """O número de quem escreveu, ou None se não der para ter certeza. Junta o que o Hermes diz (sender_id do hook,
    user_id e user_id_alt da sessão); um LID só vale pelo mapa que o app mantém (whatsapp-lid.json). Dois números
    diferentes para o mesmo turno = dúvida = None."""
    lids = {str(k): str(v) for k, v in _ler_json(_caminho(LIDS)).items() if NUMERO_RE.match(str(v))}
    numeros = set()
    for jid in (kwargs.get("sender_id"), _sessao("HERMES_SESSION_USER_ID"), _sessao("HERMES_SESSION_USER_ID_ALT")):
        d = _digitos(jid)
        if not d:
            continue
        if str(jid).endswith("@lid"):
            d = lids.get(d)
        if d and NUMERO_RE.match(d):
            numeros.add(d)
    return next(iter(numeros)) if len(numeros) == 1 else None


def _gravar_passe(numero, sessao):
    d = _caminho(PASSES)
    os.makedirs(d, mode=0o700, exist_ok=True)
    os.chmod(d, 0o700)
    nonce = secrets.token_hex(16)
    tmp = os.path.join(d, "." + nonce + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump({"numero": numero, "sessao": sessao, "exp": int(_agora()) + PASSE_SEGUNDOS}, f)
    os.replace(tmp, os.path.join(d, nonce + ".json"))
    return nonce


def pre_llm_call(**kwargs):
    """Uma vez por turno. Devolve o marcador do passe ou None (o normal)."""
    try:
        plataforma = str(kwargs.get("platform") or _sessao("HERMES_SESSION_PLATFORM") or "").lower()
        if plataforma != "whatsapp":
            return None
        ligado, numeros = _estado()
        if not ligado or not numeros:
            return None
        tipo = _sessao("HERMES_SESSION_CHAT_TYPE").lower()
        chave = _sessao("HERMES_SESSION_KEY")
        # Só conversa direta: o tipo da conversa tem de dizer "dm" e a chave da sessão, se veio, tem de ser de DM.
        if tipo != "dm" or (chave and not SESSAO_DM_RE.search(chave)):
            return None
        numero = _remetente(kwargs)
        if numero is None or numero not in numeros:
            return None
        sessao = chave if SESSAO_RE.match(chave or "") else "whatsapp:dm:" + numero
        return {"context": "[meu-bot-nav:" + _gravar_passe(numero, sessao) + "]"}
    except Exception:
        log.exception("%s: falhou ao emitir o passe; o turno segue sem o Navegador", NOME)
        return None


def register(ctx):
    """Entrada do Hermes. Sem o hook, ninguém ganha passe: o Navegador simplesmente não aparece."""
    try:
        ctx.register_hook("pre_llm_call", pre_llm_call)
    except Exception:
        log.exception("%s: não registrou o hook", NOME)
        return
    try:
        c = _caminho(CARREGADO)
        os.makedirs(os.path.dirname(c), exist_ok=True)
        with open(c + ".tmp", "w", encoding="utf-8") as f:
            json.dump({"versao": VERSAO, "pid": os.getpid(), "em": int(_agora())}, f)
        os.replace(c + ".tmp", c)
    except Exception:
        pass
