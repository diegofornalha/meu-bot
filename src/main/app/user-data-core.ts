/**
 * Parte pura da herança de dados entre produtos: um produto novo (meu-bot-crm, um staging, meu-bot-fit…) nasce como
 * cópia do app de origem da mesma pessoa (Produto.herdaDe) (tutoriais feitos, conversas, memória, favoritos, logins do Navegador), em vez de
 * vazio. Decide quando herdar e o que copiar. Testado.
 */

/** O que NÃO vale copiar: caches e logs do Electron, o backend local, travas de instância e o que é só do admin. */
const PULAR = [
  /^meu-bot\.log$/, /^backend-local(\.log)?$/, /^update$/, /^Singleton/, /^Crashpad$/, /^DevToolsActivePort$/,
  /Cache$/i, /^Code Cache$/, /^blob_storage$/, /^DIPS$/, /^Trust Tokens/, /^declarative_performance_observer\.db/,
  /^pessoas\.json$/, /^produtos\.json$/, /\.tmp$/,
  // Cifrados pelo chaveiro com o nome do app ("<app> Safe Storage"): no app novo não abrem; ele pede de novo.
  /^google-contatos\.bin$/, /^tailscale-oauth\.bin$/,
];
export const entradaHerdavel = (nome: string): boolean => !PULAR.some((re) => re.test(nome));

/**
 * O settings.json herdado, para um produto que abre numa página própria (Produto.abreEm): a aba fixada volta ao padrão
 * do produto. A escolha da pessoa no app de origem ("abrir na conversa") foi feita para outro app; herdada, o
 * meu-bot-inspector-staging abria na conversa em vez do Inspector. JSON ilegível volta como veio.
 */
export function settingsHerdados(raw: string): string {
  try {
    const v: unknown = JSON.parse(raw);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return raw;
    return `${JSON.stringify({ ...(v as Record<string, unknown>), abaFixa: "padrao" }, null, 2)}\n`;
  } catch { return raw; }
}

/** Carimbo da herança, por origem: ".herdado-de-meu-bot", ".herdado-de-meu-bot-crm". */
export const carimboDe = (origem: string): string => `.herdado-de-${origem}`;

/**
 * Herdar só numa pasta "nova": sem o carimbo e sem conversas de verdade (arquivo ausente, lista vazia, ou só a
 * conversa em branco que o app cria ao abrir). Com alguma mensagem já trocada, nunca sobrescreve.
 */
export function deveHerdar(carimboExiste: boolean, conversationsRaw: string | null): boolean {
  if (carimboExiste) return false;
  if (conversationsRaw === null) return true;
  try {
    const v: unknown = JSON.parse(conversationsRaw);
    const list = Array.isArray(v) ? v : v !== null && typeof v === "object" ? (v as { conversations?: unknown }).conversations : [];
    if (!Array.isArray(list)) return true;
    return !list.some((c) => c !== null && typeof c === "object" && Array.isArray((c as { messages?: unknown }).messages) && ((c as { messages: unknown[] }).messages).length > 0);
  } catch { return true; }
}

// ---- Fusão (Produto.fundeDe): o meu-bot adota a pasta do antigo meu-bot-crm sem apagar nada dela. Regras puras por arquivo.

/** Carimbo da fusão, por origem: ".fundido-de-meu-bot-crm". */
export const carimboFusao = (origem: string): string => `.fundido-de-${origem}`;

type Obj = Record<string, unknown>;
const ehObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const parse = (raw: string | null): unknown => { if (raw === null) return null; try { return JSON.parse(raw); } catch { return null; } };
const quando = (c: Obj): number => { const t = Date.parse(typeof c["updatedAt"] === "string" ? c["updatedAt"] : ""); return Number.isNaN(t) ? 0 : t; };
const listaDe = (v: unknown): Obj[] => { const l = Array.isArray(v) ? v : ehObj(v) ? v["conversations"] : []; return Array.isArray(l) ? l.filter(ehObj).filter((c) => typeof c["id"] === "string") : []; };

/**
 * conversations.json: união por id. O mesmo id nos dois (a cópia da herança que evoluiu dos dois lados) fica com o
 * `updatedAt` maior. Devolve o JSON novo e os ids que vieram da origem (para trazer as transcrições junto); null = nada
 * a fazer (origem vazia).
 */
export function fundirConversas(destinoRaw: string | null, origemRaw: string | null): { json: string; vindas: string[] } | null {
  const origem = listaDe(parse(origemRaw));
  if (origem.length === 0) return null;
  const destino = listaDe(parse(destinoRaw));
  const porId = new Map<string, Obj>(destino.map((c) => [c["id"] as string, c]));
  const vindas: string[] = [];
  for (const c of origem) {
    const id = c["id"] as string; const atual = porId.get(id);
    if (atual === undefined || quando(c) > quando(atual)) { porId.set(id, c); vindas.push(id); }
  }
  const lista = [...porId.values()].sort((a, b) => (typeof a["order"] === "number" ? a["order"] : 0) - (typeof b["order"] === "number" ? b["order"] : 0));
  return { json: `${JSON.stringify({ version: 1, conversations: lista }, null, 2)}\n`, vindas };
}

/** Listas de objetos com `url` (favoritos) unem por url, origem primeiro; outras listas unem por valor. */
const unirListas = (destino: unknown[], origem: unknown[]): unknown[] => {
  const chave = (x: unknown): string => (ehObj(x) && typeof x["url"] === "string" ? `url:${x["url"]}` : JSON.stringify(x));
  const vistos = new Set<string>(); const out: unknown[] = [];
  for (const x of [...origem, ...destino]) { const k = chave(x); if (!vistos.has(k)) { vistos.add(k); out.push(x); } }
  return out;
};
/**
 * settings.json: a origem (o app que a pessoa usava por último) prevalece. Mapas (por máquina) unem chave a chave,
 * origem vence; listas unem; `onboarding` fica "done" se qualquer um estava; o resto vem da origem quando ela tem.
 */
export function fundirSettings(destinoRaw: string | null, origemRaw: string | null): string | null {
  const o = parse(origemRaw); if (!ehObj(o)) return null;
  const d0 = parse(destinoRaw); const d: Obj = ehObj(d0) ? { ...d0 } : {};
  for (const [k, vo] of Object.entries(o)) {
    const vd = d[k];
    if (k === "onboarding") { d[k] = vd === "done" || vo === "done" ? "done" : vo; continue; }
    if (Array.isArray(vo) && Array.isArray(vd)) { d[k] = unirListas(vd, vo); continue; }
    if (ehObj(vo) && ehObj(vd)) {
      const m: Obj = { ...vd };
      for (const [h, x] of Object.entries(vo)) m[h] = Array.isArray(x) && Array.isArray(vd[h]) ? unirListas(vd[h] as unknown[], x) : x;
      d[k] = m; continue;
    }
    d[k] = vo;
  }
  return `${JSON.stringify(d, null, 2)}\n`;
}

/** memory.json: fica a mais recente (`updatedAt`); destino vazio recebe a origem. Nunca concatena (limites de tamanho). */
export function fundirMemoria(destinoRaw: string | null, origemRaw: string | null): string | null {
  const o = parse(origemRaw); if (!ehObj(o)) return null;
  const d = parse(destinoRaw);
  const vazio = !ehObj(d) || ((d["notas"] ?? "") === "" && (d["perfil"] ?? "") === "");
  return vazio || quando(o) > quando(d as Obj) ? `${JSON.stringify(o, null, 2)}\n` : null;
}

/** google-whatsapp.json: união dos números já criados no Google (senão o app recriaria contatos); o grupo vem da origem se faltar. */
export function fundirGoogleWhatsapp(destinoRaw: string | null, origemRaw: string | null): string | null {
  const o = parse(origemRaw); if (!ehObj(o)) return null;
  const d = parse(destinoRaw); const dd: Obj = ehObj(d) ? d : {};
  const criados = [...new Set([...(Array.isArray(dd["criados"]) ? dd["criados"] : []), ...(Array.isArray(o["criados"]) ? o["criados"] : [])].filter((x): x is string => typeof x === "string"))];
  return `${JSON.stringify({ ...dd, criados, grupo: typeof dd["grupo"] === "string" ? dd["grupo"] : o["grupo"] ?? null }, null, 2)}\n`;
}

/** Arquivos e pastas que a fusão só copia quando faltam no destino (nunca sobrescreve). */
export const COPIAR_SE_FALTAR = ["google-contatos.json", "google-oauth.json", "suporte.json", "auditoria-entregue.json", "tailscale-policy-backups", "suporte-entrega"] as const;
/** Pastas por máquina (Navegador/<host>, Partitions/navegador-<host>): entram só se a máquina não existe no destino. */
export const POR_MAQUINA = ["Navegador", "Partitions"] as const;
