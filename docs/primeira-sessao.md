# Guia: Primeira Sessão Jogável no Fusion VTT

Este guia cobre o fluxo completo para o GM rodar a primeira sessão de Pathfinder 2e usando o Fusion VTT.

---

## Pré-requisitos

- Node.js 22+ instalado
- `pnpm` instalado (`npm install -g pnpm`)
- Porta 33000 livre na máquina do GM
- Jogadores na mesma rede local (LAN) ou com acesso à IP do GM

---

## 1. Instalar dependências e compilar

```bash
# Na pasta raiz do repositório
pnpm install
pnpm build
```

O build compila `@fusion/shared` antes de `@fusion/server` (ordem topológica obrigatória).

---

## 2. Criar o world

```bash
# Criar um world com o sistema PF2e
node packages/server/dist/cli.js world create minha-campanha --system pf2e

# Listar worlds existentes
node packages/server/dist/cli.js world list
```

O world criado ficará em `worlds/minha-campanha/` com `world.db` e a pasta `assets/`.

---

## 3. Subir o servidor

```bash
node packages/server/dist/cli.js serve --world minha-campanha
```

Saída esperada:

```
[Fusion] Pronto para conexões — http://0.0.0.0:33000
[Fusion] LAN: http://192.168.x.x:33000
```

O servidor fica ativo na **porta 33000**. Mantenha o terminal aberto durante a sessão.

---

## 4. Acessar a interface (GM)

Abra no navegador:

```
http://localhost:33000
```

Na tela de login:

- Clique no usuário **GM** (criado automaticamente)
- Se houver senha, insira-a
- Clique em **Entrar no World**

---

## 5. Importar conteúdo do compêndio (opcional)

O Fusion inclui um subconjunto MVP de conteúdo ORC do PF2e (armas, condições, monstros básicos, magias comuns, feats).

Para importar:

```bash
# Dentro do mundo, via CLI (quando disponível em M3-D completo):
node packages/server/dist/cli.js import --world minha-campanha --pack weapons
node packages/server/dist/cli.js import --world minha-campanha --pack conditions
node packages/server/dist/cli.js import --world minha-campanha --pack monsters-core
node packages/server/dist/cli.js import --world minha-campanha --pack spells-core
```

O compêndio fica acessível na aba **Compêndio** do painel lateral.

---

## 6. Criar uma cena

1. Na barra lateral direita, clique na aba **Cenas**
2. Clique em **+ Nova**
3. Preencha:
   - **Nome**: ex. `Taverna do Dragão`
   - **Largura / Altura**: ex. `3000 × 2000` (px)
   - **Tamanho da célula**: `100` (px = 1 quadrado = 5 pés)
   - **Plano de fundo**: URL de imagem ou clique no ícone de câmera para escolher dos assets
4. Clique em **Criar Cena**
5. Na lista de cenas, clique no botão ▶ para **ativar** a cena

---

## 7. Criar atores (personagens e NPCs)

1. Clique na aba **Atores** no painel lateral
2. Clique em **+ Novo**
3. Um ator é criado com tipo `Personagem`
4. Clique no ator para abrir a **ficha**
5. Preencha: nível, atributos, classe, itens do inventário
6. O sistema calcula automaticamente CA, PV máximo, bônus de ataque, salvaguardas

Para NPCs:

- Crie um ator do tipo **NPC**
- Ou arraste do **Compêndio** (monstros importados)

---

## 8. Adicionar tokens ao canvas

1. Na aba **Atores**, arraste um ator para o **canvas** (área do mapa)
2. Um token é criado na posição onde foi solto
3. Clique no token para selecioná-lo; duplo-clique para abrir a ficha

Alternativa: clique no token no canvas com o botão direito para opções de configuração.

---

## 9. Convidar jogadores

Compartilhe com os jogadores o endereço LAN exibido no terminal:

```
http://192.168.x.x:33000
```

Cada jogador:

1. Acessa o endereço no navegador (Chrome/Firefox/Edge — sem instalar nada)
2. Clica no **seu usuário** na tela de login
3. Clica em **Entrar no World**

O GM cria usuários no painel de configurações ou via CLI:

```bash
node packages/server/dist/cli.js user create "Nome do Jogador" --world minha-campanha
```

---

## 10. Iniciar combate

1. Clique na aba **Combate** no painel lateral
2. Clique em **Criar Combate** (somente GM, com uma cena ativa)
3. Para cada token participante do combate, clique com botão direito → **Adicionar ao Combate**
4. Clique em **Rolar todos** para rolar iniciativa de todos os combatentes de uma vez
5. Clique em **Iniciar** para começar o combate
6. Use **▶** (próximo turno) para avançar a ordem de iniciativa

**Ações durante o combate:**

- Jogadores movem tokens com arrasto no canvas
- Clique nos ataques/magias na ficha para rolar automaticamente
- Dano é aplicado ao token alvo (drag sobre o token ou seleção)
- Condições (amedrontado, caído, etc.) são aplicadas no painel de efeitos da ficha

---

## 11. Usar o chat e rolagens

- **Mensagens de texto**: aba Chat → campo de texto → Enter
- **Rolagem inline**: no chat, digite `[[1d20+5]]` e pressione Enter
- **Chat cards**: clique nos ataques/salvaguardas nas fichas; o resultado aparece no chat com breakdown
- **Roll modes**: use o seletor no chat para escolher visibilidade (público, self, GM, blind)

---

## Estados vazios e erros comuns

| Situação              | O que aparece                                  | O que fazer                                 |
| --------------------- | ---------------------------------------------- | ------------------------------------------- |
| Nenhuma cena ativa    | Sobreposição "Nenhuma Cena Ativa"              | GM ativa uma cena na aba Cenas              |
| Nenhum combate ativo  | "Nenhum combate ativo." na aba Combate         | GM clica em Criar Combate                   |
| Conexão perdida       | Indicador pulsando (laranja) + "Reconectando…" | Aguardar reconexão automática ou recarregar |
| Versão incompatível   | Banner amarelo "Versão incompatível"           | Recarregar a página no cliente              |
| Falha de autenticação | "Falha de autenticação" no indicador           | Verificar senha ou token de sessão expirado |

---

## Backup do world

```bash
# Criar backup antes de sessões importantes
node packages/server/dist/cli.js world backup minha-campanha
```

Backups ficam em `worlds/minha-campanha/backups/` com timestamp. São criados automaticamente antes de toda migration.

---

## Referência rápida de atalhos

| Ação                | Como                                           |
| ------------------- | ---------------------------------------------- |
| Pan no canvas       | Botão do meio + arrastar, ou Espaço + arrastar |
| Zoom                | Scroll do mouse                                |
| Debug overlay       | F9                                             |
| Fechar ficha/janela | × no canto superior direito                    |

---

## Critério de "primeira sessão jogável" (DoD M3)

A sessão é bem-sucedida quando, usando **apenas o Fusion**:

1. Cena com mapa e grid ativa
2. Tokens movem-se com sincronização em tempo real
3. Fog of war cobre área não-explorada; paredes bloqueiam visão
4. Fichas PF2e com valores derivados corretos (CA, PV, perícias, ataques)
5. Strikes com MAP e grau de sucesso; salva com break-down; dano com IWR aplicado
6. Chat com mensagens e chat cards por roll mode
7. Combat tracker com iniciativa por Percepção e ciclo de turnos

Se todos os 7 pontos funcionaram na sessão: **MVP concluído**.
