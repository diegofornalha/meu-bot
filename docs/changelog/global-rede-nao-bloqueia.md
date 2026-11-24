### Claude Code Global: queda de rede não bloqueia mais a conta
#### Corrigido
- Uma falha de rede passageira ao falar com a Anthropic era gravada como problema no login do root, e a conta ficava bloqueada até alguém desbloqueá-la no admin; os agentes da máquina ficavam sem responder. Agora só um login recusado de verdade bloqueia a conta. Para valer numa máquina que já tem o Global, reinstale-o pelo admin.
