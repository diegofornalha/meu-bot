# Contornos de limitações do Hermes e do OpenClaw

## Regra (30 out)

Todo pedaço do meu-bot que **contorna** uma limitação de ferramenta de terceiros (Hermes, OpenClaw) entra nesta
tabela e leva um cabeçalho padrão no código. O objetivo é poder **apagar o contorno** no dia em que a ferramenta
trouxer a função, sem arqueologia: a tabela diz o que é nosso, o que seria o nativo, qual issue acompanha e,
principalmente, **como saber que já dá para tirar** (um critério verificável por comando ou pela sonda, não uma
opinião). O app prefere o nativo quando ele existir: a decisão é por **capacidade** (`whatsapp-capacidades.ts`),
nunca por versão fixa.

Cabeçalho no código (acima da função, constante ou no topo do arquivo), texto exato:

```
CONTORNO #N (Hermes): <limitação> (<issue>).
O que fazemos: <uma frase>.
Sai quando: <critério verificável>.
Tabela: docs/guia/contornos.md.
```

O teste `scripts/tests/contornos.test.mjs` confere que todo `CONTORNO #N` do código está na tabela (e vice-versa) e
que cada cabeçalho diz "Sai quando:".

## Tabela

| # | Limitação | O que fizemos | Onde mora | Issue upstream | Sai quando (verificável) | O que se perde ao remover |
|---|---|---|---|---|---|---|
| 1 | O Hermes não tem pausa por contato no WhatsApp (só a lista `WHATSAPP_ALLOWED_USERS`, lida na subida do gateway) | Pausar = tirar o número da lista e reiniciar o gateway; retomar = devolver (PR #16). Fora da lista aparece "pausado"; retomar em "só você" vira "você + ele" | `hermesPausaPlano` e `hermesNaoResponde` (`whatsapp-hermes-core.ts`), `aplicarPlanoAllowlist` (`whatsapp.ts`), filtro de pausados em `setDmPolicyHermes`/`lerGateway` | [NousResearch/hermes-agent#146672](https://github.com/NousResearch/hermes-agent/issues/146672) | Toda máquina Hermes do mapa com `pausaplugin` (#2) ou `pausanativa=1` no status: o ramo `"allowlist"` de `hermesPausaModo` some e estas funções com ele | Pausar numa máquina sem o plugin |
| 2 | Idem, e além disso: sem prazo, o agente nem vê as mensagens do pausado, e não dá para pedir pelo WhatsApp | Plugin do Hermes `meu-bot-pausa` no hook `pre_gateway_dispatch`: descarta a mensagem de quem está pausado lendo a marca do app (`whatsapp-lista.json › paused`, com `ate`), guarda o que chegou em `whatsapp-pausados.jsonl`, entrega ao agente numa nota só ao retomar; `/pausar 2h\|24h`, `/retomar`, `/pausados`. Desde a 1.2.0 também dá ao agente a ferramenta `audio_da_conversa`, que liga o modo de voz por conversa do Hermes (o do `/voice off`) quando o contato pede "só texto": sem ela o gateway continua mandando áudio depois de o agente prometer que não. O app mostra o que chegou na pausa e pausa só pela marca quando o plugin está carregado | `backend-colima/hermes-plugins/meu-bot-pausa/`, `whatsapp-hermes-pausa-core.ts` (instalação), `HERMES_PAUSA_SH`/`hermesPausaModo` (`whatsapp-hermes-core.ts`), `whatsapp-pausados.ts`, `capacidadesDe(…, { pausaModo })` | [#146672](https://github.com/NousResearch/hermes-agent/issues/146672) | `pausanativa=1` no status do WhatsApp. Hoje a sonda é um palpite declarado (`hermes whatsapp --help` cita "pause"); trocar pelo sinal real da release que fechar a issue. Aí `hermesPausaPluginRemoverSh` tira o plugin | As mensagens recebidas na pausa visíveis no app e a nota única ao retomar, se o nativo não as der |
| 3 | `hermes pm install --extra stt-whisper` recusa num usuário novo de Hermes global (/opt/hermes): "tools not on PATH before venv sync: ffmpeg, ripgrep" — as ferramentas são por `HERMES_HOME` | `hermesPmExtraSh` instala só as ferramentas que ele listou e tenta de novo (sem `--tools-only`, que traria o Chromium) | `hermesPmExtraSh` (`whatsapp-hermes-core.ts`) | a abrir (anotar o número aqui) | `hermes pm install --extra stt-whisper` sair 0 num usuário recém-criado de Hermes global, sem o passo extra (teste manual no admin: criar usuário → Ativar transcrição numa máquina sem `/opt/transcriber`) | Nada: só a segunda tentativa |
| 4 | Cada usuário baixava o próprio transcritor e modelo (~1,5 GB) e rodava um Whisper por gateway | Transcritor compartilhado em `/opt/transcriber` (root, 755) e cada Hermes aponta por `HERMES_LOCAL_STT_COMMAND` (`local_command`) | `transcritorSh` (`usuarios-core.ts`), `hermesSttLigarSh`, `HERMES_STT_COMPARTILHADO_SH` (`whatsapp-hermes-core.ts`) | sem issue (desenho de produto, não bug) | O Hermes oferecer STT compartilhado entre `HERMES_HOME`s | RAM e disco por usuário |

| 5 | Em modo `bot` o bridge descarta tudo que vem do próprio aparelho; em `self-chat` só atende o próprio chat. Não há modo que atenda a pessoa no próprio chat **e** outros contatos | O conceito **dono** (`whatsapp-lista.json › dono`): com dono ≠ pareado, "só eu" vira `bot` + allowlist [pareado, dono] e a pessoa fala do celular dela; com dono == pareado, os cartões Lista/Todo mundo avisam | `hermesEnvPara` (`whatsapp-hermes-core.ts`), `REPLY_OPTIONS`/`renderReplyCards` (aviso), `quemDe` (`whatsapp-marks.ts`) | a abrir: "WhatsApp bot mode: opt-in to also answer the owner's self-chat (fromMe)" (anotar o número aqui) | O Hermes aceitar self-chat em modo bot (chave do tipo `WHATSAPP_SELF_CHAT` junto de `MODE=bot` no `hermes whatsapp --help` ou no `.env.example`): "self" grava bot sempre e o aviso some | O aviso nos cartões e o modo bot forçado em "só eu" com dono ≠ pareado |
| 6 | O lançador npm do Hermes (`lib/python-launcher.js`) não repassa SIGTERM ao filho Python; com `KillMode=mixed` o systemd mata só o Node e dá SIGKILL no gateway e no bridge (log "exited UNCLEANLY" a cada reinício) | O atalho do serviço (`<código>/.hermes/bin/hermes`) dá `exec` direto em `venv/bin/hermes`, reproduzindo o ambiente do lançador; sem o venv, cai no `/usr/local/bin/hermes`. O reinício pelo systemd passa a fazer o desligamento limpo | `hermesGlobalSh` (`usuarios-core.ts`) | a abrir: "npm launcher (lib/python-launcher.js) does not forward SIGTERM to the Python child; systemd KillMode=mixed SIGKILLs the gateway" (anotar o número aqui) | `grep -q 'process.on("SIGTERM"' /opt/hermes/lib/node_modules/hermes-agent/lib/python-launcher.js` achar: o atalho volta a ser `exec /usr/local/bin/hermes` | Nada: só o desligamento limpo se o lançador não repassar |
| 7 | O gateway do Hermes não tem "responder em áudio sempre" como padrão (só por conversa, `/voice tts`) nem "mandar só o áudio": no WhatsApp o texto vai sempre depois do áudio (só o Telegram pula, pela legenda) | A escolha do painel fica na marca do app (`whatsapp-lista.json › audio`). O plugin `meu-bot-pausa` (≥ 1.3.0) liga o modo `all` na conversa sem modo escolhido e embrulha `send_voice`, `_play_tts_file` e `_send_final_text` do adapter: o texto só é pulado quando o áudio da conversa acabou de sair com sucesso | `hermesAudioMarcaSh` (`whatsapp-hermes-core.ts`), `_aplicar_sempre` e `_embrulhar_so_audio` (`hermes-plugins/meu-bot-pausa/__init__.py`) | a abrir (anotar o número aqui) | `voice.auto_tts` aceitar "always" e existir uma chave para não mandar o texto junto do áudio no `config_defaults.py` do Hermes (`grep -n "audio_only\|auto_tts" hermes_cli/config_defaults.py`) | "Sempre" e "Só o áudio" somem do painel do Hermes; o eco da transcrição continua desligável (`stt.echo_transcripts`, nativo) |

Candidatas a entrar (ainda sem cabeçalho): `hermesPrecisaReiniciar` (o gateway não relê o `.env`, nem a lista —
[#146672](https://github.com/NousResearch/hermes-agent/issues/146672)); porta do bridge por uid (`portaBridgeHermes`).

## Como o app decide (30 out)

`hermesPausaModo` (`whatsapp-hermes-core.ts`) lê três linhas da sonda `HERMES_PAUSA_SH`: `pausaplugin` (versão no
`.ok` do plugin), `pausavivo` (versão que o `register()` do plugin gravou ao carregar) e `pausanativa`. Nativa vence
plugin, que vence allowlist; plugin só conta quando instalado **e** carregado na mesma versão (entre instalar e o
gateway reiniciar, o app ainda pausa pela lista — sem janela de "pausei e nada aconteceu"). `capacidadesDe` traduz em
`pausaPrazo` (menu com 2 h / 24 h / até retomar; pausa só pela marca) e `pausaNativa`. Remover o contorno #2 é:
trocar a sonda `pausanativa` pelo sinal real, confirmar que o nativo dá o que a tabela diz que se perde, e deixar
`ensureHermesPausa` (picker.ts/client.ts) parar de instalar quando `pausanativa=1` (já faz: a capacidade `pausaPrazo`
fica verdadeira e ele não instala).
