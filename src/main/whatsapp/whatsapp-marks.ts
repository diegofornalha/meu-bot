/**
 * Marcações das conversas do WhatsApp guardadas na máquina (a VM), para que o meu-bot da pessoa e o meu-bot-admin
 * vejam a mesma lista (como a pausa, que mora no OpenClaw): arquivado, excluído e os nomes (o pushname em cache e o
 * apelido dado na tela). Puro: a leitura e a gravação por SSH ficam em whatsapp.ts.
 *
 * Arquivo: { "archived": { "<número>": "<ISO>" }, "deleted": { "<número>": "<ISO da exclusão>" },
 *           "names": { "<número>": { "name": "<pushname>", "alias": "<apelido>", "at": "<ISO>" } },
 *           "groupsDeleted": { "<jid>@g.us": "<ISO da exclusão>" },
 *           "groupNames": { "<jid>@g.us": { "alias": "<apelido>", "at": "<ISO>" } },
 *           "paused": { "<número>": { "desde": "<ISO>", "ate": "<ISO>" | null, "por": "app"|"dono"|"contato" } } }
 *           "dono": { "numero": "<dígitos>", "desde": "<ISO>" } | ausente  ← quem manda no agente, quando não é o
 *           próprio número pareado (agente num chip dedicado; a pessoa fala do celular dela). Ausente = o pareado.
 *           ← só no Hermes (no OpenClaw a pausa mora no openclaw.json). `ate` nulo = até retomar. Formato antigo
 *           ("<número>": "<ISO>") ainda é lido. O plugin meu-bot-pausa da máquina lê e grava a mesma marca (é ele
 *           que apaga as vencidas; o app só as ignora); sem o plugin, a marca acompanha a saída da WHATSAPP_ALLOWED_USERS.
 * Excluída fica oculta enquanto `updatedAt <= deletedAt`; mensagem nova do contato traz a conversa de volta nos dois
 * apps. O nome em cache poupa a leitura do histórico só para saber quem é; o apelido vence o nome na lista.
 * Grupo excluído segue a mesma regra pela sessão do agente nele (sem sessão = continua excluído até a primeira).
 */
import type { WaGroupMarkPatch, WaMarkPatch, WhatsappChat, WhatsappGroup } from "../../shared/ipc";
import { JID_RE } from "./whatsapp-grupos-core";

export const WA_MARKS_FILE = "$HOME/.local/share/meu-bot/whatsapp-lista.json";

export interface WaName { name: string | null; alias: string | null; at: string }
/** Pausa de um contato: `ate` nulo = até retomar. */
export interface WaPausa { desde: string; ate: string | null }
/** Quem manda no agente, quando não é o número pareado (gravado pela tela "Dono"). */
export interface WaDono { numero: string; desde: string }
export interface WaMarks { archived: Record<string, string>; deleted: Record<string, string>; names: Record<string, WaName>; groupsDeleted: Record<string, string>; groupNames: Record<string, { alias: string; at: string }> ; paused: Record<string, WaPausa>; dono: WaDono | null }
/**
 * Os dois números que mandam na conversa: `self` = o aparelho pareado (o agente responde por ele), `dono` = a pessoa
 * (o dono gravado, senão o próprio pareado). Único lugar que decide quem é o dono; o resto recebe `WaQuem`.
 */
export interface WaQuem { self: string | null; dono: string | null }
export const quemDe = (m: WaMarks, self: string | null): WaQuem => ({ self, dono: m.dono?.numero ?? self });
/** O dono é o próprio aparelho (agente no número da pessoa): "só eu" é o self-chat do Hermes. */
export const souEu = (q: WaQuem): boolean => q.dono === null || q.dono === q.self;
/** Os números que nunca saem da lista nem são pausados (sem repetição, sem nulos). */
export const donosDe = (q: WaQuem): string[] => [...new Set([q.self, q.dono].filter((n): n is string => n !== null))];
/** Ajuste do dono (só o main manda): número só dígitos, ou "" para voltar ao pareado. */
export interface WaDonoPatch { dono: string }
/** Um ajuste: `at` só a migração do localStorage manda (sem ele, a máquina usa a hora dela); `name`/`alias` vazios apagam. */
export type { WaGroupMarkPatch, WaMarkPatch };
/** Prazos que a tela oferece (o plugin aceita os mesmos do contato). */
export const PAUSA_HORAS = [2, 24] as const;
/** A pausa do número se está em vigor (sem prazo, ou com `ate` no futuro); vencida ou inexistente = null. */
export const pausaVigente = (m: WaMarks, n: string, agora: number = Date.now()): WaPausa | null => {
  const p = m.paused[n];
  return p === undefined || (p.ate !== null && Date.parse(p.ate) <= agora) ? null : p;
};
/** Números pausados em vigor (marca do Hermes), só dígitos. */
export const pausadosDe = (m: WaMarks, agora: number = Date.now()): string[] => Object.keys(m.paused).filter((n) => pausaVigente(m, n, agora) !== null);
const isGroupPatch = (p: WaMarkPatch | WaGroupMarkPatch | WaDonoPatch): p is WaGroupMarkPatch => "jid" in p;
const isDonoPatch = (p: WaMarkPatch | WaGroupMarkPatch | WaDonoPatch): p is WaDonoPatch => "dono" in p;

const NUMBER_RE = /^\d{8,15}$/;
const NAME_MAX = 80;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isoOrNull = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);
/** `paused` nos dois formatos: string ISO (antigo: sem prazo) ou { desde, ate }. */
function parsePausas(v: unknown): Record<string, WaPausa> {
  const out: Record<string, WaPausa> = {};
  if (!isObj(v)) return out;
  for (const [k, e] of Object.entries(v)) {
    if (!NUMBER_RE.test(k)) continue;
    const desdeStr = isoOrNull(e);
    if (desdeStr !== null) { out[k] = { desde: desdeStr, ate: null }; continue; }
    if (!isObj(e)) continue;
    const desde = isoOrNull(e.desde);
    if (desde !== null) out[k] = { desde, ate: isoOrNull(e.ate) };
  }
  return out;
}
/** Nome/apelido vindo de fora: uma linha, 1–80 caracteres; senão null. */
const nameOrNull = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s.length >= 1 && s.length <= NAME_MAX ? s : null;
};

function parseMap(v: unknown, keyRe: RegExp = NUMBER_RE): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  for (const [k, at] of Object.entries(v)) {
    const iso = isoOrNull(at);
    if (keyRe.test(k) && iso !== null) out[k] = iso;
  }
  return out;
}
function parseNames(v: unknown): Record<string, WaName> {
  const out: Record<string, WaName> = {};
  if (!isObj(v)) return out;
  for (const [k, e] of Object.entries(v)) {
    if (!NUMBER_RE.test(k) || !isObj(e)) continue;
    const name = nameOrNull(e.name), alias = nameOrNull(e.alias);
    if (name === null && alias === null) continue;
    out[k] = { name, alias, at: isoOrNull(e.at) ?? "" };
  }
  return out;
}

function parseGroupNames(v: unknown): Record<string, { alias: string; at: string }> {
  const out: Record<string, { alias: string; at: string }> = {};
  if (!isObj(v)) return out;
  for (const [k, e] of Object.entries(v)) {
    if (!JID_RE.test(k) || !isObj(e)) continue;
    const alias = nameOrNull(e.alias);
    if (alias !== null) out[k] = { alias, at: isoOrNull(e.at) ?? "" };
  }
  return out;
}

/** O que veio da máquina, saneado (lixo ou arquivo corrompido = sem marcas). */
export function parseWaMarks(raw: unknown): WaMarks {
  if (!isObj(raw)) return { archived: {}, deleted: {}, names: {}, groupsDeleted: {}, groupNames: {}, paused: {}, dono: null };
  const d = raw.dono;
  const dono: WaDono | null = isObj(d) && typeof d.numero === "string" && NUMBER_RE.test(d.numero) ? { numero: d.numero, desde: isoOrNull(d.desde) ?? "" } : null;
  return { archived: parseMap(raw.archived), deleted: parseMap(raw.deleted), names: parseNames(raw.names), groupsDeleted: parseMap(raw.groupsDeleted, JID_RE), groupNames: parseGroupNames(raw.groupNames), paused: parsePausas(raw.paused), dono };
}

/**
 * Grupo excluído só enquanto não chegou mensagem depois: `updatedAt` é a hora da sessão do agente nele (null = o agente
 * nunca recebeu nada do grupo, então a exclusão vale até a primeira). Só a vista: `agente` e o openclaw.json não mudam.
 */
export function applyWaGroupMarks(grupos: readonly WhatsappGroup[], marks: WaMarks): WhatsappGroup[] {
  return grupos.map((g) => {
    const del = marks.groupsDeleted[g.jid];
    return { ...g, apelido: marks.groupNames[g.jid]?.alias ?? null, deleted: del !== undefined && (g.updatedAt === null || Date.parse(g.updatedAt) <= Date.parse(del)) };
  });
}

/**
 * Preenche `archived`/`deleted`/`alias` e completa `name` pelo cache quando a memória do main não tem (o pushname
 * recém-lido nesta sessão vence o arquivo, por ser mais fresco). Excluída só enquanto não chegou mensagem depois.
 */
export function applyWaMarks(chats: readonly WhatsappChat[], marks: WaMarks): WhatsappChat[] {
  return chats.map((c) => {
    const del = marks.deleted[c.number];
    const nm = marks.names[c.number];
    return { ...c, name: c.name ?? nm?.name ?? null, alias: nm?.alias ?? null, archived: marks.archived[c.number] !== undefined, deleted: del !== undefined && Date.parse(c.updatedAt) <= Date.parse(del) };
  });
}

/** Saneia os ajustes que vêm da tela; recusa número fora do padrão e limita a quantidade (a migração manda vários). */
export function parseWaMarkPatches(payload: unknown): WaMarkPatch[] {
  const list = (payload as { marks?: unknown } | null)?.marks;
  if (!Array.isArray(list) || list.length === 0 || list.length > 200) throw new Error("ajustes inválidos");
  return list.map((p: unknown): WaMarkPatch => {
    if (!isObj(p) || typeof p.number !== "string") throw new Error("número inválido");
    const number = p.number.replace(/\D/g, "");
    if (!NUMBER_RE.test(number)) throw new Error("número inválido");
    const out: WaMarkPatch = { number };
    if (typeof p.archived === "boolean") out.archived = p.archived;
    if (typeof p.deleted === "boolean") out.deleted = p.deleted;
    for (const field of ["name", "alias"] as const) {
      const v = p[field];
      if (typeof v !== "string") continue;
      const clean = v.replace(/\s+/g, " ").trim();
      if (clean.length > NAME_MAX) throw new Error(`${field === "name" ? "nome" : "apelido"} longo demais (máximo ${NAME_MAX})`);
      out[field] = clean; // vazio = apagar
    }
    const at = isoOrNull(p.at);
    if (at !== null) out.at = at;
    if (out.archived === undefined && out.deleted === undefined && out.name === undefined && out.alias === undefined) throw new Error("ajuste vazio");
    return out;
  });
}

/**
 * Script remoto: lê o arquivo atual, aplica os ajustes e grava (tmp + mv). O merge é na máquina para o admin e a
 * pessoa não se sobrescreverem. Os ajustes vão em base64 (sem problema de aspas); python3 já é exigido pelo app.
 */
export function waMarkSh(patches: readonly (WaMarkPatch | WaGroupMarkPatch | WaDonoPatch)[]): string {
  for (const p of patches) {
    if (isDonoPatch(p)) {
      if (p.dono !== "" && !NUMBER_RE.test(p.dono)) throw new Error("número do dono inválido");
      continue;
    }
    if (isGroupPatch(p)) {
      if (!JID_RE.test(p.jid)) throw new Error("grupo inválido");
      if (p.alias !== undefined && (p.alias.length > NAME_MAX || /[\r\n]/.test(p.alias))) throw new Error("apelido inválido");
      continue;
    }
    if (!NUMBER_RE.test(p.number)) throw new Error("número inválido");
    for (const v of [p.name, p.alias]) if (v !== undefined && (v.length > NAME_MAX || /[\r\n]/.test(v))) throw new Error("nome inválido");
    if (p.pausaHoras !== undefined && !(PAUSA_HORAS as readonly number[]).includes(p.pausaHoras)) throw new Error("prazo de pausa inválido");
  }
  const b64 = Buffer.from(JSON.stringify(patches), "utf8").toString("base64");
  return `command -v python3 >/dev/null 2>&1 || { echo "a máquina não tem python3" >&2; exit 2; }
mkdir -p "$HOME/.local/share/meu-bot" && printf '%s' '${b64}' | base64 -d | python3 -c '
import json, sys, os, time
f = os.path.expandvars("${WA_MARKS_FILE}")
try:
    cur = json.load(open(f))
    assert isinstance(cur, dict)
except Exception:
    cur = {}
arch = cur.get("archived") if isinstance(cur.get("archived"), dict) else {}
dele = cur.get("deleted") if isinstance(cur.get("deleted"), dict) else {}
names = cur.get("names") if isinstance(cur.get("names"), dict) else {}
gdel = cur.get("groupsDeleted") if isinstance(cur.get("groupsDeleted"), dict) else {}
gnames = cur.get("groupNames") if isinstance(cur.get("groupNames"), dict) else {}
paus = cur.get("paused") if isinstance(cur.get("paused"), dict) else {}
dono = cur.get("dono") if isinstance(cur.get("dono"), dict) else None
# Formato antigo da pausa ("<número>": "<ISO>") vira o novo ({desde, ate}) ao regravar: um formato só para o plugin e o app.
for k, v in list(paus.items()):
    if isinstance(v, str): paus[k] = {"desde": v, "ate": None, "por": "app"}
iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))
now = iso(time.time())
for p in json.load(sys.stdin):
    at = p.get("at") or now
    if "dono" in p:
        dono = {"numero": p["dono"], "desde": at} if p["dono"] else None
        continue
    if "jid" in p:
        if "alias" in p:
            if p["alias"]: gnames[p["jid"]] = {"alias": p["alias"], "at": at}
            else: gnames.pop(p["jid"], None)
        if "deleted" in p:
            if p["deleted"]: gdel[p["jid"]] = at
            else: gdel.pop(p["jid"], None)
        continue
    n = p["number"]
    if "archived" in p:
        if p["archived"]: arch[n] = at
        else: arch.pop(n, None)
    if "deleted" in p:
        if p["deleted"]: dele[n] = at
        else: dele.pop(n, None)
    if "paused" in p:
        # O prazo é calculado aqui, com o relógio da máquina: é o mesmo que o plugin usa para vencer a pausa.
        h = p.get("pausaHoras")
        if p["paused"]: paus[n] = {"desde": at, "ate": iso(time.time() + h * 3600) if isinstance(h, (int, float)) and h > 0 else None, "por": "app"}
        else: paus.pop(n, None)
    if "name" in p or "alias" in p:
        e = names.get(n) if isinstance(names.get(n), dict) else {}
        if "name" in p: e["name"] = p["name"] or None
        if "alias" in p: e["alias"] = p["alias"] or None
        e["at"] = at
        if e.get("name") or e.get("alias"): names[n] = e
        else: names.pop(n, None)
tmp = f + ".tmp"
# O arquivo inteiro volta (chaves de outras versões ou do plugin ficam); só as nossas são trocadas.
out = dict(cur); out.update({"archived": arch, "deleted": dele, "names": names, "groupsDeleted": gdel, "groupNames": gnames, "paused": paus})
if dono is None: out.pop("dono", None)
else: out["dono"] = dono
with open(tmp, "w") as o: json.dump(out, o, indent=1, ensure_ascii=False)
os.chmod(tmp, 0o600); os.replace(tmp, f)
print("MARKS=1")
'
`;
}


/** O dono para a tela: quem é, o nome em cache e se é o próprio aparelho. Sem número pareado nem dono gravado, nada. */
export function donoStatus(quem: WaQuem, marks: WaMarks): { dono?: { numero: string; nome: string | null; souEu: boolean } } {
  if (quem.dono === null) return {};
  const nm = marks.names[quem.dono];
  return { dono: { numero: quem.dono, nome: nm?.alias ?? nm?.name ?? null, souEu: souEu(quem) } };
}
