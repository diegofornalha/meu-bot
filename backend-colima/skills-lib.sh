#!/usr/bin/env bash
# Biblioteca dos instaladores do meu-bot: põe uma skill semente nos destinos dos agentes desta máquina. Não roda
# sozinha: cada install-*.sh que instala skill a carrega (`. "$HERE/skills-lib.sh"`) e o app a envia junto com ele
# (SKILLS_LIB em src/main/maquina/backend-bundle-core.ts). Fonte única: não copie esta lógica para um instalador.
#
# Destinos: ~/.claude/skills (Claude Code) e, em máquina com Hermes (~/.hermes existe), também ~/.hermes/skills, que
# é onde o Hermes as lê. A biblioteca nunca cria ~/.hermes.
#
# A skill é semente: o agente pode editar a dele. Ao lado de cada SKILL.md fica .semente.sha256, o hash da semente
# instalada. Na reinstalação: SKILL.md igual a esse hash é cópia intocada e recebe a semente nova; diferente, o agente
# editou e fica como está; sem o arquivo de hash (instalação de antes dele) não dá para saber, então também fica, a
# não ser que o instalador diga como reconhecer a cópia antiga dele (4º argumento). A semente fica guardada na máquina
# para quem quiser comparar, e a saída diz onde.

skills_sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# Um destino por linha, "Rótulo:pasta do agente".
skills_destinos() {
  printf 'Claude:%s\n' "$HOME/.claude"
  if [ -d "$HOME/.hermes" ]; then printf 'Hermes:%s\n' "$HOME/.hermes"; fi
}

# Onde a semente fica guardada quando o instalador não escolhe o lugar.
skills_guardada() { printf '%s\n' "$HOME/.local/share/meu-bot/skills-semente/$1.md"; }

# skill_semente <nome> <arquivo-semente> [guardada] [legado]
#   guardada  caminho do arquivo onde a semente fica na máquina (vazio: skills_guardada <nome>).
#   legado    como tratar a cópia que já existe SEM .semente.sha256 (instalada antes desta biblioteca):
#             vazio  = não sei se foi editada: mantém (instalador que nunca sobrescreveu a skill);
#             "*"    = é a do app: atualiza (instalador que regravava a skill a cada instalação);
#             texto  = é a do app enquanto contiver este texto: atualiza (instalador com marcador de versão).
# Sai com 1 se a semente não existe.
skill_semente() {
  local nome=$1 src=$2 guardada=${3:-} legado=${4:-}
  local nova alvo ag sk marca atual gravada
  [ -f "$src" ] || { echo "a semente da skill $nome não está em $src"; return 1; }
  [ -n "$guardada" ] || guardada=$(skills_guardada "$nome")
  mkdir -p "$(dirname "$guardada")"
  [ "$src" -ef "$guardada" ] || cp "$src" "$guardada"
  chmod 644 "$guardada"
  nova=$(skills_sha "$src")
  while IFS= read -r alvo; do
    ag=${alvo%%:*}; sk="${alvo#*:}/skills/$nome/SKILL.md"; marca="$(dirname "$sk")/.semente.sha256"
    if [ ! -f "$sk" ]; then
      mkdir -p "$(dirname "$sk")"; cp "$src" "$sk"; printf '%s\n' "$nova" > "$marca"; echo "skill $nome instalada no $ag"
      continue
    fi
    atual=$(skills_sha "$sk"); gravada=$(cat "$marca" 2>/dev/null || true)
    if [ -z "$gravada" ] && [ -n "$legado" ]; then
      if [ "$legado" = "*" ] || grep -qF -- "$legado" "$sk"; then gravada=$atual; fi
    fi
    if [ "$atual" = "$nova" ]; then
      printf '%s\n' "$nova" > "$marca"; echo "skill $nome já existe no $ag (mantida)"
    elif [ -n "$gravada" ] && [ "$atual" = "$gravada" ]; then
      cp "$src" "$sk"; printf '%s\n' "$nova" > "$marca"; echo "skill $nome atualizada no $ag"
    elif [ -n "$gravada" ]; then
      echo "skill $nome no $ag foi editada pelo agente (mantida); o texto novo está em $guardada"
    else
      echo "skill $nome já existe no $ag e não sei se foi editada (mantida); o texto novo está em $guardada"
    fi
  done < <(skills_destinos)
}
