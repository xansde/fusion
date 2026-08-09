# Rastreabilidade — requisito ↔ código

> Arquivo **gerado**. Não edite à mão: rode `pnpm spec:report`.

Um requisito conta como **coberto** quando um arquivo de teste cita o id dele
(`REQ-ROL-012`) — a convenção que o repo já usava antes de ser formalizada.
Isso mede *reivindicação de cobertura*, não correção: um teste que nomeia o
requisito afirma cobri-lo, e essa afirmação é auditável. Requisito sem citação
nenhuma não afirma nada — é a spec pedindo algo que ninguém foi conferir.

Escopo: os **1340 requisitos [MVP]** definidos nas 34 specs. Os [V2] ficam de fora
porque ainda não foram prometidos para nenhum marco.

## Total

| Situação | Requisitos | Fatia |
| --- | ---: | ---: |
| Citados por algum teste | 237 | 18% |
| Citados só por código de produção | 326 | 24% |
| Sem nenhuma citação | 777 | 58% |
| **Total [MVP]** | **1340** | |

## Por spec

| Spec | [MVP] | Com teste | Só código | Sem citação | Cobertura |
| --- | ---: | ---: | ---: | ---: | ---: |
| [00](00-visao-e-escopo.md) | 18 | 0 | 0 | 18 | 0% |
| [01](01-arquitetura-geral.md) | 42 | 6 | 8 | 28 | 14% |
| [02](02-modelo-de-dados.md) | 57 | 8 | 17 | 32 | 14% |
| [03](03-persistencia-e-mundos.md) | 36 | 2 | 20 | 14 | 6% |
| [04](04-rede-e-sincronizacao.md) | 47 | 7 | 21 | 19 | 15% |
| [05](05-usuarios-e-permissoes.md) | 36 | 3 | 17 | 16 | 8% |
| [06](06-canvas-e-renderizacao.md) | 79 | 8 | 28 | 43 | 10% |
| [07](07-visao-iluminacao-fog.md) | 56 | 13 | 23 | 20 | 23% |
| [08](08-motor-de-rolagens.md) | 49 | 11 | 12 | 26 | 22% |
| [09](09-chat-e-mensagens.md) | 42 | 5 | 9 | 28 | 12% |
| [10](10-combate-e-iniciativa.md) | 45 | 14 | 29 | 2 | 31% |
| [11](11-ui-framework-e-fichas.md) | 62 | 7 | 16 | 39 | 11% |
| [12](12-journal-tabelas-cartas.md) | 34 | 0 | 0 | 34 | 0% |
| [13](13-audio-e-playlists.md) | 49 | 0 | 5 | 44 | 0% |
| [14](14-macros-e-automacao.md) | 34 | 0 | 0 | 34 | 0% |
| [15](15-api-de-sistemas.md) | 62 | 15 | 31 | 16 | 24% |
| [16](16-compendiums-e-importacao.md) | 50 | 13 | 17 | 20 | 26% |
| [17](17-sistema-pf2e.md) | 66 | 36 | 14 | 16 | 55% |
| [18](18-sistema-sf2e.md) | 39 | 16 | 11 | 12 | 41% |
| [19](19-sistema-etmos.md) | 46 | 31 | 6 | 9 | 67% |
| [20](20-assets-e-midia.md) | 50 | 7 | 11 | 32 | 14% |
| [21](21-seguranca.md) | 44 | 6 | 13 | 25 | 14% |
| [22](22-instalacao-e-distribuicao.md) | 41 | 18 | 9 | 14 | 44% |
| [23](23-acessibilidade-e-dispositivos.md) | 45 | 0 | 0 | 45 | 0% |
| [24](24-operacao-backups-telemetria.md) | 41 | 0 | 0 | 41 | 0% |
| [25](25-testes-e-qualidade.md) | 42 | 0 | 0 | 42 | 0% |
| [26](26-licencas-e-legal.md) | 23 | 1 | 1 | 21 | 4% |
| [27](27-roadmap-e-milestones.md) | 11 | 0 | 0 | 11 | 0% |
| [28](28-hub-do-jogador.md) | 48 | 0 | 0 | 48 | 0% |
| [29](29-pets-companions-familiars.md) | 16 | 3 | 6 | 7 | 19% |
| [32](32-minimapa-tatico.md) | 14 | 7 | 2 | 5 | 50% |
| [34](34-mapa-de-regiao.md) | 16 | 0 | 0 | 16 | 0% |
