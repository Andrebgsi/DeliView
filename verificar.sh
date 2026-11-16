#!/usr/bin/env bash
# Confere os arquivos que vão para o GitHub (os versionados no git): sem dados reais, sem o nome
# antigo da loja, sem chamadas externas e com a política de segurança nas páginas.
# Uso: ./verificar.sh   (rode depois do "git add" e antes de cada "git push")

set -uo pipefail
cd "$(dirname "$0")" || exit 1
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Esta pasta não é um repositório git"; exit 1; }

PROBLEMAS=0
ok()   { printf '\033[32m  ok\033[0m  %s\n' "$*"; }
erro() { printf '\033[31m  ERRO\033[0m %s\n' "$*"; PROBLEMAS=1; }

# Arquivos versionados + os que já estão no "git add"
mapfile -t ARQ < <(git ls-files --cached | sort -u)
echo "== ${#ARQ[@]} arquivos versionados =="
echo

echo "== Conferências =="

# 1. Planilhas, bancos e backups: só as 2 planilhas fictícias de exemplos/
DADOS=$(printf '%s\n' "${ARQ[@]}" | grep -iE '\.(xlsx|xls|csv|sqlite[0-9]*|db|zip)$' | grep -v '^exemplos/')
[[ -z "$DADOS" ]] && ok "nenhuma planilha, banco ou backup fora de exemplos/" || erro "arquivos de dados versionados: $DADOS"
N=$(printf '%s\n' "${ARQ[@]}" | grep -c '^exemplos/')
[[ "$N" -eq 2 ]] && ok "exemplos/ tem só os 2 arquivos fictícios" || erro "exemplos/ deveria ter 2 arquivos (tem $N)"

# 2. Pastas que ficam só no computador
if printf '%s\n' "${ARQ[@]}" | grep -qE '^(dados-teste|tests)/'; then erro "dados-teste/ ou tests/ estão no git"; else ok "dados-teste/ e tests/ fora do git"; fi

# 3. Nome antigo da loja (só as duas constantes de compatibilidade podem citá-lo)
ANTIGO=$(printf '%s\0' "${ARQ[@]}" | xargs -0 grep -niE 'boa ?escolha' 2>/dev/null | grep -vE 'NOME_ANTIGO = |ARQ_SQLITE_ANTIGO = ' | grep -v '^verificar.sh:')
[[ -z "$ANTIGO" ]] && ok "sem o nome antigo da loja" || erro "nome antigo encontrado:"$'\n'"$ANTIGO"
if printf '%s\n' "${ARQ[@]}" | grep -qiE 'boa ?escolha'; then erro "há arquivo com o nome antigo"; fi

# 4. Política de segurança e nenhum script embutido nas duas páginas
for f in index.html portal.html; do
  [[ -f "$f" ]] || { erro "falta $f"; continue; }
  grep -q "connect-src 'none'" "$f" && ok "$f com CSP (connect-src 'none')" || erro "$f sem CSP"
  grep -qE '<script>[^<]|on(click|load|error)=' "$f" && erro "$f tem script embutido" || ok "$f sem script embutido"
done

# 5. Endereços externos no código (fora os nomes de esquema do OpenXML e o link do GitHub do autor)
EXT=$(git ls-files -- '*.html' '*.js' '*.css' | grep -v '^vendor/' | xargs -d '\n' grep -hoE "https?://[a-zA-Z0-9./_-]+" | grep -vE "schemas\.openxmlformats\.org|www\.w3\.org|purl\.org|^https://github\.com/Andrebgsi$" | sort -u)
[[ -z "$EXT" ]] && ok "nenhum endereço externo no código" || erro "endereços externos: $EXT"

# 6. Menções a ferramentas de apoio
if printf '%s\0' "${ARQ[@]}" | grep -zv '^verificar.sh$' | xargs -0 grep -liE "claude|anthropic|co-authored|chatgpt|openai|copilot|gemini" --exclude-dir=vendor 2>/dev/null | grep -v '^vendor/' | grep -q .; then
  erro "há menções a ferramentas de apoio"
else ok "sem menções a ferramentas de apoio"; fi

echo
if [[ $PROBLEMAS -eq 0 ]]; then
  printf '\033[32mPronto para publicar.\033[0m\n'
else
  printf '\033[31mCorrija os itens acima antes de publicar.\033[0m\n'; exit 1
fi
