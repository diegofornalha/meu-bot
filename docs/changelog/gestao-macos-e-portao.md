### Gestão: avisos certos para um Mac e nenhuma conexão sem admin logado
#### Corrigido
- meu-bot-admin-gestao: numa máquina que é um Mac (o próprio Mac como pessoa do suporte), o WhatsApp aparecia como "gateway fora do ar" com o gateway rodando. Os comandos por SSH agora funcionam no macOS como já funcionavam no Mac local.
- meu-bot-admin-gestao: a página Suporte dizia "sem status line" quando a máquina tinha outra status line (a global do Mac). Agora diz que ela é de outra origem e que os limites do Claude não chegam ao meu-bot.
- meu-bot-admin-gestao: sem uma conta de admin logada, o app ainda lia o plano das pessoas e retomava a preparação de contas nas máquinas. Agora não conecta em nenhuma máquina até um admin entrar.
