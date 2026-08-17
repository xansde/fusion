# Rastreabilidade — requisito ↔ código

> Arquivo **gerado**. Não edite à mão: rode `pnpm spec:report`.

Um requisito conta como **coberto** quando um arquivo de teste cita o id dele
(`REQ-ROL-012`) — a convenção que o repo já usava antes de ser formalizada.
Isso mede *reivindicação de cobertura*, não correção: um teste que nomeia o
requisito afirma cobri-lo, e essa afirmação é auditável. Requisito sem citação
nenhuma não afirma nada — é a spec pedindo algo que ninguém foi conferir.

Escopo: os **1958 requisitos [MVP]** definidos nas 45 specs. Os [V2] ficam de fora
porque ainda não foram prometidos para nenhum marco.

## Total

| Situação | Requisitos | Fatia |
| --- | ---: | ---: |
| Citados por algum teste | 712 | 36% |
| Citados só por código de produção | 319 | 16% |
| Sem nenhuma citação | 927 | 47% |
| **Total [MVP]** | **1958** | |

## Por spec

| Spec | [MVP] | Com teste | Só código | Sem citação | Cobertura |
| --- | ---: | ---: | ---: | ---: | ---: |
| [00](00-visao-e-escopo.md) | 18 | 0 | 1 | 17 | 0% |
| [01](01-arquitetura-geral.md) | 42 | 6 | 8 | 28 | 14% |
| [02](02-modelo-de-dados.md) | 59 | 17 | 13 | 29 | 29% |
| [03](03-persistencia-e-mundos.md) | 36 | 3 | 19 | 14 | 8% |
| [04](04-rede-e-sincronizacao.md) | 48 | 8 | 21 | 19 | 17% |
| [05](05-usuarios-e-permissoes.md) | 40 | 18 | 11 | 11 | 45% |
| [06](06-canvas-e-renderizacao.md) | 86 | 12 | 29 | 45 | 14% |
| [07](07-visao-iluminacao-fog.md) | 56 | 15 | 21 | 20 | 27% |
| [08](08-motor-de-rolagens.md) | 49 | 15 | 11 | 23 | 31% |
| [09](09-chat-e-mensagens.md) | 49 | 13 | 10 | 26 | 27% |
| [10](10-combate-e-iniciativa.md) | 45 | 16 | 28 | 1 | 36% |
| [11](11-ui-framework-e-fichas.md) | 62 | 9 | 17 | 36 | 15% |
| [12](12-journal-tabelas-cartas.md) | 34 | 0 | 0 | 34 | 0% |
| [13](13-audio-e-playlists.md) | 49 | 0 | 3 | 46 | 0% |
| [14](14-macros-e-automacao.md) | 34 | 0 | 0 | 34 | 0% |
| [15](15-api-de-sistemas.md) | 63 | 17 | 30 | 16 | 27% |
| [16](16-compendiums-e-importacao.md) | 57 | 19 | 16 | 22 | 33% |
| [17](17-sistema-pf2e.md) | 72 | 42 | 14 | 16 | 58% |
| [18](18-sistema-sf2e.md) | 39 | 16 | 11 | 12 | 41% |
| [19](19-sistema-etmos.md) | 46 | 31 | 6 | 9 | 67% |
| [20](20-assets-e-midia.md) | 50 | 5 | 13 | 32 | 10% |
| [21](21-seguranca.md) | 44 | 9 | 12 | 23 | 20% |
| [22](22-instalacao-e-distribuicao.md) | 41 | 18 | 9 | 14 | 44% |
| [23](23-acessibilidade-e-dispositivos.md) | 45 | 1 | 0 | 44 | 2% |
| [24](24-operacao-backups-telemetria.md) | 41 | 0 | 0 | 41 | 0% |
| [25](25-testes-e-qualidade.md) | 42 | 0 | 0 | 42 | 0% |
| [26](26-licencas-e-legal.md) | 23 | 1 | 1 | 21 | 4% |
| [27](27-roadmap-e-milestones.md) | 11 | 0 | 0 | 11 | 0% |
| [28](28-hub-do-jogador.md) | 50 | 0 | 0 | 50 | 0% |
| [29](29-pets-companions-familiars.md) | 16 | 3 | 6 | 7 | 19% |
| [32](32-minimapa-tatico.md) | 14 | 0 | 0 | 14 | 0% |
| [34](34-mapa-de-regiao.md) | 27 | 0 | 0 | 27 | 0% |
| [35](35-avatar-do-personagem.md) | 33 | 0 | 0 | 33 | 0% |
| [36](36-gaveta-lateral.md) | 24 | 24 | 0 | 0 | 100% |
| [37](37-configuracoes.md) | 43 | 35 | 2 | 6 | 81% |
| [38](38-aba-chat.md) | 56 | 55 | 0 | 1 | 98% |
| [39](39-contatos.md) | 67 | 67 | 0 | 0 | 100% |
| [40](40-aba-combate.md) | 59 | 52 | 2 | 5 | 88% |
| [41](41-token.md) | 61 | 16 | 2 | 43 | 26% |
| [42](42-aba-npcs.md) | 59 | 56 | 1 | 2 | 95% |
| [43](43-aba-compendio.md) | 61 | 59 | 1 | 1 | 97% |
| [44](44-aba-cenas.md) | 58 | 54 | 1 | 3 | 93% |
| [45](45-atores.md) | 49 | 0 | 0 | 49 | 0% |
