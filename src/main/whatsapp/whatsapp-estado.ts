/**
 * O que o main lembra de cada máquina entre consultas do WhatsApp: o motor visto por último, o modo de pausa do Hermes,
 * o cache de nomes dos contatos e as leituras guardadas (status, lista, grupos). Os adaptadores de motor gravam aqui
 * o que descobrem; a fachada (whatsapp.ts) lê. Nada aqui fala com a máquina.
 */
import type { Gateway, WhatsappAlvoResolvido, WhatsappChat, WhatsappGroups, WhatsappStatus } from "../../shared/ipc";
import type { HermesPausaModo } from "./whatsapp-hermes-core";
import { TtlCache } from "./whatsapp-cache-core";

/** Gateway visto na última consulta de cada máquina (status ou lista): decide o menu "…" e o leitor da conversa. */
export const gatewayByHost = new Map<string, Gateway>();
export const whatsappGatewayOf = (host: string): Gateway | null => gatewayByHost.get(host) ?? null;
/** Como a pausa por contato é feita em cada máquina Hermes, visto na última consulta (status ou lista); desconhecido = allowlist. */
export const pausaModoByHost = new Map<string, HermesPausaModo>();
export const whatsappPausaModoOf = (host: string): HermesPausaModo => pausaModoByHost.get(host) ?? "allowlist";
/** Onde vive o WhatsApp de cada máquina (conta, agente, gateway), visto na última consulta; ausente = o padrão (próprio). */
export const alvoByHost = new Map<string, WhatsappAlvoResolvido>();
/** Nomes (pushname) dos contatos vistos nesta sessão, por máquina. */
const chatNames = new Map<string, Map<string, string>>();
export const namesOf = (host: string): Map<string, string> => { let m = chatNames.get(host); if (m === undefined) { m = new Map(); chatNames.set(host, m); } return m; };

/**
 * Validade das leituras guardadas por máquina (whatsapp-cache-core.ts). O status custa uma chamada da CLI na máquina
 * (~300 MB, 1-3 s) e as janelas perguntam a cada 1-2 min: dentro da validade, a resposta é a de antes; quem muda algo
 * (parear, política, dono, pausa, marcas, grupos) chama `esquecerWhatsapp` e a próxima leitura vai à máquina.
 */
export const STATUS_VALIDADE_MS = 45_000;
export const CHATS_VALIDADE_MS = 15_000;
export const GROUPS_VALIDADE_MS = 30_000;
export const statusCache = new TtlCache<WhatsappStatus>();
export const chatsCache = new TtlCache<WhatsappChat[]>();
export const groupsCache = new TtlCache<WhatsappGroups>();
/** Esquece o que está guardado da máquina (depois de qualquer mudança feita por aqui). */
export function esquecerWhatsapp(host: string): void { statusCache.esquecer(host); chatsCache.esquecer(host); groupsCache.esquecer(host); }
