---
name: subir-tunel
description: Use quando o usuário quiser expor o servidor Fusion local para a internet via túnel público Cloudflare (`fusion serve --tunnel`) — "sobe o túnel", "abre pro pessoal de fora", "link público pro jogo", "compartilha o mundo". Sobe (ou reaproveita) o servidor com o mundo indicado, aguarda a URL do `cloudflared` aparecer no log, confere saúde local+público e devolve os links prontos.
---

# /subir-tunel [mundo] [porta]

Sobe o servidor Fusion com o mundo indicado já expondo um túnel público Cloudflare
(`fusion serve --tunnel`) e devolve a URL pública pronta para compartilhar.

Argumentos opcionais — padrão `mundo=isekai`, `porta=33001` se omitidos.

**Por que 33001 e não 33000 (default do projeto):** 33000 é a porta que qualquer outra
sessão/worktree do Claude Code tende a testar primeiro (é o "Porta default" documentado no
CLAUDE.md do projeto). Sessões independentes não têm como se coordenar entre si — uma subindo
`fusion serve` normal em 33000 pode matar/ser morta pela outra sem aviso (aconteceu 2x em
2026-08-08, derrubando o túnel público no meio de uma sessão de jogo real). Rodar o túnel "ao
vivo" numa porta não-óbvia reduz a chance de colisão. Ver nota equivalente no CLAUDE.md do
projeto (seção Convenções).

## Passos

1. **Resolver mundo e porta**
   - Se `$ARGUMENTS` tiver algo, primeiro token = slug do mundo, segundo (se houver) = porta.
   - Confirmar que o mundo existe: `node dist/cli/index.js world list` (a partir de `packages/server`) e checar o slug na coluna `SLUG`.

2. **Checar se a porta já está ocupada**
   ```bash
   netstat -ano | grep ":<PORTA>" | grep LISTENING
   ```
   - Se **não** houver nada: pular para o passo 3.
   - Se houver um PID: identificar o processo antes de mexer —
     ```bash
     wmic process where "ProcessId=<PID>" get ProcessId,Name,CommandLine /format:list
     ```
     - Se for um `node.exe` rodando `.../server/dist/cli/index.js serve` (ou `dist/index.js serve`) do **mesmo mundo** pedido: matar e recriar com `--tunnel` (garante que o processo atual realmente tem o túnel ligado — não dá para "anexar" um túnel a um servidor já rodando sem a flag):
       ```bash
       taskkill //PID <PID> //F
       ```
     - Se for **outro mundo** ou processo não identificado como Fusion: **parar e perguntar ao usuário** antes de derrubar — pode ser sessão de jogo de outra mesa.

3. **Subir o servidor com `--tunnel`** (a partir de `packages/server`, em background, log num arquivo do scratchpad da sessão)
   ```bash
   SCRATCH="<scratchpad da sessão>"
   LOG="$SCRATCH/fusion-server-tunnel.log"
   : > "$LOG"
   cd "C:/Users/xansd/pessoal/fusion/packages/server"
   nohup node dist/cli/index.js serve --port <PORTA> --world <MUNDO> --tunnel --no-open > "$LOG" 2>&1 &
   disown
   ```
   Use `<PORTA>` = `33001` por padrão (ver "por que 33001" acima), não `33000`.
   - Se o `dist/` estiver desatualizado em relação ao código-fonte (checar `git status`/data de build vs. últimos commits em `packages/server/src`), rodar antes:
     ```bash
     cd "C:/Users/xansd/pessoal/fusion" && pnpm --filter @fusion/shared build && pnpm --filter @fusion/server build
     ```

4. **Esperar a URL pública aparecer no log** (poll simples, timeout ~30s)
   ```bash
   for i in $(seq 1 15); do
     grep -q "Cloudflare quick tunnel is up" "$LOG" && break
     sleep 2
   done
   grep "tunnelUrl" "$LOG" | tail -1
   ```
   - Extrair a URL do padrão `"tunnelUrl":"https://....trycloudflare.com"`.
   - Se não aparecer em ~30s: ler o log inteiro — normalmente é `cloudflared.exe` não encontrado/baixado ainda (primeira vez baixa sob demanda, pode levar mais) ou porta já ocupada.

5. **Checagem de saúde (local + público)**
   ```bash
   curl -s -o /dev/null -m 8 -w "local:%{http_code}\n" http://localhost:<PORTA>/health
   curl -s -o /dev/null -m 8 -w "publico:%{http_code}\n" "<TUNNEL_URL>/health"
   ```
   Ambos devem responder `200`.

6. **Reportar ao usuário**
   - URL pública + caminho do mundo: `<TUNNEL_URL>/world/<MUNDO>`
   - Lembrete padrão de segurança (o próprio servidor já imprime, mas repetir): túnel expõe a máquina à internet — vale conferir a GM Admin Key e o `allowedOrigins` antes de mandar o link pra gente de fora.
   - Lembrar que a URL é **efêmera**: muda a cada `serve --tunnel` novo (reiniciar o processo = link novo). Por isso o passo 2 evita reiniciar à toa quando já tem um túnel de pé saudável.

## Derrubar depois

```bash
netstat -ano | grep ":<PORTA>" | grep LISTENING   # achar o PID
taskkill //PID <PID> //F                          # mata server + cloudflared filho junto
```

## Notas

- Instabilidade do quick tunnel (`*.trycloudflare.com`) é do lado da Cloudflare (sem SLA, sem conta) — não é um timeout configurado no código do Fusion. `packages/server/src/tunnel/tunnel-manager.ts` só tem um timeout de 20s pra **detectar a URL na subida**, nada que derrube a sessão depois de conectado.
- Se a instabilidade for recorrente na prática, alternativa mais estável documentada em `docs/design/m6-distribuicao.md` é Tailscale/ZeroTier (mas exige instalar do lado de quem entra — pior para "manda o link e entra pelo navegador").
