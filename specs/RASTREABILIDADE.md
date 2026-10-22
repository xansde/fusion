# Rastreabilidade — requisito ↔ código

> Arquivo **gerado**. Não edite à mão: rode `pnpm spec:report`.

Um requisito conta como **coberto** quando um arquivo de teste cita o id dele
(`REQ-ROL-012`) — a convenção que o repo já usava antes de ser formalizada.
Isso mede *reivindicação de cobertura*, não correção: um teste que nomeia o
requisito afirma cobri-lo, e essa afirmação é auditável. Requisito sem citação
nenhuma não afirma nada — é a spec pedindo algo que ninguém foi conferir.

Escopo: os **2368 requisitos [MVP]** definidos nas 48 specs. Os [V2] ficam de fora
porque ainda não foram prometidos para nenhum marco.

## Total

| Situação | Requisitos | Fatia |
| --- | ---: | ---: |
| Citados por algum teste | 954 | 40% |
| Citados só por código de produção | 338 | 14% |
| Sem nenhuma citação | 1076 | 45% |
| **Total [MVP]** | **2368** | |

## Por spec

| Spec | [MVP] | Com teste | Só código | Sem citação | Cobertura |
| --- | ---: | ---: | ---: | ---: | ---: |
| [00](00-visao-e-escopo.md) | 18 | 0 | 1 | 17 | 0% |
| [01](01-arquitetura-geral.md) | 42 | 6 | 8 | 28 | 14% |
| [02](02-modelo-de-dados.md) | 59 | 18 | 13 | 28 | 31% |
| [03](03-persistencia-e-mundos.md) | 36 | 3 | 19 | 14 | 8% |
| [04](04-rede-e-sincronizacao.md) | 49 | 10 | 21 | 18 | 20% |
| [05](05-usuarios-e-permissoes.md) | 44 | 21 | 13 | 10 | 48% |
| [06](06-canvas-e-renderizacao.md) | 89 | 20 | 25 | 44 | 22% |
| [07](07-visao-iluminacao-fog.md) | 56 | 8 | 22 | 26 | 14% |
| [08](08-motor-de-rolagens.md) | 49 | 14 | 12 | 23 | 29% |
| [09](09-chat-e-mensagens.md) | 55 | 19 | 10 | 26 | 35% |
| [10](10-combate-e-iniciativa.md) | 54 | 23 | 28 | 3 | 43% |
| [11](11-ui-framework-e-fichas.md) | 61 | 11 | 15 | 35 | 18% |
| [12](12-journal-tabelas-cartas.md) | 34 | 0 | 0 | 34 | 0% |
| [13](13-audio-e-playlists.md) | 49 | 0 | 8 | 41 | 0% |
| [14](14-macros-e-automacao.md) | 27 | 0 | 0 | 27 | 0% |
| [15](15-api-de-sistemas.md) | 82 | 30 | 31 | 21 | 37% |
| [16](16-compendiums-e-importacao.md) | 58 | 20 | 16 | 22 | 34% |
| [17](17-sistema-pf2e.md) | 114 | 75 | 16 | 23 | 66% |
| [18](18-sistema-sf2e.md) | 46 | 22 | 8 | 16 | 48% |
| [19](19-sistema-etmos.md) | 46 | 0 | 2 | 44 | 0% |
| [20](20-assets-e-midia.md) | 50 | 7 | 11 | 32 | 14% |
| [21](21-seguranca.md) | 44 | 11 | 11 | 22 | 25% |
| [22](22-instalacao-e-distribuicao.md) | 41 | 19 | 8 | 14 | 46% |
| [23](23-acessibilidade-e-dispositivos.md) | 45 | 6 | 1 | 38 | 13% |
| [24](24-operacao-backups-telemetria.md) | 41 | 0 | 0 | 41 | 0% |
| [25](25-testes-e-qualidade.md) | 42 | 0 | 0 | 42 | 0% |
| [26](26-licencas-e-legal.md) | 24 | 4 | 0 | 20 | 17% |
| [27](27-roadmap-e-milestones.md) | 11 | 0 | 0 | 11 | 0% |
| [28](28-hub-do-jogador.md) | 50 | 0 | 0 | 50 | 0% |
| [29](29-pets-companions-familiars.md) | 55 | 31 | 9 | 15 | 56% |
| [31](31-base-canonica-de-conteudo.md) | 1 | 1 | 0 | 0 | 100% |
| [32](32-minimapa-tatico.md) | 14 | 0 | 0 | 14 | 0% |
| [34](34-mapa-de-regiao.md) | 27 | 0 | 0 | 27 | 0% |
| [35](35-avatar-do-personagem.md) | 49 | 4 | 1 | 44 | 8% |
| [36](36-gaveta-lateral.md) | 24 | 24 | 0 | 0 | 100% |
| [37](37-configuracoes.md) | 50 | 40 | 2 | 8 | 80% |
| [38](38-aba-chat.md) | 56 | 55 | 0 | 1 | 98% |
| [39](39-contatos.md) | 68 | 68 | 0 | 0 | 100% |
| [40](40-aba-combate.md) | 59 | 52 | 2 | 5 | 88% |
| [41](41-token.md) | 72 | 49 | 6 | 17 | 68% |
| [42](42-aba-npcs.md) | 59 | 56 | 1 | 2 | 95% |
| [43](43-aba-compendio.md) | 61 | 59 | 1 | 1 | 97% |
| [44](44-aba-cenas.md) | 58 | 51 | 1 | 6 | 88% |
| [45](45-atores.md) | 50 | 3 | 1 | 46 | 6% |
| [47](47-fabricacao-e-alquimia.md) | 40 | 0 | 0 | 40 | 0% |
| [52](52-cacador-companheiro-e-montaria.md) | 121 | 45 | 11 | 65 | 37% |
| [53](53-barra-de-acoes.md) | 88 | 69 | 4 | 15 | 78% |
