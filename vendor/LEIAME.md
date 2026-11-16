# vendor/

| Arquivo | O quê |
|---|---|
| `sql-asm.js` | sql.js **1.12.0**, build `asm` (SQLite compilado para JavaScript puro) |
| `LICENSE` | Licença MIT do pacote sql.js |

- **Origem:** `https://cdn.jsdelivr.net/npm/sql.js@1.12.0/dist/sql-asm.js` e `https://cdn.jsdelivr.net/npm/sql.js@1.12.0/LICENSE`, baixados uma única vez em 13/11/2026.
- **SHA-256 de `sql-asm.js`:** `2c601dff592ccc51c07db0ed6b9b08c927c2064a7af5ef5f5ad1a8a9fe2364f3`
- **Por que o build asm:** o build padrão (`sql-wasm.js`) precisa buscar o arquivo `sql-wasm.wasm` com `fetch`, o que o navegador bloqueia quando o `index.html` é aberto direto do disco (`file://`). O build asm traz tudo dentro do próprio `.js`, então funciona offline, sem servidor e sem `.wasm`. O custo é um arquivo maior (~1,3 MB) e execução um pouco mais lenta, irrelevante para o volume de pedidos do projeto.
- É a **única** biblioteca do projeto e o **único** acesso à internet feito ao montá-lo. Não atualize sem testar via `file://` no Chrome e no Firefox.
