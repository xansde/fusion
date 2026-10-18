# mesa-cli

Porta de linha de comando para um servidor Fusion **no ar**. Entra pelo protocolo normal
(login HTTP + socket) e manda ops pelo mesmo pipeline do navegador: validação, derivação,
persistência e broadcast. Os jogadores veem a mudança na hora. Nunca escreve no SQLite e não
abre rota nova: só faz o que o protocolo já permite ao Mestre.

```
pnpm mesa -- [--url URL] [--user NOME] [--password PW] [--json] <comando>
```

- `--url` (env `FUSION_URL`, padrão `http://127.0.0.1:33000`)
- `--user` (env `FUSION_USER`, padrão `Gamemaster`; aceita nome ou id)
- `--password` (env `FUSION_PASSWORD`; o Gamemaster da mesa não tem senha)
- `--json` saída JSON; sem ele, texto humano. Erros vão para stderr, código de saída != 0.

| Comando | O que faz |
| --- | --- |
| `status` | mundo, cena ativa, usuários e quem está conectado |
| `actors [--type character]` | lista atores |
| `actor <id\|nome>` | resumo: HP, itens, condições, `system.derived` |
| `get <id\|nome> <path>` | lê um caminho (`system.attributes.hp.value`) |
| `set <id\|nome> <path> <json>` | `doc:update` de um caminho |
| `item-add <ator> <json>` / `item-rm <ator> <id\|nome>` | cria/remove item do ator |
| `op '<json>'` | envelope cru: `{"type":"doc:update","payload":{...}}` |
| `chat <texto>` | mensagem de chat como o usuário Mestre |
| `scene <id\|nome>` | ativa a cena |
| `hp <ator> <valor>` | HP absoluto (`20`) ou relativo (`+5`, `-3`) |
| `condition <ator> <slug> [valor\|off]` | aplica/ajusta/remove condição (`actor:applyCondition`) |

Atores e cenas se resolvem por id, nome exato ou trecho único do nome; ambíguo vira erro com
os candidatos. Cada execução conecta, lê o snapshot atual, executa e desconecta.

Limites: o chat sai como o usuário do login (não há speaker "Sistema" no protocolo para o
cliente); `hp` assume o caminho `system.attributes.hp` (PF2e/SF2e); `condition` usa
`selfActorId` (o servidor decide se aceita sem token).

Testes: `pnpm -C tools/mesa-cli test` (servidor efêmero em porta livre, dois clientes).
