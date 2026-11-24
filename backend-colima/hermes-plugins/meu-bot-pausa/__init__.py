"""meu-bot-pausa — plugin do Hermes Agent (CONTORNO #2, docs/guia/contornos.md).

CONTORNO #2 (Hermes): não há pausa por contato no WhatsApp (NousResearch/hermes-agent#146672). Pausar hoje é tirar o
número de WHATSAPP_ALLOWED_USERS e reiniciar o gateway: não vale em "todo mundo", o agente nem vê as mensagens do
pausado, não há prazo e não dá para pedir pelo WhatsApp.
O que fazemos: no hook `pre_gateway_dispatch` (antes da autorização) descartamos a mensagem de quem está pausado na
marca do app (~/.local/share/meu-bot/whatsapp-lista.json, chave `paused`), guardamos o que chegou em
whatsapp-pausados.jsonl e, na primeira mensagem de texto depois da retomada, entregamos tudo ao agente numa nota só.
`/pausar 2h|24h`, `/retomar` e `/pausados` são tratados aqui mesmo (é o único lugar que sabe quem mandou).
Sai quando: o status do app imprimir `pausanativa=1` (sonda HERMES_PAUSA_SH trocada pelo sinal da release que fechar
a issue); aí `capacidadesDe` prefere o nativo e `hermesPausaPluginRemoverSh` tira este plugin.
Tabela: docs/guia/contornos.md.

Áudio por conversa (1.2.0): quem transforma a resposta em áudio é o gateway, depois que o agente escreveu; o agente
prometia "só texto" e o áudio saía do mesmo jeito. O Hermes tem o modo de voz por conversa (`/voice off`), mas só por
comando de quem escreve. A ferramenta `audio_da_conversa` liga esse mesmo modo para a conversa da sessão atual: o hook
guarda de onde veio a última mensagem de cada número e a ferramenta chama `_apply_voice_mode` do gateway.
As ferramentas recebem os argumentos como o Hermes manda (`handler(args, task_id=…, session_id=…)`) e acham o número
da conversa pela chave da sessão no state.db: até a 1.1.0 a `pausar_conversa` esperava outra forma e nunca funcionava.

Áudio da marca do app (1.3.0; CONTORNO #7, docs/guia/contornos.md): duas escolhas do painel que o Hermes não tem
como opção, lidas de whatsapp-lista.json › audio a cada mensagem (sem reiniciar o gateway):
- `sempre`: responder em áudio também a mensagem de texto. O Hermes só tem isso por conversa (`/voice tts`, modo
  "all"); o hook liga o modo na conversa que ainda não escolheu nenhum e desfaz só as que ele mesmo marcou.
- `soAudio`: mandar só o áudio, sem o texto embaixo. No WhatsApp o gateway manda o áudio e depois o mesmo texto (só o
  Telegram pula, pela legenda). Embrulhamos `send_voice`, `_play_tts_file` e `_send_final_text` do adapter: o texto só
  é pulado quando o áudio daquela conversa saiu com sucesso há instantes; áudio que falha deixa o texto sair.
Sai quando: o Hermes tiver as duas opções no config (issue upstream a abrir; ver a tabela).

Sem Claude (1.4.0). CONTORNO #8 (Hermes; docs/guia/contornos.md): quando nenhum provedor responde, o Hermes manda ao contato "Your
request was not processed. Send it again…" a cada mensagem, e não há como calar um turno que já abriu (ele rejeita o
marcador de silêncio numa conversa com uma pessoa e não tem gancho na saída). O backend grava
~/.local/share/meu-bot/sem-claude.json ({desde, ate, motivo}) ao ver a falha e o renova enquanto a sonda dele não
consegue o Claude; enquanto a marca vale, o hook guarda a mensagem do contato (linha com `motivo: "sem-claude"`) e a
descarta, como a de um pausado. O dono passa sempre. Marca vencida ou ilegível: a mensagem segue (fail-open).
Sai quando: o Hermes tiver uma opção para não entregar o aviso de turno falho (ver a tabela).

Regras: o dono (me.id/me.lid do creds.json e, se gravado pelo app, `dono.numero` de whatsapp-lista.json — a pessoa
falando do celular dela quando o agente roda num chip dedicado) nunca é descartado nem pausado; um contato só pausa a si mesmo e só com
prazo (pausado ele não consegue pedir para voltar); o dono pausa qualquer um, com ou sem prazo. Grupos passam reto.
Só a biblioteca padrão; qualquer erro deixa a mensagem seguir (fail-open) — este plugin nunca derruba o gateway.
"""
import asyncio
import fcntl
import json
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone

VERSAO = "1.4.0"  # igual ao plugin.yaml (o teste confere)
NOME = "meu-bot-pausa"
log = logging.getLogger(NOME)

HORAS_CONTATO = (2, 24)
HORAS_DONO_MAX = 168
NOTA_MAX_LINHAS = 30
NOTA_MAX_CHARS = 300
TEXTO_MAX = 2000
NUMERO_RE = re.compile(r"^\d{8,15}$")
CMD_RE = re.compile(r"^\s*/(pausar|retomar|pausados)\b(.*)$", re.IGNORECASE | re.DOTALL)
PRAZO_RE = re.compile(r"(\d{1,3})\s*(h|hs|hora|horas|d|dia|dias)\b", re.IGNORECASE)

_lids_avisados = set()
# Última origem de cada número (gateway e source do evento): é o que a ferramenta de áudio precisa para achar a conversa.
_conversas = {}
CONVERSAS_MAX = 500


# ------------------------------------------------------------------ tempo
def _agora():
    """Agora em UTC (os testes trocam esta função)."""
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(s):
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _fuso():
    try:
        nome = open(_caminho("fuso"), encoding="utf-8").read().strip() or "America/Sao_Paulo"
    except Exception:
        nome = "America/Sao_Paulo"
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(nome)
    except Exception:
        return timezone.utc


def _hora_local(dt, agora=None):
    """"14:30" se for hoje no fuso da pessoa; senão "30/10 14:30"."""
    tz = _fuso()
    loc = dt.astimezone(tz)
    hoje = (agora or _agora()).astimezone(tz).date()
    return loc.strftime("%H:%M") if loc.date() == hoje else loc.strftime("%d/%m %H:%M")


# ------------------------------------------------------------------ arquivos (o único I/O)
def _home():
    return os.environ.get("HOME") or os.path.expanduser("~")


def _caminho(nome):
    return os.path.join(_home(), ".local", "share", "meu-bot", nome)


LISTA = "whatsapp-lista.json"
PAUSADOS = "whatsapp-pausados.jsonl"
SEM_CLAUDE = "sem-claude.json"  # a marca do backend (backend-colima/sem-claude.js)
SEM_CLAUDE_MOTIVO = "sem-claude"
LIDS = "whatsapp-lid.json"
CARREGADO = "whatsapp-pausa.carregado"
AUDIO_SEMPRE = "whatsapp-audio-sempre.json"  # conversas em que ESTE plugin ligou o modo "all" (só elas são desfeitas)
VOZ_JANELA_S = 90  # o texto final vem logo depois do áudio; passado isso, a marca do áudio não vale mais
CREDS = os.path.join(".hermes", "whatsapp", "session", "creds.json")


def _ler_json(caminho, padrao):
    try:
        with open(caminho, encoding="utf-8") as f:
            v = json.load(f)
        return v if isinstance(v, type(padrao)) else padrao
    except Exception:
        return padrao


def _gravar_json(caminho, obj, modo=0o600):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    tmp = caminho + ".tmp-pausa"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
    os.chmod(tmp, modo)
    os.replace(tmp, caminho)


class _Trava:
    """flock em whatsapp-lista.lock: o app (waMarkSh) e este plugin gravam o mesmo arquivo."""

    def __init__(self):
        self.f = None

    def __enter__(self):
        try:
            self.f = open(_caminho("whatsapp-lista.lock"), "a")
            fcntl.flock(self.f, fcntl.LOCK_EX)
        except Exception:
            self.f = None
        return self

    def __exit__(self, *a):
        if self.f is not None:
            try:
                fcntl.flock(self.f, fcntl.LOCK_UN)
                self.f.close()
            except Exception:
                pass


def _pausa_de(v):
    """Entrada de `paused` nos dois formatos: string ISO (antigo) ou {desde, ate, por}."""
    if isinstance(v, str):
        return {"desde": v, "ate": None, "por": "app"} if _parse_iso(v) else None
    if isinstance(v, dict) and _parse_iso(v.get("desde")):
        ate = v.get("ate")
        return {"desde": v["desde"], "ate": ate if isinstance(ate, str) and _parse_iso(ate) else None, "por": v.get("por") or "app"}
    return None


def _ler_pausados():
    """{número: {desde, ate, por}} como está no arquivo (vencidas incluídas)."""
    lista = _ler_json(_caminho(LISTA), {})
    out = {}
    for n, v in (lista.get("paused") or {}).items() if isinstance(lista.get("paused"), dict) else []:
        p = _pausa_de(v)
        if NUMERO_RE.match(str(n)) and p is not None:
            out[str(n)] = p
    return out


def _mudar_pausados(mut):
    """Lê, aplica `mut(paused)` e regrava só se mudou, preservando todas as outras chaves do arquivo."""
    with _Trava():
        caminho = _caminho(LISTA)
        lista = _ler_json(caminho, {})
        cru = lista.get("paused") if isinstance(lista.get("paused"), dict) else {}
        paused = {}
        for n, v in cru.items():
            p = _pausa_de(v)
            if p is not None:
                paused[str(n)] = p
        mut(paused)
        # Regrava também quando só o formato mudou (string antiga → objeto): o app passa a ler um formato só.
        if json.dumps(paused, sort_keys=True) == json.dumps(cru, sort_keys=True):
            return paused
        for k in ("archived", "deleted", "names", "groupsDeleted", "groupNames"):
            lista.setdefault(k, {})
        lista["paused"] = paused
        _gravar_json(caminho, lista)
        return paused


def _anexar_pausado(linha):
    caminho = _caminho(PAUSADOS)
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    fd = os.open(caminho, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(fd, (json.dumps(linha, ensure_ascii=False) + "\n").encode("utf-8"))
    finally:
        os.close(fd)


def _ler_linhas_pausadas():
    try:
        with open(_caminho(PAUSADOS), encoding="utf-8") as f:
            crus = f.read().splitlines()
    except Exception:
        return []
    out = []
    for l in crus:
        try:
            d = json.loads(l)
            if isinstance(d, dict) and NUMERO_RE.match(str(d.get("numero", ""))):
                out.append(d)
        except Exception:
            continue
    return out


def _tirar_pausados(numero):
    """Devolve as linhas do número e regrava o arquivo sem elas."""
    todas = _ler_linhas_pausadas()
    dele = [d for d in todas if d["numero"] == numero]
    if dele:
        resto = [d for d in todas if d["numero"] != numero]
        caminho = _caminho(PAUSADOS)
        tmp = caminho + ".tmp-pausa"
        with open(tmp, "w", encoding="utf-8") as f:
            for d in resto:
                f.write(json.dumps(d, ensure_ascii=False) + "\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, caminho)
    return dele


def _ler_lids():
    return {str(k): str(v) for k, v in _ler_json(_caminho(LIDS), {}).items() if NUMERO_RE.match(str(v))}


def _aprender_lid(lids, numeros):
    if not lids or len(numeros) != 1:
        return
    n = next(iter(numeros))
    mapa = _ler_lids()
    novo = {l: n for l in lids if mapa.get(l) != n}
    if novo:
        mapa.update(novo)
        _gravar_json(_caminho(LIDS), mapa)


_dono_cache = {}


def _cache_por_mtime(chave, caminho, extrair):
    """Relê `caminho` só quando o mtime mudou; sem arquivo, conjunto vazio."""
    try:
        mt = os.stat(caminho).st_mtime
    except Exception:
        return set()
    hit = _dono_cache.get(chave)
    if hit is not None and hit[0] == mt:
        return hit[1]
    try:
        ids = set(extrair(_ler_json(caminho, {})))
    except Exception:
        ids = set()
    _dono_cache[chave] = (mt, ids)
    return ids


def _dono():
    """Quem manda: me.id/me.lid do creds.json do bridge + o dono gravado pelo app (whatsapp-lista.json › dono.numero),
    para a pessoa que fala do celular dela num chip dedicado. Vazio sem pareamento."""
    ids = set(_cache_por_mtime("creds", os.path.join(_home(), CREDS), lambda d: [x for k in ("id", "lid") for x in [_digitos((d.get("me") or {}).get(k))] if x]))
    ids |= _cache_por_mtime("lista", _caminho(LISTA), lambda d: [n for n in [_digitos((d.get("dono") or {}).get("numero"))] if n and NUMERO_RE.match(n)])
    return ids


# ------------------------------------------------------------------ identidade
def _digitos(jid):
    """"5521…:8@s.whatsapp.net" → "5521…"; "1400…@lid" → "1400…"; None sem dígitos."""
    if not jid:
        return None
    s = str(jid).split("@", 1)[0].split(":", 1)[0]
    s = re.sub(r"\D", "", s)
    return s or None


def _e_lid(jid):
    return str(jid or "").endswith("@lid")


def _ids_do_evento(event):
    """(números, lids) que aparecem no evento: user_id, source.user_id, source.user_id_alt e, em DM, source.chat_id."""
    src = getattr(event, "source", None)
    numeros, lids = set(), set()
    for jid in (getattr(event, "user_id", None), getattr(src, "user_id", None), getattr(src, "user_id_alt", None), getattr(src, "chat_id", None)):
        d = _digitos(jid)
        if not d:
            continue
        (lids if _e_lid(jid) else numeros).add(d)
    numeros = {n for n in numeros if NUMERO_RE.match(n)}
    return numeros, lids


def _resolver(numeros, lids):
    mapa = _ler_lids()
    out = set(numeros)
    for l in lids:
        if l in mapa:
            out.add(mapa[l])
        elif not numeros and l not in _lids_avisados:
            _lids_avisados.add(l)
            log.warning("%s: remetente só com LID %s e sem mapa para o número; a mensagem segue normal", NOME, l)
    return out


def _tipo(event):
    mt = getattr(event, "message_type", None)
    return str(getattr(mt, "value", mt) or "text").lower()


def _texto_guardado(event):
    texto = (getattr(event, "text", "") or "").strip()
    if texto:
        return texto[:TEXTO_MAX]
    t = _tipo(event)
    return {"voice": "[áudio]", "audio": "[áudio]", "photo": "[imagem]", "image": "[imagem]", "video": "[vídeo]", "document": "[arquivo]", "sticker": "[figurinha]"}.get(t, "[mídia]")


# ------------------------------------------------------------------ pausa
def _vigente(p, agora):
    if p is None:
        return False
    ate = _parse_iso(p.get("ate")) if p.get("ate") else None
    return ate is None or ate > agora


def _expirar(agora):
    """Apaga as pausas vencidas (e qualquer marca no dono, que nunca vale) e devolve as vigentes."""
    eu = _dono()

    def mut(paused):
        for n in [n for n, p in paused.items() if not _vigente(p, agora) or n in eu]:
            log.info("%s: pausa de %s %s", NOME, n, "não vale: é o dono" if n in eu else "venceu")
            del paused[n]
    return _mudar_pausados(mut)


def _pausar(numero, horas, por, agora):
    ate = None if horas is None else _iso(agora + timedelta(hours=horas))
    entrada = {"desde": _iso(agora), "ate": ate, "por": por}
    _mudar_pausados(lambda paused: paused.__setitem__(numero, entrada))
    log.info("%s: %s pausado por %s até %s", NOME, numero, por, ate or "retomar")
    return entrada


def _retomar(numero):
    havia = {"v": False}

    def mut(paused):
        havia["v"] = numero in paused
        paused.pop(numero, None)
    _mudar_pausados(mut)
    if havia["v"]:
        log.info("%s: %s retomado", NOME, numero)
    return havia["v"]


# ------------------------------------------------------------------ comandos
def _parse_comando(texto):
    m = CMD_RE.match(texto or "")
    if not m:
        return None
    cmd, resto = m.group(1).lower(), m.group(2)
    horas = None
    pm = PRAZO_RE.search(resto)
    if pm:
        n = int(pm.group(1))
        horas = n * 24 if pm.group(2).lower().startswith("d") else n
        resto = resto[:pm.start()] + resto[pm.end():]
    numero = None
    dm = re.search(r"\+?\d[\d\s().-]*", resto)
    if dm:
        d = re.sub(r"\D", "", dm.group(0))
        numero = d if NUMERO_RE.match(d) else "invalido"
    return cmd, numero, horas


def _fmt_prazo(horas):
    return f"{horas // 24} dia{'s' if horas >= 48 else ''}" if horas % 24 == 0 and horas >= 24 else f"{horas} hora{'s' if horas != 1 else ''}"


def _executar(cmd, numero, horas, dono, remetente, agora):
    """Aplica o comando e devolve o texto da resposta (pt-BR, uma frase)."""
    eu = _dono()
    if cmd == "pausados":
        if not dono:
            return "Só o dono consegue ver quem está pausado."
        paused = _expirar(agora)
        if not paused:
            return "Ninguém pausado."
        cont = {}
        for d in _ler_linhas_pausadas():
            cont[d["numero"]] = cont.get(d["numero"], 0) + 1
        partes = []
        for n, p in sorted(paused.items()):
            fim = f"até {_hora_local(_parse_iso(p['ate']), agora)}" if p.get("ate") else "até retomar"
            partes.append(f"+{n} {fim} ({cont.get(n, 0)} msgs)")
        return "Pausados: " + "; ".join(partes) + "."
    if cmd == "pausar":
        if dono:
            if numero is None:
                return "Diga quem: /pausar <número> [2h|24h]."
            if numero == "invalido":
                return "Não entendi o número. Use /pausar <número com DDI> [2h|24h]."
            if numero in eu:
                return "Você é o dono: não dá para pausar você. Use /pausar <número> [2h|24h]."
            if horas is not None and not 1 <= horas <= HORAS_DONO_MAX:
                return f"Prazo de 1 a {HORAS_DONO_MAX} horas; sem prazo fica até você retomar."
            e = _pausar(numero, horas, "dono", agora)
            if horas is None:
                return f"Pausei +{numero} até você retomar (/retomar {numero})."
            return f"Pausei +{numero} por {_fmt_prazo(horas)} (até {_hora_local(_parse_iso(e['ate']), agora)})."
        if numero not in (None, "invalido"):
            return "Só consigo pausar esta conversa: /pausar 2h ou /pausar 24h."
        if horas not in HORAS_CONTATO:
            return "Diga o prazo: /pausar 2h ou /pausar 24h."
        if remetente is None:
            return "Não consegui identificar o seu número para pausar."
        e = _pausar(remetente, horas, "contato", agora)
        return f"Ok, pausei por {_fmt_prazo(horas)}. Volto a responder às {_hora_local(_parse_iso(e['ate']), agora)}."
    if cmd == "retomar":
        if not dono:
            return "Não estou pausado aqui." if remetente is None or remetente not in _expirar(agora) else None
        if numero is None or numero == "invalido":
            return "Diga quem: /retomar <número>."
        guardadas = len([d for d in _ler_linhas_pausadas() if d["numero"] == numero])
        if not _retomar(numero):
            return f"+{numero} não estava pausado."
        if guardadas == 1:
            return f"Retomei +{numero}. 1 mensagem guardada vai para o agente na próxima dele."
        if guardadas:
            return f"Retomei +{numero}. {guardadas} mensagens guardadas vão para o agente na próxima dele."
        return f"Retomei +{numero}."
    return None


# ------------------------------------------------------------------ nota ao agente
def _sem_claude(agora):
    """A marca do backend de que o Claude está fora ({desde, ate, motivo}), só enquanto vale; senão None."""
    v = _ler_json(_caminho(SEM_CLAUDE), {})
    if not v:
        return None
    ate = _parse_iso(v.get("ate"))
    if ate is None or ate <= agora or _parse_iso(v.get("desde")) is None:
        return None
    return v


def _montar_nota(numero, linhas, agora):
    dt0 = _parse_iso(linhas[0].get("em")) or agora
    dt1 = _parse_iso(linhas[-1].get("em")) or agora
    nome = next((d.get("nome") for d in linhas if d.get("nome")), None)
    quem = f"{nome} (+{numero})" if nome else f"+{numero}"
    fora = all(d.get("motivo") == SEM_CLAUDE_MOTIVO for d in linhas)
    porque = "escreveu enquanto você estava fora do ar" if fora else "esteve pausado"
    out = [f"[Nota do meu-bot] {quem} {porque} e você não viu o que ele mandou entre {_hora_local(dt0, agora)} e {_hora_local(dt1, agora)}:"]
    for d in linhas[:NOTA_MAX_LINHAS]:
        dt = _parse_iso(d.get("em"))
        t = str(d.get("texto") or "")[:NOTA_MAX_CHARS]
        out.append(f"- {_hora_local(dt, agora) if dt else '?'} — {t}")
    if len(linhas) > NOTA_MAX_LINHAS:
        out.append(f"(e mais {len(linhas) - NOTA_MAX_LINHAS} mensagens)")
    out.append("Considere tudo isso e responda à mensagem atual numa resposta só, sem responder uma a uma e sem mencionar a pausa." if not fora else "Considere tudo isso e responda à mensagem atual numa resposta só, sem responder uma a uma; se fizer sentido, peça desculpas pela demora em uma frase.")
    return "\n".join(out)


# ------------------------------------------------------------------ resposta ao comando
async def _responder(gateway, event, texto):
    """Manda `texto` ao chat do evento pelo adapter do WhatsApp; sem adapter, o agente entrega (rewrite)."""
    src = getattr(event, "source", None)
    chat_id = getattr(src, "chat_id", None)
    try:
        adapters = getattr(gateway, "adapters", None) or {}
        for k, adapter in adapters.items():
            if str(getattr(k, "value", k)).lower() == "whatsapp" and chat_id and hasattr(adapter, "send"):
                r = adapter.send(chat_id, texto)
                if asyncio.iscoroutine(r):
                    await r
                return {"action": "skip", "reason": f"{NOME}: comando respondido"}
    except Exception:
        log.exception("%s: não consegui responder pelo adapter; o agente entrega", NOME)
    return {"action": "rewrite", "text": f"[Nota do meu-bot] Um comando de pausa foi executado. Responda ao contato exatamente com: «{texto}» e nada mais."}


# ------------------------------------------------------------------ o hook
async def pre_gateway_dispatch(event=None, gateway=None, session_store=None, **kw):
    try:
        src = getattr(event, "source", None)
        plat = getattr(src, "platform", None)
        if str(getattr(plat, "value", plat) or "").lower() != "whatsapp":
            return None
        if str(getattr(src, "chat_type", "dm") or "dm") != "dm":
            return None
        agora = _agora()
        numeros, lids = _ids_do_evento(event)
        _aprender_lid(lids, numeros)
        nums = _resolver(numeros, lids)
        eu = _dono()
        dono = bool(nums & eu)
        _lembrar_conversa(nums, gateway, src)
        _audio_da_marca(gateway, src)
        texto = (getattr(event, "text", "") or "").strip()
        paused = _expirar(agora)
        cmd = _parse_comando(texto)
        pausado = next((n for n in nums if n in paused and n not in eu), None)
        if cmd is not None and not (pausado and not dono):
            remetente = next(iter(nums - eu), None)
            resposta = _executar(cmd[0], cmd[1], cmd[2], dono, remetente, agora)
            if resposta is None:
                return {"action": "skip", "reason": f"{NOME}: comando sem resposta"}
            return await _responder(gateway, event, resposta)
        if dono:
            return None
        fora = _sem_claude(agora)
        if fora and not pausado:
            n = next(iter(nums - eu), None) or next(iter(nums), None)
            if n:
                _anexar_pausado({"numero": n, "nome": getattr(event, "user_name", None) or getattr(src, "user_name", None), "texto": _texto_guardado(event), "em": _iso(agora), "tipo": _tipo(event), "motivo": SEM_CLAUDE_MOTIVO})
            log.info("%s: descartada mensagem de %s (Claude fora do ar desde %s)", NOME, n, fora.get("desde"))
            return {"action": "skip", "reason": f"{NOME}: Claude fora do ar"}
        if pausado:
            _anexar_pausado({"numero": pausado, "nome": getattr(event, "user_name", None) or getattr(src, "user_name", None), "texto": _texto_guardado(event), "em": _iso(agora), "tipo": _tipo(event)})
            fim = paused[pausado].get("ate") or "retomar"
            log.info("%s: descartada mensagem de %s (pausado até %s)", NOME, pausado, fim)
            return {"action": "skip", "reason": f"{NOME}: {pausado} pausado até {fim}"}
        if texto and _tipo(event) == "text" and len(nums) == 1:
            n = next(iter(nums))
            linhas = _tirar_pausados(n)
            if linhas:
                log.info("%s: %s voltou; %d mensagem(ns) da pausa vão numa nota", NOME, n, len(linhas))
                return {"action": "rewrite", "text": _montar_nota(n, linhas, agora) + "\n\nMensagem atual: " + texto}
        return None
    except Exception:
        log.exception("%s: erro no hook; a mensagem segue normal", NOME)
        return None


# ------------------------------------------------------------------ áudio da marca do app (sempre / só áudio)
_audio_cache = {"mt": None, "cfg": (False, False)}
_voz_enviada = {}  # chat_id -> (monotonic, SendResult) do último áudio que saiu com sucesso
_sempre_marcadas = None  # {voice_key: chat_id}, lido do disco na primeira vez


def _audio_cfg():
    """(sempre, so_audio) de whatsapp-lista.json › audio; relê só quando o arquivo muda. Sem arquivo ou chave: tudo desligado."""
    try:
        mt = os.stat(_caminho(LISTA)).st_mtime
    except Exception:
        return (False, False)
    if _audio_cache["mt"] != mt:
        a = _ler_json(_caminho(LISTA), {})
        a = a.get("audio") if isinstance(a, dict) else None
        a = a if isinstance(a, dict) else {}
        _audio_cache["mt"], _audio_cache["cfg"] = mt, (a.get("sempre") is True, a.get("soAudio") is True)
    return _audio_cache["cfg"]


def _aplicar_sempre(gateway, src):
    """Liga o modo "all" na conversa sem modo escolhido quando a marca diz `sempre`; desligada a marca, desfaz só o
    que este plugin ligou. Quem pediu "só texto" (modo "off", pelo /voice ou pela ferramenta) nunca é tocado."""
    global _sempre_marcadas
    try:
        if _sempre_marcadas is None:
            lido = _ler_json(_caminho(AUDIO_SEMPRE), {})
            _sempre_marcadas = lido if isinstance(lido, dict) else {}
        sempre = _audio_cfg()[0]
        if not sempre and not _sempre_marcadas:
            return  # nada ligado e nada a desfazer: não toca no gateway
        chave = gateway._voice_key_for_source(src)
        modo = gateway._voice_mode.get(chave)
        if sempre and modo is None:
            gateway._apply_voice_mode(gateway._delivery_adapter_for(src), chave, src.chat_id, "all")
            _sempre_marcadas[chave] = str(src.chat_id)
            _gravar_json(_caminho(AUDIO_SEMPRE), _sempre_marcadas)
            log.info("%s: áudio sempre ligado na conversa %s", NOME, src.chat_id)
        elif not sempre and chave in _sempre_marcadas:
            if modo == "all":
                gateway._voice_mode.pop(chave, None)
                gateway._save_voice_modes()
                gateway._toggle_adapter_auto_tts_set(gateway._delivery_adapter_for(src), src.chat_id, False, enable=True)
                log.info("%s: áudio sempre desligado na conversa %s", NOME, src.chat_id)
            _sempre_marcadas.pop(chave, None)
            _gravar_json(_caminho(AUDIO_SEMPRE), _sempre_marcadas)
    except Exception:
        log.exception("%s: não apliquei o áudio sempre; a conversa segue como estava", NOME)


def _embrulhar_so_audio(adapter):
    """Uma vez por adapter: com `soAudio` na marca, o texto final é pulado quando o áudio da conversa acabou de sair.
    Qualquer erro aqui chama o original: a pessoa nunca fica sem resposta."""
    try:
        if adapter is None or getattr(adapter, "_meu_bot_so_audio", False):
            return
        voz, tocar, texto = (getattr(adapter, n, None) for n in ("send_voice", "_play_tts_file", "_send_final_text"))
        if not (callable(voz) and callable(tocar) and callable(texto)):
            return

        async def send_voice(*a, **k):
            r = await voz(*a, **k)
            try:
                chat = k.get("chat_id", a[0] if a else None)
                if chat is not None and getattr(r, "success", False):
                    _voz_enviada[str(chat)] = (time.monotonic(), r)
            except Exception:
                pass
            return r

        async def _play_tts_file(event, *a, **k):
            r = await tocar(event, *a, **k)
            try:
                saiu = _voz_enviada.pop(str(event.source.chat_id), None)
                # True = "o texto já foi junto": é o sinal que o gateway usa no Telegram para não mandar o texto depois.
                if saiu is not None and _audio_cfg()[1]:
                    return True
            except Exception:
                pass
            return r

        async def _send_final_text(*a, **k):
            try:
                event, efemera, registrar = a[0], a[4], a[6]
                saiu = _voz_enviada.pop(str(event.source.chat_id), None)
                if saiu is not None and not efemera and _audio_cfg()[1] and time.monotonic() - saiu[0] <= VOZ_JANELA_S:
                    registrar(saiu[1])  # a entrega do turno foi o áudio
                    log.info("%s: só áudio para %s (texto não enviado)", NOME, event.source.chat_id)
                    return None
            except Exception:
                log.exception("%s: erro ao decidir o só áudio; o texto segue", NOME)
            return await texto(*a, **k)

        adapter.send_voice, adapter._play_tts_file, adapter._send_final_text = send_voice, _play_tts_file, _send_final_text
        adapter._meu_bot_so_audio = True
    except Exception:
        log.exception("%s: não embrulhei o adapter; o áudio segue com o texto", NOME)


def _audio_da_marca(gateway, src):
    if gateway is None or src is None:
        return
    try:
        _embrulhar_so_audio(gateway._delivery_adapter_for(src))
    except Exception:
        pass
    _aplicar_sempre(gateway, src)


# ------------------------------------------------------------------ ferramenta para o agente (só a própria conversa)
SESSAO_RE = re.compile(r":whatsapp:dm:(\d{8,15})")


def _numero_da_sessao(kwargs):
    """Número do contato da conversa em que a ferramenta foi chamada. O Hermes 0.22 só entrega `task_id` e `session_id`
    (o id curto, "20261118_225127_…", sem número): por isso, depois dos argumentos, tenta o contexto de sessão do
    gateway e, por fim, a chave da sessão no state.db."""
    for k in ("session_key", "session_id", "task_id", "session"):
        m = SESSAO_RE.search(str(kwargs.get(k) or ""))
        if m:
            return m.group(1)
    try:
        from gateway.session_context import get_session_env
        m = SESSAO_RE.search(str(get_session_env("HERMES_SESSION_KEY", "") or ""))
        if m:
            return m.group(1)
    except Exception:
        pass
    try:
        import sqlite3
        db = os.path.join(os.environ.get("HERMES_HOME") or os.path.join(_home(), ".hermes"), "state.db")
        if os.path.exists(db):
            con = sqlite3.connect("file:" + db + "?mode=ro", uri=True, timeout=2)
            try:
                for k in ("session_id", "task_id"):
                    sid = str(kwargs.get(k) or "")
                    if not sid:
                        continue
                    linha = con.execute("select session_key from sessions where id = ?", (sid,)).fetchone()
                    m = SESSAO_RE.search(str(linha[0] or "")) if linha else None
                    if m:
                        return m.group(1)
            finally:
                con.close()
    except Exception:
        pass
    return None


def _tool_pausar(args=None, horas=None, **kwargs):
    """O agente chama quando o contato pede para pausar: só a conversa da sessão atual e só 2 ou 24 h. O Hermes entrega
    os argumentos da ferramenta num dicionário, na primeira posição (`handler(args, **contexto)`)."""
    try:
        if isinstance(args, dict):
            horas = args.get("horas", horas)
        numero = _numero_da_sessao(kwargs)
        if numero is None:
            return json.dumps({"ok": False, "mensagem": "Não sei qual conversa é esta. Oriente a pessoa a mandar /pausar 2h ou /pausar 24h."}, ensure_ascii=False)
        if numero in _dono():
            return json.dumps({"ok": False, "mensagem": "O dono não pode ser pausado. Ele pausa outros com /pausar <número> [2h|24h]."}, ensure_ascii=False)
        try:
            h = int(horas)
        except Exception:
            h = None
        if h not in HORAS_CONTATO:
            return json.dumps({"ok": False, "mensagem": "Prazo precisa ser 2 ou 24 horas."}, ensure_ascii=False)
        e = _pausar(numero, h, "contato", _agora())
        return json.dumps({"ok": True, "mensagem": f"Pausado por {_fmt_prazo(h)}; volta às {_hora_local(_parse_iso(e['ate']))}."}, ensure_ascii=False)
    except Exception as exc:
        return json.dumps({"ok": False, "mensagem": f"Não consegui pausar: {exc}"}, ensure_ascii=False)


def _lembrar_conversa(nums, gateway, src):
    """Guarda gateway e origem da última mensagem de cada número (em memória; some no reinício, e aí a próxima mensagem repõe)."""
    try:
        if gateway is None or src is None:
            return
        for n in nums:
            _conversas.pop(n, None)
            _conversas[n] = (gateway, src)
        while len(_conversas) > CONVERSAS_MAX:
            _conversas.pop(next(iter(_conversas)))
    except Exception:
        pass


def _tool_audio(args=None, responder_em_audio=None, **kwargs):
    """O agente chama quando o contato pede para não receber (ou voltar a receber) áudio: só a conversa da sessão atual."""
    try:
        if isinstance(args, dict):
            responder_em_audio = args.get("responder_em_audio", responder_em_audio)
        if not isinstance(responder_em_audio, bool):
            return json.dumps({"ok": False, "mensagem": "Diga responder_em_audio: false (só texto) ou true (voltar ao áudio)."}, ensure_ascii=False)
        numero = _numero_da_sessao(kwargs)
        achado = _conversas.get(numero) if numero else None
        if achado is None:
            return json.dumps({"ok": False, "mensagem": "Não achei esta conversa no gateway. Oriente a pessoa a mandar /voice off (para voltar: /voice on)."}, ensure_ascii=False)
        gateway, src = achado
        # Os mesmos passos do /voice do Hermes: grava o modo da conversa e avisa o adapter. "voice_only" = só quando recebe áudio.
        adapter = gateway._delivery_adapter_for(src)
        gateway._apply_voice_mode(adapter, gateway._voice_key_for_source(src), src.chat_id, "voice_only" if responder_em_audio else "off")
        log.info("%s: áudio %s para %s, a pedido na conversa", NOME, "ligado" if responder_em_audio else "desligado", numero)
        return json.dumps({"ok": True, "mensagem": "Esta conversa volta a receber resposta em áudio quando a pessoa mandar áudio." if responder_em_audio else "Áudio desligado nesta conversa: daqui em diante, inclusive esta resposta, vai só texto."}, ensure_ascii=False)
    except Exception as exc:
        return json.dumps({"ok": False, "mensagem": f"Não consegui mudar o áudio desta conversa ({exc}). Oriente a pessoa a mandar /voice off."}, ensure_ascii=False)


TOOL_AUDIO_SCHEMA = {
    "name": "audio_da_conversa",
    "description": "Liga ou desliga a resposta em áudio para o contato desta conversa do WhatsApp. Chame ANTES de responder sempre que a pessoa pedir para não receber áudio (\"para de mandar áudio\", \"só texto\", \"não consigo ouvir\") ou para voltar a receber. Sem chamar, o áudio continua saindo: quem gera o áudio é o sistema, não o seu texto; prometer \"só texto\" não basta.",
    "parameters": {"type": "object", "properties": {"responder_em_audio": {"type": "boolean", "description": "false = só texto nesta conversa; true = volta a responder em áudio quando a pessoa mandar áudio."}}, "required": ["responder_em_audio"]},
}

TOOL_SCHEMA = {
    "name": "pausar_conversa",
    "description": "Pausa o agente para o contato desta conversa do WhatsApp por 2 ou 24 horas, quando a própria pessoa pedir. Depois do prazo o agente volta sozinho.",
    "parameters": {"type": "object", "properties": {"horas": {"type": "integer", "enum": [2, 24], "description": "Prazo da pausa em horas: 2 ou 24."}}, "required": ["horas"]},
}


def _gravar_carregado():
    try:
        _gravar_json(_caminho(CARREGADO), {"versao": VERSAO, "pid": os.getpid(), "em": _iso(_agora())}, 0o644)
    except Exception:
        pass


def register(ctx):
    """Entrada do Hermes. Tudo fail-open: sem o hook o gateway segue como sempre (pausa pela lista, pelo app)."""
    try:
        ctx.register_hook("pre_gateway_dispatch", pre_gateway_dispatch)
    except Exception:
        log.exception("%s: não registrou o hook", NOME)
        return
    try:
        ctx.register_tool(name="pausar_conversa", toolset="meu-bot", schema=TOOL_SCHEMA, handler=_tool_pausar, description=TOOL_SCHEMA["description"], emoji="⏸")
    except Exception:
        log.info("%s: ferramenta para o agente não registrada; /pausar 2h continua valendo", NOME)
    try:
        ctx.register_tool(name="audio_da_conversa", toolset="meu-bot", schema=TOOL_AUDIO_SCHEMA, handler=_tool_audio, description=TOOL_AUDIO_SCHEMA["description"], emoji="🔇")
    except Exception:
        log.info("%s: ferramenta de áudio não registrada; /voice off continua valendo", NOME)
    _gravar_carregado()
