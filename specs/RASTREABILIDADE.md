# Rastreabilidade — requisito ↔ código

> Arquivo **gerado**. Não edite à mão: rode `pnpm spec:report`.

Um requisito conta como **coberto** quando um arquivo de teste cita o id dele
(`REQ-ROL-012`) — a convenção que o repo já usava antes de ser formalizada.
Isso mede *reivindicação de cobertura*, não correção: um teste que nomeia o
requisito afirma cobri-lo, e essa afirmação é auditável. Requisito sem citação
nenhuma não afirma nada — é a spec pedindo algo que ninguém foi conferir.

Escopo: os **1824 requisitos [MVP]** definidos nas 43 specs. Os [V2] ficam de fora
porque ainda não foram prometidos para nenhum marco.

## Total

| Situação | Requisitos | Fatia |
| --- | ---: | ---: |
| Citados por algum teste | 248 | 14% |
| Citados só por código de produção | 334 | 18% |
| Sem nenhuma citação | 1242 | 68% |
| **Total [MVP]** | **1824** | |

## Por spec

| Spec | [MVP] | Com teste | Só código | Sem citação | Cobertura |
| --- | ---: | ---: | ---: | ---: | ---: |
| [00](00-visao-e-escopo.md) | 18 | 1 | 0 | 17 | 6% |
| [01](01-arquitetura-geral.md) | 42 | 6 | 8 | 28 | 14% |
| [02](02-modelo-de-dados.md) | 59 | 8 | 17 | 34 | 14% |
| [03](03-persistencia-e-mundos.md) | 36 | 2 | 20 | 14 | 6% |
| [04](04-rede-e-sincronizacao.md) | 48 | 7 | 21 | 20 | 15% |
| [05](05-usuarios-e-permissoes.md) | 36 | 0 | 19 | 17 | 0% |
| [06](06-canvas-e-renderizacao.md) | 85 | 3 | 33 | 49 | 4% |
| [07](07-visao-iluminacao-fog.md) | 56 | 12 | 24 | 20 | 21% |
| [08](08-motor-de-rolagens.md) | 49 | 11 | 12 | 26 | 22% |
| [09](09-chat-e-mensagens.md) | 49 | 6 | 9 | 34 | 12% |
| [10](10-combate-e-iniciativa.md) | 45 | 14 | 29 | 2 | 31% |
| [11](11-ui-framework-e-fichas.md) | 62 | 7 | 18 | 37 | 11% |
| [12](12-journal-tabelas-cartas.md) | 34 | 0 | 0 | 34 | 0% |
| [13](13-audio-e-playlists.md) | 49 | 0 | 0 | 49 | 0% |
| [14](14-macros-e-automacao.md) | 34 | 0 | 0 | 34 | 0% |
| [15](15-api-de-sistemas.md) | 62 | 15 | 31 | 16 | 24% |
| [16](16-compendiums-e-importacao.md) | 50 | 13 | 17 | 20 | 26% |
| [17](17-sistema-pf2e.md) | 66 | 36 | 14 | 16 | 55% |
| [18](18-sistema-sf2e.md) | 39 | 16 | 11 | 12 | 41% |
| [19](19-sistema-etmos.md) | 46 | 31 | 6 | 9 | 67% |
| [20](20-assets-e-midia.md) | 50 | 5 | 13 | 32 | 10% |
| [21](21-seguranca.md) | 44 | 6 | 13 | 25 | 14% |
| [22](22-instalacao-e-distribuicao.md) | 41 | 18 | 9 | 14 | 44% |
| [23](23-acessibilidade-e-dispositivos.md) | 45 | 0 | 0 | 45 | 0% |
| [24](24-operacao-backups-telemetria.md) | 41 | 0 | 0 | 41 | 0% |
| [25](25-testes-e-qualidade.md) | 42 | 0 | 0 | 42 | 0% |
| [26](26-licencas-e-legal.md) | 23 | 1 | 1 | 21 | 4% |
| [27](27-roadmap-e-milestones.md) | 11 | 0 | 0 | 11 | 0% |
| [28](28-hub-do-jogador.md) | 50 | 0 | 0 | 50 | 0% |
| [29](29-pets-companions-familiars.md) | 16 | 3 | 6 | 7 | 19% |
| [32](32-minimapa-tatico.md) | 14 | 0 | 0 | 14 | 0% |
| [34](34-mapa-de-regiao.md) | 27 | 0 | 0 | 27 | 0% |
| [35](35-avatar-do-personagem.md) | 33 | 0 | 0 | 33 | 0% |
| [36](36-gaveta-lateral.md) | 24 | 23 | 1 | 0 | 96% |
| [37](37-configuracoes.md) | 39 | 1 | 0 | 38 | 3% |
| [38](38-aba-chat.md) | 56 | 0 | 1 | 55 | 0% |
| [39](39-contatos.md) | 67 | 0 | 0 | 67 | 0% |
| [40](40-aba-combate.md) | 59 | 0 | 0 | 59 | 0% |
| [42](42-aba-npcs.md) | 59 | 1 | 0 | 58 | 2% |
| [43](43-aba-compendio.md) | 60 | 0 | 0 | 60 | 0% |
| [44](44-aba-cenas.md) | 58 | 2 | 1 | 55 | 3% |
