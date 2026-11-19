#!/usr/bin/env node
/**
 * crm.mjs — CLI do CRM próprio do meu-bot-crm para o agente da máquina. Substitui o streak.mjs com os mesmos
 * subcomandos e a mesma saída (JSON em uma linha; erro → {"erro": "..."} e código 1), falando com o backend
 * local (/v1/crm/*; ver backend.mjs). Sem chave de API: o CRM é da própria máquina.
 *
 *   diag · pipelines · pipeline [key]
 *   box-find --phone +N | --name "x" | --query "x" | --email e | --thread <gid>  (em todos os pipelines; --pipeline <key> restringe)
 *   box-get <box>
 *   box-create --name "x" [--stage "Etapa"] [--notes "…"] [--phone +N] [--email e]
 *   box-update <box> [--name "x"] [--notes "…"] [--stage "Etapa"]
 *   box-delete <box>
 *   field-set <box> "Campo" "valor"            (listas: pelo nome da opção; datas: dd/mm/aaaa ou ISO)
 *   comment <box> "texto"
 *   contact-upsert --phone +N [--name "x"] [--email e] [--box <box>]
 *   telefone-set +N <box>                       (o telefone passa a ser de um contato vinculado ao box)
 *   threads <box> · thread-add <box> <threadGmailId> · thread-remove <box> <threadGmailId>
 *   pipeline-create --name "x" [--stages "A|B|C"] [--autonomo true|false] · pipeline-set <pipeline> --autonomo true|false
 *   (--autonomo: neste pipeline o agente cria caixa, preenche campos e muda etapa sem perguntar ao dono; quem liga é o
 *   dono, no app: com a chave do agente o backend responde 403 `autonomia_requer_dono` e registra o pedido)
 *   pipeline-rename <pipeline> "Nome" · pipeline-delete <pipeline>
 *   stage-add <pipeline> "Nome" · stage-rename <pipeline> "Atual" "Novo" · stage-remove <pipeline> "Etapa" [--mover "Outra"]
 *   field-add <pipeline> "Nome" TEXT|NUMBER|DATE|DROPDOWN|TAG|CHECKBOX [--options "a|b"]
 *   (pipeline, etapa e campo: só a pedido explícito do dono; os mesmos que o menu ⋯ do Gmail faz)
 *   config [--pipeline <key>] [--silencio N] [--criar-sem-perguntar true|false] [--contexto-whatsapp true|false]
 *   contatos [--q texto] [--org <org>] · contato <contato> · contato-editar <contato> [--name] [--emails "a|b"] [--phones "a|b"] [--cargo] [--notas] [--org <org>|none]
 *   contato-delete <contato>  (sai das caixas, vai para a lixeira)
 *   orgs [--q texto] · org <org> · org-create --name "x" [--dominio d] [--setor s] · org-editar <org> [--name] [--dominios "a|b"] [--setor] [--site] [--notas]
 *   org-delete <org> · box-org-add <box> <org> · box-org-remove <box> <org>
 *   responsaveis <box> ["a@x.com|b@y.com"]  (sem lista: mostra; com lista: substitui; "" tira todos)
 *   arquivos <box> · arquivo-get <box> <arquivo> [--saida caminho] · arquivo-add <box> <caminho> · arquivo-delete <box> <arquivo>
 *   autenticador · autenticador-adicionar --uri otpauth://… | --segredo X [--emissor e] [--conta c] [--agente sim] · autenticador-codigo [emissor|conta|key]
 *   whatsapp-set +N --resumo "…" [--mensagens N] [--ultima <ms>] [--box <box>]  (cartão "Conversa no WhatsApp"; usado pelo crm-job)
 *   (organização: contatos com e-mail do domínio entram sozinhos; gmail/hotmail/uol… não contam)
 */
import { crmApi } from "./backend.mjs";

const out = (o) => { process.stdout.write(`${JSON.stringify(o)}\n`); };
const fail = (msg, code = 1) => { out({ erro: msg }); process.exit(code); };
const argv = process.argv.slice(2);
const cmd = argv[0] ?? "";
const pos = []; const opt = {};
for (let i = 1; i < argv.length; i++) { const a = argv[i]; if (a.startsWith("--")) { const k = a.slice(2); const v = argv[i + 1]; if (v !== undefined && !v.startsWith("--")) { opt[k] = v; i++; } else opt[k] = true; } else pos.push(a); }
const q = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v)); const s = p.toString(); return s === "" ? "" : `?${s}`; };
const enc = encodeURIComponent;
const api = (m, p, b) => crmApi(m, p, b, { por: "agente" });
/** --autonomo true|false → boolean; ausente → undefined; qualquer outro valor é erro (não vira false calado). */
const autonomo = () => { if (opt.autonomo === undefined) return undefined; if (opt.autonomo !== "true" && opt.autonomo !== "false") throw new Error("--autonomo aceita true ou false"); return opt.autonomo === "true"; };

/** Pipeline escolhido: --pipeline, senão o configurado em crm.json (lido do backend). */
async function pipelineKey() {
  if (typeof opt.pipeline === "string" && opt.pipeline !== "") return opt.pipeline;
  // O backend resolve o padrão (inclusive "um pipeline só: é ele"); aqui só se lê.
  const c = await api("GET", "/config");
  if (typeof c.pipelineKey === "string" && c.pipelineKey !== "") return c.pipelineKey;
  throw new Error(c.pipelineKeyInvalido ? `o pipeline padrão (${c.pipelineKeyInvalido}) não existe no CRM próprio; escolha um com \`config --pipeline <key>\` ou importe-o do Streak` : "nenhum pipeline padrão: escolha um com `config --pipeline <key>` (veja `pipelines`)");
}

async function main() {
  switch (cmd) {
    case "diag": {
      const st = await api("GET", "/status");
      const ps = await api("GET", "/pipelines");
      let pipeline = null; if (st.config.pipelineKey) { try { pipeline = await api("GET", `/pipelines/${enc(st.config.pipelineKey)}`); } catch (e) { pipeline = { erro: e.message }; } }
      return out({ ok: true, usuario: null, pipelines: ps.pipelines, pipeline, silencioMin: st.config.silencioMin, criarSemPerguntar: st.config.criarSemPerguntar, boxes: st.boxes, seq: st.seq });
    }
    case "pipelines": return out({ pipelines: (await api("GET", "/pipelines")).pipelines.map((p) => ({ key: p.key, name: p.name, boxes: p.boxes, agenteAutonomo: p.agenteAutonomo === true })) });
    case "pipeline": return out(await api("GET", `/pipelines/${enc(pos[0] ?? await pipelineKey())}`));
    case "box-find": {
      // Procura em todos os pipelines (a pessoa pode estar em qualquer um); --pipeline <key> restringe a um.
      const key = typeof opt.pipeline === "string" && opt.pipeline !== "" ? opt.pipeline : "*";
      const qq = {}; for (const k of ["phone", "name", "query", "email", "thread"]) if (typeof opt[k] === "string") qq[k] = opt[k];
      if (Object.keys(qq).length === 0) throw new Error("use --phone, --name, --query, --email ou --thread");
      return out(await api("GET", `/search${q({ pipeline: key, ...qq })}`));
    }
    case "box-get": { if (!pos[0]) throw new Error("uso: box-get <box>"); return out(await api("GET", `/boxes/${enc(pos[0])}`)); }
    case "box-create": {
      const key = await pipelineKey();
      if (typeof opt.name !== "string" || opt.name.trim() === "") throw new Error("--name é obrigatório");
      const body = { name: opt.name.trim() };
      if (typeof opt.stage === "string") body.stage = opt.stage;
      if (typeof opt.notes === "string") body.notes = opt.notes;
      if (typeof opt.phone === "string") body.phone = opt.phone;
      if (typeof opt.email === "string") body.email = opt.email;
      return out(await api("POST", `/pipelines/${enc(key)}/boxes`, body));
    }
    case "box-update": {
      const box = pos[0]; if (!box) throw new Error("informe a chave do box");
      const body = {};
      if (typeof opt.name === "string") body.name = opt.name;
      if (typeof opt.notes === "string") body.notes = opt.notes;
      if (typeof opt.stage === "string") body.stage = opt.stage;
      if (Object.keys(body).length === 0) throw new Error("nada para mudar (--name, --notes, --stage)");
      return out(await api("PATCH", `/boxes/${enc(box)}`, body));
    }
    case "box-delete": { if (!pos[0]) throw new Error("uso: box-delete <box>"); await api("DELETE", `/boxes/${enc(pos[0])}`); return out({ ok: true, box: pos[0] }); }
    case "field-set": {
      const [box, campo, ...rest] = pos; const valor = rest.join(" ");
      if (!box || !campo || valor === "") throw new Error("uso: field-set <box> \"Campo\" \"valor\"");
      const r = await api("PATCH", `/boxes/${enc(box)}`, { fields: { [campo]: valor } });
      const nome = Object.keys(r.box.fields).find((n) => n.toLowerCase() === campo.toLowerCase()) ?? campo;
      return out({ ok: true, box, campo: nome, valor });
    }
    case "comment": {
      const [box, ...rest] = pos; const texto = rest.join(" ").trim();
      if (!box || texto === "") throw new Error("uso: comment <box> \"texto\"");
      const r = await api("POST", `/boxes/${enc(box)}/comments`, { texto, autor: "agente" });
      return out({ ok: true, box, comentario: r.comentario });
    }
    case "contact-upsert": {
      if (typeof opt.phone !== "string" && typeof opt.email !== "string") throw new Error("informe --phone ou --email");
      const body = {}; if (typeof opt.name === "string") body.name = opt.name; if (typeof opt.phone === "string") body.phone = opt.phone; if (typeof opt.email === "string") body.email = opt.email; if (typeof opt.box === "string") body.box = opt.box;
      const r = await api("POST", "/contacts", body);
      return out({ ok: true, contato: r.contato, vinculado: r.vinculado });
    }
    case "contatos": return out(await api("GET", `/contacts${q({ q: opt.q, org: opt.org, limit: opt.limit ?? 50 })}`));
    case "contato": { if (!pos[0]) throw new Error("uso: contato <contato>"); return out(await api("GET", `/contacts/${enc(pos[0])}`)); }
    case "contato-editar": {
      if (!pos[0]) throw new Error("uso: contato-editar <contato> [--name] [--emails a|b] [--phones a|b] [--cargo] [--notas] [--org <org>|none]");
      const b = {}; if (typeof opt.name === "string") b.nome = opt.name; if (typeof opt.emails === "string") b.emails = opt.emails.split("|").map((x) => x.trim()).filter(Boolean); if (typeof opt.phones === "string") b.telefones = opt.phones.split("|").map((x) => x.trim()).filter(Boolean);
      for (const k of ["cargo", "notas", "linkedin", "instagram"]) if (typeof opt[k] === "string") b[k] = opt[k];
      if (typeof opt.org === "string") b.orgKey = opt.org === "none" ? null : opt.org;
      return out(await api("PATCH", `/contacts/${enc(pos[0])}`, b));
    }
    case "contato-delete": { if (!pos[0]) throw new Error("uso: contato-delete <contato>"); return out(await api("DELETE", `/contacts/${enc(pos[0])}`)); }
    case "orgs": return out(await api("GET", `/orgs${q({ q: opt.q, limit: opt.limit ?? 50 })}`));
    case "org": { if (!pos[0]) throw new Error("uso: org <org>"); return out(await api("GET", `/orgs/${enc(pos[0])}`)); }
    case "org-create": {
      if (typeof opt.name !== "string" && typeof opt.dominio !== "string") throw new Error("uso: org-create --name \"x\" [--dominio d] [--setor s]");
      const b = {}; if (typeof opt.name === "string") b.nome = opt.name; if (typeof opt.dominio === "string") b.dominio = opt.dominio; for (const k of ["setor", "site", "funcionarios", "notas"]) if (typeof opt[k] === "string") b[k] = opt[k];
      return out(await api("POST", "/orgs", b));
    }
    case "org-editar": {
      if (!pos[0]) throw new Error("uso: org-editar <org> [--name] [--dominios a|b] [--setor] [--site] [--notas]");
      const b = {}; if (typeof opt.name === "string") b.nome = opt.name; if (typeof opt.dominios === "string") b.dominios = opt.dominios.split("|").map((x) => x.trim()).filter(Boolean);
      for (const k of ["setor", "site", "funcionarios", "endereco", "notas", "linkedin", "instagram"]) if (typeof opt[k] === "string") b[k] = opt[k];
      return out(await api("PATCH", `/orgs/${enc(pos[0])}`, b));
    }
    case "org-delete": { if (!pos[0]) throw new Error("uso: org-delete <org>"); return out(await api("DELETE", `/orgs/${enc(pos[0])}`)); }
    case "box-org-add": { if (!pos[0] || !pos[1]) throw new Error("uso: box-org-add <box> <org>"); return out(await api("POST", `/boxes/${enc(pos[0])}/orgs`, { key: pos[1] })); }
    case "box-org-remove": { if (!pos[0] || !pos[1]) throw new Error("uso: box-org-remove <box> <org>"); return out(await api("DELETE", `/boxes/${enc(pos[0])}/orgs/${enc(pos[1])}`)); }
    case "whatsapp-set": {
      if (!pos[0] || typeof opt.resumo !== "string") throw new Error('uso: whatsapp-set +N --resumo "…" [--mensagens N] [--ultima <ms>] [--box <box>]');
      return out(await api("PUT", "/contacts/whatsapp", { phone: pos[0], resumo: opt.resumo, ...(opt.mensagens !== undefined ? { mensagens: Number(opt.mensagens) } : {}), ...(opt.ultima !== undefined ? { ultimaEm: Number(opt.ultima) } : {}), ...(typeof opt.box === "string" ? { box: opt.box } : {}) }));
    }
    case "responsaveis": {
      if (!pos[0]) throw new Error('uso: responsaveis <box> ["a@x.com|b@y.com"]');
      if (pos[1] === undefined) { const f = await api("GET", `/boxes/${enc(pos[0])}`); return out({ box: pos[0], responsaveis: f.box?.responsaveis ?? [] }); }
      const r = await api("PATCH", `/boxes/${enc(pos[0])}`, { responsaveis: pos[1].split("|").map((x) => x.trim()).filter(Boolean) });
      return out({ ok: true, box: pos[0], responsaveis: r.box?.responsaveis ?? [] });
    }
    case "arquivos": { if (!pos[0]) throw new Error("uso: arquivos <box>"); return out(await api("GET", `/boxes/${enc(pos[0])}/files`)); }
    case "arquivo-get": {
      if (!pos[0] || !pos[1]) throw new Error("uso: arquivo-get <box> <arquivo> [--saida caminho]");
      const r = await api("GET", `/boxes/${enc(pos[0])}/files/${enc(pos[1])}`);
      const { writeFileSync } = await import("node:fs"); const destino = typeof opt.saida === "string" ? opt.saida : `/tmp/${r.nome.replace(/[\\/]/g, "_")}`;
      writeFileSync(destino, Buffer.from(r.base64, "base64"), { mode: 0o600 });
      return out({ ok: true, nome: r.nome, tipo: r.tipo, tamanho: r.tamanho, salvoEm: destino });
    }
    case "arquivo-add": {
      if (!pos[0] || !pos[1]) throw new Error("uso: arquivo-add <box> <caminho>");
      const { readFileSync } = await import("node:fs"); const { basename } = await import("node:path");
      return out(await api("POST", `/boxes/${enc(pos[0])}/files`, { nome: basename(pos[1]), base64: readFileSync(pos[1]).toString("base64") }));
    }
    case "arquivo-delete": { if (!pos[0] || !pos[1]) throw new Error("uso: arquivo-delete <box> <arquivo>"); return out(await api("DELETE", `/boxes/${enc(pos[0])}/files/${enc(pos[1])}`)); }
    case "telefone-set": { if (!pos[0] || !pos[1]) throw new Error("uso: telefone-set +N <box>"); const r = await api("POST", "/contacts", { phone: pos[0], box: pos[1] }); return out({ ok: true, contato: r.contato }); }
    case "threads": { if (!pos[0]) throw new Error("uso: threads <box>"); return out(await api("GET", `/boxes/${enc(pos[0])}/threads`)); }
    case "thread-add": {
      const [box, gid] = pos; if (!box || !gid) throw new Error("uso: thread-add <box> <threadGmailId>");
      try { return out(await api("PUT", `/boxes/${enc(box)}/threads`, { threadGmailId: gid })); }
      catch (e) { if (e.status === 409 && e.box) throw new Error(`a conversa já está no box "${e.box.name}" (${e.box.key}); uma conversa só pode estar em um box`); throw e; }
    }
    case "thread-remove": { const [box, gid] = pos; if (!box || !gid) throw new Error("uso: thread-remove <box> <threadGmailId>"); await api("DELETE", `/boxes/${enc(box)}/threads/${enc(gid)}`); return out({ ok: true }); }
    case "pipeline-create": {
      if (typeof opt.name !== "string" || opt.name.trim() === "") throw new Error("--name é obrigatório");
      const stages = typeof opt.stages === "string" ? opt.stages.split("|").map((s) => s.trim()).filter(Boolean) : [];
      const auto = autonomo();
      return out(await api("POST", "/pipelines", { name: opt.name.trim(), stages, ...(auto !== undefined ? { agenteAutonomo: auto } : {}) }));
    }
    case "pipeline-set": {
      const pk = pos[0]; const auto = autonomo();
      if (!pk || auto === undefined) throw new Error("uso: pipeline-set <pipeline> --autonomo true|false");
      return out(await api("PATCH", `/pipelines/${enc(pk)}`, { agenteAutonomo: auto }));
    }
    case "stage-add": {
      const [pk, nome] = pos; if (!pk || !nome) throw new Error("uso: stage-add <pipeline> \"Nome\"");
      const p = await api("GET", `/pipelines/${enc(pk)}`);
      return out(await api("PATCH", `/pipelines/${enc(pk)}`, { stages: [...p.stages, { name: nome }] }));
    }
    case "pipeline-rename": {
      const [pk, nome] = pos; if (!pk || !nome) throw new Error("uso: pipeline-rename <pipeline> \"Nome\"");
      return out(await api("PATCH", `/pipelines/${enc(pk)}`, { name: nome }));
    }
    case "pipeline-delete": {
      const pk = pos[0]; if (!pk) throw new Error("uso: pipeline-delete <pipeline> (só pipeline sem caixas)");
      await api("DELETE", `/pipelines/${enc(pk)}`); return out({ ok: true, pipeline: pk });
    }
    case "stage-rename": {
      const [pk, atual, novo] = pos; if (!pk || !atual || !novo) throw new Error("uso: stage-rename <pipeline> \"Atual\" \"Novo\"");
      const p = await api("GET", `/pipelines/${enc(pk)}`);
      const alvo = p.stages.find((s) => s.name.toLowerCase() === atual.toLowerCase() || s.key === atual);
      if (!alvo) throw new Error(`etapa "${atual}" não existe; etapas: ${p.stages.map((s) => s.name).join(" | ")}`);
      return out(await api("PATCH", `/pipelines/${enc(pk)}`, { stages: p.stages.map((s) => (s.key === alvo.key ? { key: s.key, name: novo } : s)) }));
    }
    case "stage-remove": {
      const [pk, etapa] = pos; if (!pk || !etapa) throw new Error("uso: stage-remove <pipeline> \"Etapa\" [--mover \"Outra\"]");
      const p = await api("GET", `/pipelines/${enc(pk)}`);
      const alvo = p.stages.find((s) => s.name.toLowerCase() === etapa.toLowerCase() || s.key === etapa);
      if (!alvo) throw new Error(`etapa "${etapa}" não existe; etapas: ${p.stages.map((s) => s.name).join(" | ")}`);
      return out(await api("PATCH", `/pipelines/${enc(pk)}`, { stages: p.stages.filter((s) => s.key !== alvo.key), ...(typeof opt.mover === "string" ? { moverPara: opt.mover } : {}) }));
    }
    case "field-add": {
      const [pk, nome, tipo] = pos; if (!pk || !nome) throw new Error("uso: field-add <pipeline> \"Nome\" TEXT|NUMBER|DATE|DROPDOWN|TAG|CHECKBOX [--options \"a|b\"]");
      const p = await api("GET", `/pipelines/${enc(pk)}`);
      const options = typeof opt.options === "string" ? opt.options.split("|").map((s) => s.trim()).filter(Boolean) : [];
      return out(await api("PATCH", `/pipelines/${enc(pk)}`, { fields: [...p.fields, { name: nome, type: tipo ?? "TEXT", options }] }));
    }
    case "config": {
      const body = {};
      if (typeof opt.pipeline === "string") body.pipelineKey = opt.pipeline;
      if (typeof opt.silencio === "string") body.silencioMin = Number(opt.silencio);
      if (typeof opt["criar-sem-perguntar"] === "string") body.criarSemPerguntar = opt["criar-sem-perguntar"] === "true";
      if (typeof opt["contexto-whatsapp"] === "string") body.contextoWhatsapp = opt["contexto-whatsapp"] === "true";
      return out(Object.keys(body).length === 0 ? await api("GET", "/config") : await api("PUT", "/config", body));
    }
    case "chave-set": throw new Error("o meu-bot-crm não usa chave do Streak: o CRM é desta máquina. Para trazer um pipeline do Streak, rode importar-streak.mjs");
    // Autenticador (códigos de 2 etapas; vem com todo meu-bot, não precisa do CRM): o segredo entra e nunca sai.
    case "autenticador": return out(await api("GET", "/autenticador"));
    case "autenticador-adicionar": {
      const corpo = typeof opt.uri === "string" ? { uri: opt.uri } : { segredo: opt.segredo, ...(typeof opt.emissor === "string" ? { emissor: opt.emissor } : {}), ...(typeof opt.conta === "string" ? { conta: opt.conta } : {}) };
      if (corpo.uri === undefined && typeof corpo.segredo !== "string") throw new Error("use --uri otpauth://… ou --segredo <chave> [--emissor Google] [--conta e-mail]");
      return out(await api("POST", "/autenticador", { ...corpo, agente: opt.agente === true || opt.agente === "sim" }));
    }
    case "autenticador-codigo": {
      const q = String(pos[0] ?? "").toLowerCase();
      const r = await api("GET", "/autenticador/codigos");
      const lista = r.codigos ?? r.contas ?? [];
      const achados = q === "" ? lista : lista.filter((c) => c.key === pos[0] || `${c.emissor ?? ""} ${c.conta ?? ""}`.toLowerCase().includes(q));
      return out({ codigos: achados });
    }
    default: throw new Error(`comando desconhecido: ${cmd || "(vazio)"}; veja o cabeçalho do crm.mjs`);
  }
}
main().catch((e) => fail(e instanceof Error ? e.message : String(e), e && e.code === "backend_fora" ? 3 : e && e.code === "crm_license" ? 2 : 1));
