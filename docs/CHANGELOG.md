# Changelog

O que mudou no meu-bot, em linguagem de quem usa. Cada item é uma frase; detalhe de implementação fica
no [diário técnico](GUIA.md).

> **Sobre a numeração.** O meu-bot foi de 0.4.0 direto para 0.78.4. Não houve 77 versões no meio: o salto
> alinha a numeração com a do Grok Bot, de onde este app nasceu, para dar para comparar os dois lado a
> lado. As quatro releases anteriores (v0.1.0 a v0.4.0-staging.3) não têm entrada própria aqui; esta
> primeira entrada descreve o app inteiro como ele está hoje.

---

## Ainda não lançado

### Tutorial 13: o passo diz o que falta

#### Melhorado

- **"Ver o seu link" diz se a máquina tem o Link Público Global.** Numa máquina em que o admin ainda não instalou o
  global (nginx e o túnel da Cloudflare), o passo dizia só "seu link ainda não está ligado" e "Conferir de novo" não
  achava nada, sem explicar. Agora ele diz que é o admin quem instala (Preparar máquina › Link Público Global) e,
  quando o global existe mas o seu link está desligado, que é só ligar na linha da sua conta.
### Tutorial 11: o código do GitHub se cola sozinho

#### Melhorado

- **Conectar o GitHub sem digitar nem clicar.** O `gh` imprime um código de uso único e a página do GitHub abre no
  Navegador do app; agora, quando ela carrega (depois do login, se precisar), o app passa pelo "Continue" da conta,
  cola o código, envia e autoriza o GitHub CLI, só para o código deste login. O código continua à mostra com o
  "Copiar", para o caso de a página mudar.
- **A aba que o tutorial abre tem o selo "🎓 Tutorial 11"** na tira do Navegador, como as abas que uma conversa está
  usando têm o selo dela; antes aparecia como "da pessoa".
- **O 🤖 do Navegador vem ligado.** O agente podia usar o Navegador só depois de você ligar o 🤖 em cada máquina; agora
  é o padrão, como o 📱 do WhatsApp. Desligar continua lembrado por máquina.
### Voz das respostas numa box apertada

#### Corrigido

- **"A voz alex não passou no teste ()"** numa box com teto de RAM de 2 GB: o Kokoro (vozes dora e alex) precisa de
  ~550 MB de pico, e sem folga a síntese travava por minutos e o teste do OpenClaw caía sem dizer nada. Agora, antes
  de baixar a voz, o instalador confere a folga no teto da conta e diz quanto falta e o que pedir ao admin; e o teste
  mudo explica que a conta pode estar no teto. O admin cria as contas novas com 3 GB.

### Tutorial 11: o Cloudflare acha o Node

#### Corrigido

- **"Esta máquina não tem o Node (npx) para o Cloudflare" numa máquina com OpenClaw para todos.** O wrangler exige
  Node 22 ou mais novo; o do sistema (Debian) é o 20 e vem sem npx, mas o Node 24 do OpenClaw em /opt serve: o tutorial
  passa a procurá-lo e a usá-lo só nesse comando. Quando não há nenhum, a frase diz o que pedir ao admin.

### O app do admin tem nome próprio

#### Melhorado

- **O meu-bot-admin agora se chama meu-bot-admin-gestao.** É o app de gestão: suporte, licenças e plano, espelho das
  máquinas, auditoria e produtos. Na primeira abertura ele traz sozinho as pessoas, configurações e produtos do
  meu-bot-admin antigo, que fica no lugar como cópia de segurança. Quem tinha o meu-bot-admin instalado instala o
  novo uma vez; dali em diante ele se atualiza sozinho.

### Restaurar a cópia do Drive sem sair do app

#### Novo

- **Restaurar a cópia do Drive pela aba Conta Google.** Em "Backup no Drive" › "Restaurar uma cópia…", escolha
  a máquina de origem (pode ser outra, que já morreu) e o que volta: CRM, financeiro, conversas e skills do
  agente, trabalho, credenciais. A cópia entra por cima do que há; cada arquivo substituído fica guardado numa
  pasta de segurança na máquina, e o que só existe nela continua. As conversas antigas do agente aparecem ao
  lado das de hoje. O WhatsApp só é trocado se você marcar "substituir", e o Hermes de uma máquina antiga não
  entra numa máquina OpenClaw (nem o contrário).

### A atualização pergunta antes de interromper, e sabe se recuperar

#### Novo

- **"Parar e atualizar".** Quando a versão nova fica pronta com o bot no meio de uma resposta, o app
  espera. Esgotada a espera, ele mostra a escolha em vez de reiniciar por cima da conversa: parar agora,
  ou deixar a resposta terminar.
- **Mover para Aplicativos.** Abrindo o app de dentro da imagem do instalador, ou de uma pasta sem
  escrita, agora há um botão que copia o app para a pasta Aplicativos e reabre de lá. Antes a tela só
  mandava arrastar.
- **Ações de atualização no menu do aplicativo:** "Verificar atualizações" e, com uma versão pronta,
  "Reiniciar para atualizar".
- **Registro legível do que aconteceu com a atualização.** Cada desfecho — verificou, preparou, trocou,
  voltou atrás, não pegou — entra no modo de depuração com o motivo, em vez de só no log corrido.

#### Melhorado

- O aviso de reiniciar acompanha uma versão mais nova que fique pronta no meio. Antes ele recusava e
  pedia para conferir e clicar de novo.

#### Corrigido

- **WhatsApp no OpenClaw numa conta criada pelo admin não respondia.** A conta usa o Claude Code Global (sem login
  próprio) e o pareamento não gravava o modelo nem punha o porteiro do Claude no gateway: a primeira mensagem dava erro
  de "openai" ou "Not logged in". Agora o pareamento cuida dos dois.
- **A janela da máquina abria errada na 0.78.4:** sem a lateral certa (no admin, a de gestão virava a cara do app
  comum) e sem responder. Um canal novo do "localizar na página" não estava na lista permitida e derrubava a janela
  na abertura. Quem instalou a 0.78.4 recebe esta versão sozinho.
- **O app podia parar de atualizar para sempre dizendo que estava em dia.** Uma versão publicada com o
  arquivo faltando, sem assinatura, ou sem o arquivo desta arquitetura, aparecia como "você está na
  versão mais recente". Agora o app diz o que houve e continua tentando.
- **Disco cheio.** Antes virava um erro genérico e o que já tinha sido baixado ficava ocupando o espaço
  que faltava. Agora o app apaga o que baixou, diz quanto resta livre e para de insistir.
- **Duas contas do Mac usando o app ao mesmo tempo** podiam atrapalhar uma à outra na hora de atualizar,
  a ponto de uma apagar a versão de reserva da outra. Agora elas se revezam.
- **Troca interrompida.** Se o app fosse fechado no meio da atualização, uma das cópias podia sumir e a
  versão de reserva era apagada trinta segundos depois. Agora a cópia é reposta em qualquer abertura, e
  a reserva só sai quando o app está no lugar dela.
- **O conteúdo da versão preparada é reconferido** antes de ser reaproveitado numa abertura seguinte.
- Quando o GitHub limita as consultas, o app diz isso e a que horas libera, em vez de dar um erro
  genérico.

### A casca do app: localizar, atalhos, corretor e aceleração

#### Novo

- **Localizar na página, com ⌘F.** Uma faixa de busca com "3 de 12", ↑ e ↓, e Esc para fechar. Ela segue
  o foco: com o terminal na frente, busca dentro do terminal; com o Navegador, dentro da página aberta;
  no resto, no conteúdo da janela. Com texto selecionado, ele já entra no campo.
- **Folha de atalhos, com ⌘/.** Todos os atalhos do app numa tela só, por assunto. Também em Ajuda ›
  Atalhos de teclado.
- **Corretor ortográfico enquanto você digita.** O erro fica sublinhado e o botão direito mostra as
  sugestões e "Adicionar ao dicionário". O idioma é o do seu Mac. Campos de endereço, código e chave
  continuam de fora. Dá para desligar em Configurações › Texto e desempenho.
- **Preferência de aceleração por hardware.** Desligue se a janela piscar, rasgar ou ficar preta neste
  Mac. Vale depois de fechar e abrir o app.
- O menu Editar agora é completo: desfazer, refazer, recortar, copiar, colar, selecionar tudo,
  Localizar e os comandos de fala do macOS.

#### Corrigido

- **A preferência "atualizar sozinho quando o Mac estiver ocioso" não ficava desligada.** O interruptor
  salvava, mas o app continuava lendo "ligado" e a tela remarcava a caixa no primeiro repinte.

---

## 4 de novembro de 2026

### v0.78.4 · O app de mesa, o WhatsApp e as máquinas

Primeira entrada do changelog. Reúne tudo o que o app faz hoje, depois de 455 mudanças.

#### Novo

**Conversa e janela**

- Uma janela por máquina, como o Cursor com SSH: o app abre num seletor (`local`, `colima`, `agente-box`,
  `grokbot-1`) e cada janela mostra só as conversas daquela máquina.
- Abas de conversa que ficam vivas em segundo plano, com ponto azul quando chega resposta, renomear com
  dois cliques e reordenar arrastando. A ordem e os nomes sobrevivem a fechar o app.
- Paleta de comandos com ⌘K, que acha conversas, ações e configurações.
- Entrada rápida: ⌘⇧Espaço de qualquer app abre uma janelinha e o Enter manda para a conversa ativa.
- Lista lateral com ⌘B, agrupada por data, com busca que ignora acento e arquivar.
- Exportar uma conversa em Markdown ou JSON, e ramificar a partir de qualquer mensagem.
- Resumo contínuo: passando do orçamento de contexto, o meio da conversa vira um resumo gerado em
  segundo plano, e uma memória local de perfil e notas entra em toda mensagem.
- Modo de depuração com uma faixa no topo mostrando build, batimento do processo principal, estado do
  túnel e o que chega de fora.

**WhatsApp**

- O agente atende no WhatsApp por três gateways intercambiáveis: Hermes, OpenClaw e PicoClaw. A pessoa
  escolhe em "Escolha o agente" e pode trocar depois; a tela explica o que cada um não faz.
- Pareamento por QR dentro do app, sem abrir terminal.
- Pausar o agente por contato, por 2 h, 24 h ou até retomar. O que chegou durante a pausa aparece na
  conversa numa bolha tracejada.
- Um dono por agente: quem manda nele, quem ele responde e quem ele ignora, com a regra num lugar só.
- Grupos, marcas nas conversas, renomear contato e "digitando…" enquanto o agente pensa.
- Guarda anti-laço, para o agente não ficar respondendo outro robô sem parar.
- Voz: o agente responde em áudio, com escolha de voz.

**As máquinas**

- O seletor sonda todas as máquinas em paralelo, mostra o estado de cada uma e instala o backend onde
  falta, com um clique.
- Aba Terminal com PTY remoto, várias abas por máquina.
- Aba Navegador com webviews, abas por conversa, espaços, favoritos e uma API para o agente navegar.
- Túnel SSH com ControlMaster, que revalida ao acordar o Mac.
- Botão ⇅ no seletor que preenche o `~/.ssh/config` a partir do arquivo de hosts do projeto.
- Tailscale SSH sem pedir aprovação, detectado pelo seletor e desligável pela API do tailnet.
- Vigia do `tailscaled`, para a máquina não sumir da rede.

**Contas, CRM e dinheiro**

- Conta Google por máquina, com Gmail, Agenda, Planilhas, Contatos e backup no Drive.
- CRM próprio dentro do Gmail, por extensão, aberto pela licença da máquina.
- Financeiro da máquina, com Curva ABC e importação de planilha.
- Licença da máquina com portões por módulo pago.
- Registro de auditoria de quem fez o quê em cada máquina.

**Administração (meu-bot-admin)**

- Aba Usuários que cria contas de login na máquina já com tetos de memória e CPU, para um cliente não
  derrubar os vizinhos.
- Código de suporte, que deixa o admin ver o que a pessoa escolheu mostrar.
- Log ao vivo de criar e preparar um usuário.

**Tutoriais**

- Trilha de tutoriais guiados ao vivo, numerados na ordem, com cartões, "pular" e arquivados.

#### Melhorado

- Streaming real: o texto chega palavra a palavra, e o Claude Code retoma a sessão em vez de reler tudo.
- Corrente de fallback de modelo configurada no backend, com aviso na conversa quando troca.
- Status line no rodapé com modelo, contexto, conta e os limites de 5 h e 7 dias do Claude, avisando ao
  passar de 80, 90 e 95%.
- Quando a máquina não tem a status line, o seletor avisa e oferece instalar, sem travar a abertura.
- O app detecta o que cada máquina sabe fazer por uma tabela de capacidades, nunca pelo nome do
  framework, então um gateway novo entra sem espalhar condição pelo código.
- Fuses do Electron travados no app gerado: sem executar como Node, sem inspeção por linha de comando e
  com integridade do pacote ligada.
- Canal staging ao lado do estável, como o VS Code Insiders, com ícone de faixa laranja, dados e porta
  próprios.
- Atualização automática no app instalado: baixa em segundo plano com retomada e progresso, guarda a
  versão preparada entre aberturas, só instala a versão que o botão mostrou, troca sozinha com o Mac
  ocioso ou ao fechar, e volta para a versão anterior se a nova não abrir.
- Cada zip de release sai com assinatura Ed25519, e o app só instala o que a chave da release assinou,
  sem nunca reassinar.

#### Corrigido

- O estado do WhatsApp aparece rápido ao abrir, sem "desconectado" falso.
- Gerar o QR com a sessão deslogada começa do zero em vez de insistir numa sessão morta.
- Apagar um usuário funciona mesmo com a conta sempre ligada.
- O backend e os plugins da máquina só sobem de versão, nunca rebaixam, mesmo com o estável e o staging
  falando com a mesma máquina.

---

## Antes disto

As releases v0.1.0 (22 de outubro de 2026) a v0.4.0-staging.3 (28 de outubro de 2026) saíram sem
changelog. O histórico está nos commits e nas notas de release do GitHub.
