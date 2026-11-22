### Este Windows num PC sem virtualização
#### Corrigido
- "Preparar este Windows" agora também liga o WSL1, que é o que roda num PC sem virtualização (uma máquina virtual, ou o recurso desligado na BIOS); antes o preparo parava no import do Linux.
- No Linux do "Este Windows", o agente volta sozinho quando o app abre depois de o Windows reiniciar.
- Em máquinas sem systemd, instalar ou atualizar o agente não deixa mais a instalação pendurada no fim.
