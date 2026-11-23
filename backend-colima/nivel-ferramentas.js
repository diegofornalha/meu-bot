/**
 * Nível de liberdade do agente do WhatsApp (tutorial 7: "só conversa", "consulta e organiza", "age") aplicado no
 * Claude Code do backend. No OpenClaw a trava é do próprio OpenClaw (tools.toolsBySender); no Hermes quem executa é
 * este backend (modelo "whatsapp"), então é aqui que o nível vira `--disallowedTools`. Espelha as listas do OpenClaw
 * (objetivo-core.ts): "conversa" ≈ OTHERS_DENY (nada que escreva ou execute), "consulta" ≈ exec/process/cron/gateway
 * (lê, pesquisa e anota, mas não roda comandos), "age" sem trava. O Navegador fica liberado como no OpenClaw do dono.
 * Lido a cada turno de ~/.local/share/meu-bot/objetivo.json: mudar o nível no app vale na próxima mensagem.
 * Sem objetivo salvo (ou ilegível): "age", o comportamento de antes.
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OBJETIVO = path.join(os.homedir(), '.local', 'share', 'meu-bot', 'objetivo.json');
const NIVEIS = ['conversa', 'consulta', 'age'];

const BLOQUEIO = {
  conversa: ['Bash', 'BashOutput', 'KillShell', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Task'],
  consulta: ['Bash', 'BashOutput', 'KillShell', 'Task'],
  age: [],
};

/** O nível salvo no objetivo.json; "age" quando não há ou é inválido. */
function nivelAtual(arquivo = OBJETIVO) {
  try {
    const v = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    return v && NIVEIS.includes(v.level) ? v.level : 'age';
  } catch (_) { return 'age'; }
}

/** Ferramentas do Claude Code bloqueadas no nível (lista vazia = sem trava). */
const ferramentasBloqueadas = (nivel) => [...(BLOQUEIO[nivel] || [])];

/** A frase que vai junto do system prompt, para o agente explicar a recusa em vez de tentar e falhar calado. */
function avisoDoNivel(nivel) {
  if (nivel === 'conversa') return 'Nível de liberdade no WhatsApp: só conversa. Você não roda comandos nem cria, edita ou apaga arquivos nesta máquina; se pedirem, diga que o dono deixou o agente só para conversa (o nível muda no tutorial 7 do meu-bot).';
  if (nivel === 'consulta') return 'Nível de liberdade no WhatsApp: consulta e organiza. Você pode ler, pesquisar e anotar no seu workspace, mas não roda comandos no sistema; se pedirem, diga que o dono não liberou comandos (o nível muda no tutorial 7 do meu-bot).';
  return '';
}

const HERMES_CONFIG = path.join(os.homedir(), '.hermes', 'config.yaml');

/**
 * O Hermes desta conta responde em áudio quando recebe áudio? É o `voice.auto_tts: true` do ~/.hermes/config.yaml, que
 * o app grava ao ligar "Responder em áudio". Lido sem biblioteca de YAML: a chave `auto_tts` dentro do bloco `voice:`
 * do topo. Sem arquivo, sem o bloco ou ilegível: false.
 */
function vozLigada(arquivo = HERMES_CONFIG) {
  let texto;
  try { texto = fs.readFileSync(arquivo, 'utf8'); } catch (_) { return false; }
  let dentro = false;
  for (const linha of texto.split('\n')) {
    if (/^\S/.test(linha)) { dentro = /^voice:\s*(#.*)?$/.test(linha); continue; }
    if (dentro && /^\s+auto_tts:\s*(true|yes|on)\s*(#.*)?$/i.test(linha)) return true;
  }
  return false;
}

/**
 * A frase que conta ao agente que ele fala. Quem converte a resposta em voz é o Hermes, depois que o modelo escreve; o
 * modelo não fica sabendo e, perguntado, respondia "só respondo em texto" (e no nível "só conversa", "não crio
 * arquivos") num áudio que dizia que não mandava áudio.
 */
function avisoDaVoz(arquivo = HERMES_CONFIG) {
  if (!vozLigada(arquivo)) return '';
  return 'Respostas em áudio: quando a pessoa manda uma mensagem de voz, a sua resposta é convertida em voz e enviada como áudio automaticamente pelo sistema, sem você usar ferramenta nem criar arquivo. Nunca diga que não consegue mandar áudio nem que só responde em texto. A mensagem de texto continua recebendo texto. Ao responder a um áudio, escreva frases corridas, fáceis de ouvir, sem listas, tabelas nem links longos.';
}

module.exports = { OBJETIVO, NIVEIS, nivelAtual, ferramentasBloqueadas, avisoDoNivel, vozLigada, avisoDaVoz };
