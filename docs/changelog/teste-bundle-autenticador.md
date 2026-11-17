### Testes: o teste do Autenticador não falha mais em pasta nova
#### Corrigido
- O teste do bundle do Autenticador pulava só quando faltava o Autenticador compilado. Numa pasta nova com o Autenticador e sem o CRM, ele falhava ao ler o manifesto do CRM. Agora pula também quando falta o CRM, com o qual ele compara o id.
