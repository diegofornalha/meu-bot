/** Formas do que vem do host (/v1/crm/*), como o crm-api.js devolve. Só tipos. */
export interface Etapa { key: string; name: string }
export interface Opcao { key: string; name: string }
export type TipoCampo = "TEXT" | "NUMBER" | "DATE" | "DROPDOWN" | "TAG" | "CHECKBOX";
export interface Campo { key: string; name: string; type: TipoCampo; options: Opcao[] }
export interface Pipeline { key: string; name: string; stages: Etapa[]; fields: Campo[]; /** O agente age sem pedir ao dono neste pipeline; hosts antigos não mandam (= false). */ agenteAutonomo?: boolean }
export interface PipelineResumo { key: string; name: string; boxes: number; updatedAt: number; agenteAutonomo?: boolean }
/** Linha da lista de um pipeline (GET /pipelines/:k/boxes). `fields` por chave, valores crus. */
/** Responsável pela caixa (e-mail; nome quando se sabe). */
export interface Responsavel { email: string; nome: string }
export interface CaixaResumo { key: string; name: string; stageKey: string; updatedAt: number; fields: Record<string, unknown>; contatos: number; threads: number; responsaveis?: Responsavel[]; /** Até 3 nomes (ou e-mail/telefone) dos contatos; hosts antigos não mandam. */ pessoas?: string[] }
/** Resumo da conversa do WhatsApp com o contato (gravado pelo agente a cada leitura). */
/** `arquivo`: o consolidado das conversas que o dono limpou no app (guardadas antes no CRM). */
export interface WhatsappResumo { resumo: string; mensagens: number; ultimaEm: number; atualizadoEm: number; arquivo?: { resumo: string; mensagens: number; em: number } }
export interface ContatoView { key: string; nome: string; telefones: string[]; emails: string[]; whatsapp?: WhatsappResumo }
/** Visão enxuta (boxView): `fields` por NOME do campo, já formatados. */
export interface CaixaView { key: string; name: string; stage: string; stageKey: string; notes: string; fields: Record<string, string>; contatos: ContatoView[]; responsaveis?: Responsavel[]; threads: number; lastUpdated: string; criadoEm?: string; etapaDesde?: string; comentarios?: Comentario[] }
export interface Comentario { key: string; em: string; autor: string; texto: string; editadoEm?: string }
export interface ThreadView { threadGmailId: string; assunto: string; nomes: string[]; emails: string[]; mensagens: number | null; em: string }
/** Ficha completa (GET /boxes/:b). */
/** Anexo da caixa (o arquivo fica na máquina do CRM). */
/** Conversa do WhatsApp arquivada traz também nº de mensagens e período (ms). */
export interface Arquivo { key: string; nome: string; tipo: string; tamanho: number; em: string; por: string; mensagens?: number; de?: number; ate?: number }
/** Resumo gerado pelo motor do chat (botão ↻ do cartão Resumo). */
export interface ResumoIA { visaoGeral: string; proximoPasso: string; historico: string; geradoEm: string }
export interface CaixaFicha { box: CaixaView; pipelineKey: string; arquivos?: Arquivo[]; resumoIA?: ResumoIA | null; orgs?: { key: string; nome: string; dominios: string[] }[]; comentarios: Comentario[]; threads: ThreadView[]; contatos: ContatoView[]; notes: string }
export interface Mudanca { seq: number; at: number; tipo: string; pipeline?: string; box?: string; contato?: string; org?: string; thread?: string; por: string }
export interface Feed { seq: number; mudancas: Mudanca[]; reset?: boolean; more?: boolean }
export interface ThreadLookup { key: string; name: string; stageKey: string; stage: string; pipelineKey: string }
export interface Status { ok: boolean; seq: number; pipelines: number; boxes: number; contatos: number; config: { pipelineKey: string | null; pipelineName: string | null } }
/** Caixa entre pipelines, para a Home (GET /boxes?keys= | ?ordem=atividade). */
export interface CaixaHome { key: string; name: string; pipelineKey: string; pipelineName: string; stageKey: string; stage: string; stageIndex: number; updatedAt: number; atividade?: number }
/** Contato na lista/página (GET /contacts, /contacts/:k). */
export interface Contato { key: string; nome: string; emails: string[]; telefones: string[]; cargo: string; notas: string; orgKey: string | null; orgAuto: boolean; linkedin: string; instagram: string; whatsapp: WhatsappResumo | null; google?: { id: string; url: string } | null; arquivos?: Arquivo[]; orgNome: string | null; caixas?: number; pipelines?: string[]; createdAt: number; updatedAt: number }
export interface Org { key: string; nome: string; dominios: string[]; setor: string; funcionarios: string; site: string; endereco: string; telefones: string[]; linkedin: string; instagram: string; notas: string; contatos: number; caixas: number; pipelines: string[]; createdAt: number; updatedAt: number }
export type ThreadDeContato = ThreadView & { boxKey: string; boxName: string };
export interface ContatoPagina { contato: Contato; org: Org | null; boxes: CaixaHome[]; threads: ThreadDeContato[] }
export interface OrgPagina { org: Org; contatos: Contato[]; boxes: CaixaHome[]; threads: ThreadDeContato[] }
export type ContatoPatch = Partial<Pick<Contato, "nome" | "emails" | "telefones" | "cargo" | "notas" | "linkedin" | "instagram">> & { orgKey?: string | null };
export type OrgPatch = Partial<Pick<Org, "nome" | "dominios" | "setor" | "funcionarios" | "site" | "endereco" | "telefones" | "linkedin" | "instagram" | "notas">>;
/** Google Contatos → CRM (no app do Mac): conexão e última sincronização. */
export interface GoogleStatus { configurado: boolean; conectado: boolean; conectando: boolean; escrita?: boolean; precisaReconectar?: boolean; whatsappSalvos?: number | null; whatsappErro?: string | null; email: string | null; sincronizando: boolean; ultimaSync: string | null; total: number | null; criados: number | null; atualizados: number | null; erro: string | null }
