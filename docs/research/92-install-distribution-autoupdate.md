# 92 — Instalação, Distribuição e Auto-Update do App do GM

> Pesquisa de referência para o Fusion VTT — escrita em clean-room.
> Abordagem: descrever comportamentos, conceitos e formatos; nunca copiar código proprietário.
> Data: 2026-06-11

---

## Sumário

1. [Como o Foundry VTT Distribui — Referência de Benchmark](#1-como-o-foundry-vtt-distribui--referência-de-benchmark)
2. [Tauri v2 como Wrapper — Visão Geral](#2-tauri-v2-como-wrapper--visão-geral)
3. [Formatos de Instalador por Plataforma](#3-formatos-de-instalador-por-plataforma)
4. [Code Signing e Notarização](#4-code-signing-e-notarização)
5. [Mecanismos de Auto-Update](#5-mecanismos-de-auto-update)
6. [Versionamento: Servidor vs Cliente](#6-versionamento-servidor-vs-cliente)
7. [Bootstrapping: Discovery e Conexão dos Jogadores](#7-bootstrapping-discovery-e-conexão-dos-jogadores)
8. [Primeira Execução e Onboarding](#8-primeira-execução-e-onboarding)
9. [Empacotamento do Runtime Node.js e Módulos Nativos](#9-empacotamento-do-runtime-nodejs-e-módulos-nativos)
10. [Pipeline de Release com GitHub Actions](#10-pipeline-de-release-com-github-actions)
11. [Análise de Trade-offs para o Fusion](#11-análise-de-trade-offs-para-o-fusion)
12. [Fontes](#12-fontes)

---

## 1. Como o Foundry VTT Distribui — Referência de Benchmark

### Modalidades de distribuição

O Foundry VTT (Foundry Gaming LLC) oferece quatro modalidades de instalação:

| Modalidade                 | Plataforma            | Descrição                                                     |
| -------------------------- | --------------------- | ------------------------------------------------------------- |
| **Electron App**           | Windows, macOS, Linux | Pacote pré-compilado com servidor Node.js + Chromium embutido |
| **Node.js Package**        | Multiplataforma       | Arquivo `.zip` rodado com `node main.js`; headless (sem GUI)  |
| **Windows Portable Build** | Windows (V13+)        | `.zip` autocontido; não requer instalador tradicional         |
| **Partner Hosting**        | Qualquer              | Provedores como The Forge, Molten, Sqyre                      |

### Estatísticas de adoção (Year in Review 2025)

Dados oficiais publicados pelo próprio Foundry:

| Método             | % de usuários |
| ------------------ | ------------- |
| Windows + Electron | 68,35%        |
| Hosting providers  | 17,10%        |
| Linux + Node.js    | 9,66%         |
| macOS + Electron   | 2,85%         |
| Linux + Electron   | 1,19%         |
| Windows + Node.js  | 0,76%         |
| macOS + Node.js    | 0,06%         |

**Conclusão para o Fusion:** o empacotamento Electron (ou equivalente Tauri) é a forma majoritária de entrega — **72% dos usuários usam o app de desktop**. Node.js headless representa ~10% e fica restrito a power users. O Fusion deve priorizar o app de desktop e oferecer o servidor headless como modo avançado.

### Modelo de licença e download

O Foundry usa **links de download temporários** (expiram em 5 minutos) gerados pelo portal após autenticação com a licença. A licença em si é perpétua. Na primeira execução, o app solicita a chave de licença e valida online (exige conexão para esse passo). Após validação, o software pode rodar totalmente offline.

### Estrutura de versões e canais de update

O Foundry mantém três canais:

- **Stable** — produção, recomendado para jogos ativos
- **Testing** — testes de novas features com a comunidade ampla
- **Development** — fase de design e API; maior instabilidade

No V13, a estrutura de arquivos mudou: o ponto de entrada passou de `resources/app/main.js` (V12) para `main.js` (V13+).

---

## 2. Tauri v2 como Wrapper — Visão Geral

### Por que Tauri v2 em vez de Electron

O Tauri v2 foi escolhido nos documentos anteriores do Fusion como wrapper de desktop. A tabela abaixo justifica:

| Critério                  | Electron 30.x    | Tauri v2.x                          |
| ------------------------- | ---------------- | ----------------------------------- |
| Tamanho do instalador     | ~180 MB          | ~12 MB                              |
| RAM idle                  | ~450 MB          | ~85 MB                              |
| Cold start (Windows 11)   | ~12 s            | ~1,8 s                              |
| Bundling Chromium         | Sim (sempre)     | Não (usa WebView do OS)             |
| Runtime incluído          | Node.js 22       | Rust core (sem Node por padrão)     |
| Suporte a sidecar Node.js | Via main process | Via plugin sidecar + `@yao-pkg/pkg` |
| Auto-updater nativo       | electron-updater | tauri-plugin-updater                |

O Tauri v2 atingiu estabilidade em outubro de 2024; a linha atual é **2.9.x** (última: 2.9.6, dezembro 2025).

### Arquitetura do Fusion com Tauri

No Fusion, o Tauri atua como **shell de desktop** em torno de um servidor Node.js (o "motor" do Fusion, que serve o VTT via HTTP/WebSocket):

```
┌─────────────────────────────────────────────────────────────────┐
│  Tauri v2 (Rust core)                                           │
│  ┌──────────────────────┐    ┌───────────────────────────────┐  │
│  │  WebView (UI do GM)  │    │  Sidecar: fusion-server        │  │
│  │  React / Vue / etc.  │◄──►│  Node.js compilado via pkg    │  │
│  │  Roda localhost:5173 │    │  Porta padrão: 30000           │  │
│  └──────────────────────┘    └───────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                │ HTTP / WS
        ┌───────▼────────┐
        │  Jogadores     │
        │  (navegador)   │
        └────────────────┘
```

O WebView interno do Tauri exibe a **UI de gerenciamento do GM**, enquanto o sidecar Node.js expõe o servidor de jogo para os jogadores. Comunicação interna: `localhost` via HTTP ou WebSocket.

---

## 3. Formatos de Instalador por Plataforma

### Windows

O Tauri v2 gera dois formatos distintos, não mutuamente exclusivos:

#### MSI (WiX Toolset v3)

- Gerado em `target/release/bundle/msi/`
- **Só pode ser compilado em Windows** (WiX não roda em Linux/macOS)
- Padrão para instalação por máquina (`Program Files`)
- Suporta customização via fragmentos WiX e templates Handlebars
- Não suporta ARM64 nativamente (apenas x86/x64)

#### NSIS (`-setup.exe`)

- Gerado em `target/release/bundle/nsis/`
- **Cross-compilation disponível** (pode ser compilado em Linux/macOS para Windows)
- Suporte a instalação por usuário (sem privilégios de admin) ou por máquina
- Suporte a Windows 7 com modo `embedBootstrapper` para WebView2
- Suporte nativo a ARM64 (o app roda ARM64; o instalador ainda é x86 via emulação)
- Recomendado para o Fusion por flexibilidade

**Recomendação para o Fusion:** usar NSIS como formato principal (permite build cross-platform em CI e instalação por usuário sem UAC prompt).

#### WebView2 no Windows

O WebView2 é obrigatório para o Tauri no Windows. Quatro estratégias de provisioning:

| Estratégia             | Tamanho extra | Requer internet | Quando usar                   |
| ---------------------- | ------------- | --------------- | ----------------------------- |
| `downloadBootstrapper` | 0 MB          | Sim             | Instalador menor; Windows 10+ |
| `embedBootstrapper`    | +1,8 MB       | Sim             | Windows 7+ compat             |
| `offlineInstaller`     | +127 MB       | Não             | Ambientes offline             |
| `fixedVersion`         | +180 MB       | Não             | Controle total de versão      |

Para o Fusion, `downloadBootstrapper` é suficiente (Windows 10+ como baseline).

### macOS

- Formato: **DMG** (disk image) para distribuição direta
- App Bundle (`.app`) dentro do DMG
- Notarização obrigatória para distribuição fora da Mac App Store
- Suporte a `x86_64` (Intel) e `aarch64` (Apple Silicon) — builds separados ou universal binary

### Linux

| Formato      | Descrição                     |
| ------------ | ----------------------------- |
| **AppImage** | Portátil; roda sem instalação |
| **DEB**      | Debian/Ubuntu                 |
| **RPM**      | Fedora/RHEL                   |
| **Snap**     | Snapcraft                     |
| **Flatpak**  | Sandbox universal             |
| **AUR**      | Arch User Repository          |

Para o Fusion, **AppImage + DEB** são suficientes para MVP.

---

## 4. Code Signing e Notarização

### Windows — Opções de Certificado

#### OV (Organization Validation) — Tradicional

- Custo: **~$200–300/ano** via Sectigo, DigiCert, etc.
- **Desde junho de 2023**, CAs não emitem mais OV em arquivo exportável — novo OV exige HSM (hardware security module) ou serviço cloud
- SmartScreen vai exibir warning inicialmente; reputação se acumula com o tempo
- **EV (Extended Validation):** anteriormente eliminava warning imediato do SmartScreen, mas **desde março de 2024 essa vantagem foi removida** — EV agora passa pelo mesmo processo de reputação que OV

#### Microsoft Trusted Signing / Azure Artifact Signing

- Custo: **$9,99/mês** (até 5.000 assinaturas); $99,99/mês (até 100.000)
- Disponível para desenvolvedores individuais (US, Canada, EU, UK)
- Requer .NET 8, Azure CLI e `signtool` (Windows 11 SDK 10.0.26100.0+)
- Integração com CI via variáveis de ambiente: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`
- Signing funciona de qualquer plataforma (Linux/macOS também)
- **Recomendado para o Fusion** pelo custo e pela ausência de hardware token

#### SignPath Foundation (open-source gratuito)

- Gratuito para projetos open-source qualificados
- Se o Fusion for open-source desde o início, vale aplicar

### macOS — Code Signing e Notarização

- Requer **Apple Developer Program**: **$99/ano**
- Certificado: **Developer ID Application** (.p12 exportado para base64 em CI)
- Notarização: Tauri faz automaticamente via `xcrun notarytool`; credenciais via env vars:
  - `APPLE_ID` — e-mail da conta Apple
  - `APPLE_PASSWORD` — app-specific password
  - `APPLE_TEAM_ID` — string de 10 caracteres
  - Alternativa API: `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`
- **Sem notarização**, macOS bloqueia ou exibe aviso grave ao abrir o app
- Entitlements necessários para WebView: `com.apple.security.cs.allow-jit`

### Linux

- Code signing disponível mas não obrigatório para distribuição fora das stores
- Para Flatpak/Snap, as plataformas têm mecanismos próprios de revisão

### Resumo de custos anuais de signing

| Plataforma       | Serviço                            | Custo/ano     |
| ---------------- | ---------------------------------- | ------------- |
| Windows          | Azure Artifact Signing ($9,99/mês) | ~$120         |
| macOS            | Apple Developer Program            | $99           |
| Linux            | Não obrigatório                    | $0            |
| **Total mínimo** |                                    | **~$220/ano** |

---

## 5. Mecanismos de Auto-Update

### tauri-plugin-updater (opção principal)

O Tauri v2 inclui um plugin oficial de auto-update com as seguintes características:

#### Assinatura criptográfica (obrigatória, não pode ser desabilitada)

1. Gerar par de chaves: `tauri signer generate -w ~/.tauri/fusion.key`
2. A chave privada é configurada via env var `TAURI_SIGNING_PRIVATE_KEY` no CI
3. Durante o build, Tauri gera arquivos `.sig` (assinatura) junto com cada instalador
4. A chave pública fica hardcoded em `tauri.conf.json` → `plugins.updater.pubkey`
5. O cliente verifica a assinatura antes de instalar qualquer update

#### Formato do manifesto de versão (`latest.json`)

Dois formatos suportados:

**Formato estático** (para GitHub Releases, S3, CDN):

```json
{
  "version": "1.2.0",
  "notes": "Correções de bugs e melhorias de performance",
  "pub_date": "2026-06-11T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://releases.fusion.app/1.2.0/fusion_1.2.0_x64-setup.exe",
      "signature": "<conteúdo do arquivo .sig>"
    },
    "darwin-x86_64": {
      "url": "https://releases.fusion.app/1.2.0/fusion_1.2.0_x64.dmg",
      "signature": "<conteúdo do arquivo .sig>"
    },
    "darwin-aarch64": {
      "url": "https://releases.fusion.app/1.2.0/fusion_1.2.0_aarch64.dmg",
      "signature": "<conteúdo do arquivo .sig>"
    },
    "linux-x86_64": {
      "url": "https://releases.fusion.app/1.2.0/fusion_1.2.0_amd64.AppImage",
      "signature": "<conteúdo do arquivo .sig>"
    }
  }
}
```

**Nota:** a partir do `tauri-plugin-updater` 2.10.0, a `latest.json` gerada pelo `tauri-action` usa chaves no formato `{os}-{arch}-{installer}` para suportar múltiplos formatos por plataforma.

**Formato dinâmico** (servidor HTTP que responde por target):

O endpoint recebe variáveis na URL: `{{target}}`, `{{arch}}`, `{{current_version}}`. O servidor responde 200 com JSON `{url, version, signature}` se há update, ou 204 se não há.

Exemplo de endpoint parametrizado:

```
https://updates.fusion.app/{{target}}/{{arch}}/{{current_version}}
```

#### Configuração em `tauri.conf.json`

```json
{
  "plugins": {
    "updater": {
      "pubkey": "CONTEÚDO_DA_CHAVE_PUBLICA",
      "endpoints": ["https://releases.fusion.app/latest.json"]
    }
  }
}
```

#### Comportamento por plataforma

| Plataforma | Comportamento                                                                    |
| ---------- | -------------------------------------------------------------------------------- |
| Windows    | App encerra automaticamente durante instalação; hook `on_before_exit` disponível |
| macOS      | Instalação padrão; relaunch após update                                          |
| Linux      | `.tar.gz` gerado para updates; AppImage substituído                              |

#### Controle de versão e rollout

- Versões devem seguir **SemVer** (1.0.0 ou v1.0.0)
- Por padrão, só instala se versão nova > versão atual
- Com `version_comparator` customizado é possível forçar downgrade (útil para rollback de emergência)
- O servidor pode implementar **phased rollout** (ex.: 10% → 50% → 100%) por IP/identificador

### electron-updater (alternativa)

Se o Fusion for migrado para Electron no futuro (improvável dado o doc 15), o `electron-updater` é a alternativa matura. Suporta: delta updates, feeds via GitHub Releases/S3/servidor próprio, assinatura com certificado existente. Mais verboso para configurar que o updater do Tauri.

### CrabNebula Cloud

Parceria oficial Tauri: CDN gerenciado com suporte nativo ao `tauri-plugin-updater`, métricas de download, update server integrado. Alternativa ao GitHub Releases para projetos que precisam de escala ou analytics. Tem plano gratuito para open-source.

---

## 6. Versionamento: Servidor vs Cliente

O Fusion tem dois componentes versionados independentemente:

| Componente                          | O que é                                       | Estratégia                                                    |
| ----------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| **Shell Tauri** (cliente GM)        | Wrapper Tauri + UI de gerenciamento           | Versionado como app desktop; updates via tauri-plugin-updater |
| **fusion-server** (sidecar Node.js) | Motor do VTT: HTTP, WebSocket, banco de dados | Versionado junto com o shell (mesmo artefato)                 |

### Recomendação: versionar juntos no MVP

No MVP, o servidor Node.js (sidecar) é empacotado **dentro** do instalador Tauri. Uma única versão (ex.: `1.2.0`) cobre ambos. Isso simplifica updates e elimina problemas de compatibilidade client/server.

Para versões futuras, se o servidor puder rodar headless (sem Tauri), pode-se desacoplar:

- O shell Tauri atualiza pelo `tauri-plugin-updater`
- O servidor headless distribui via npm, Docker ou pacote separado

### Compatibilidade de protocolo

O servidor deve incluir versão de protocolo no handshake WebSocket. Clientes antigos recebem mensagem de "versão incompatível" com link para update, em vez de comportamento silencioso corrompido.

---

## 7. Bootstrapping: Discovery e Conexão dos Jogadores

### Abordagem do Foundry (referência)

O Foundry opera na porta **30000** por padrão. Após iniciar o servidor, o GM acessa a tela de configuração e navega até **Game Access → Invitation Links**, onde o sistema exibe:

- **URL LAN:** endereço local (ex.: `http://192.168.1.50:30000`) — para jogadores na mesma rede
- **URL externa:** IP público com a mesma porta — requer port forwarding ou tunelamento

O Foundry suporta **UPnP** (habilitado por padrão) para configurar automaticamente o port forwarding no roteador.

### Estratégia de conexão para o Fusion

#### Camada 1: LAN (rede local)

1. O servidor fusion detecta automaticamente o IP LAN da máquina
2. A UI do GM exibe uma **URL de convite LAN** (ex.: `http://192.168.1.42:30000`)
3. Opcional: exibir **QR code** que os jogadores escaneiam com o celular para abrir o navegador
4. Opcional: **mDNS/Bonjour discovery** — o servidor anuncia `fusion.local` na rede local; jogadores na mesma rede podem digitar o hostname amigável

#### Camada 2: Internet (acesso remoto)

Sem infraestrutura própria, as opções são:

| Opção                                               | Complexidade GM                  | Custo            | Latência |
| --------------------------------------------------- | -------------------------------- | ---------------- | -------- |
| **Port forwarding manual**                          | Alta (requer acesso ao roteador) | $0               | Mínima   |
| **UPnP automático**                                 | Baixa (automático, se suportado) | $0               | Mínima   |
| **Túnel integrado** (ex.: Cloudflare Tunnel, ngrok) | Muito baixa                      | $0–$20/mês       | Moderada |
| **Relay TURN**                                      | Nenhuma para o GM                | Infra necessária | Moderada |

**Recomendação para o Fusion:**

- Implementar UPnP opcional (como o Foundry)
- Integrar um **túnel Cloudflare** (gratuito, zero config) como fallback quando UPnP falha ou o GM quer compartilhar com jogadores externos
- A URL gerada pelo túnel é exibida ao lado da URL LAN

#### Link de convite

O link deve ser uma URL HTTP simples que o GM copia e envia por Discord/WhatsApp. Formato proposto:

```
http://192.168.1.42:30000/join?token=abc123
```

- `token` opcional para autenticação básica (evita strangers na sessão)
- Expiração configurável (ex.: token válido por 24h)

---

## 8. Primeira Execução e Onboarding

### O que o Foundry faz na primeira execução

1. **Licença:** o GM cola a chave de licença; validação online obrigatória neste passo
2. **EULA:** exibição e aceite do End User License Agreement
3. **Data sharing opt-in/opt-out:** coleta de dados anônimos de uso
4. **Setup Screen:** tela principal do Foundry com as abas Setup, Configuration, Update
5. **Admin password:** o GM define senha para proteger a tela de setup (criptografada)
6. **Data directory:** o app usa `options.json` para persistir o `dataPath`; no portable build, cria subpastas `Config`, `Data`, `Logs` no mesmo diretório

### Proposta de onboarding para o Fusion

O Fusion não tem licença a verificar (distribuição aberta), simplificando o fluxo:

**Passo 1 — Seleção de diretório de dados**

- Wizard pergunta onde salvar os dados do Fusion (Worlds, Systems, Assets)
- Default inteligente: `%USERPROFILE%\Documents\FusionVTT` (Windows), `~/Documents/FusionVTT` (macOS/Linux)
- Permitir instalação portátil (pasta ao lado do executável)

**Passo 2 — Configuração de rede**

- Porta do servidor (default: 30000; verificar se está livre)
- UPnP: habilitar/desabilitar
- Configuração SSL opcional (certificado próprio ou Let's Encrypt para domínio customizado)

**Passo 3 — Senha de administrador**

- Protege a tela de configuração do GM contra acesso não autorizado por jogadores

**Passo 4 — Verificação de conectividade**

- O app testa se a porta está acessível
- Exibe as URLs de convite (LAN + externa)
- Opção "Testar agora" que abre a URL de join em uma aba do navegador

**Passo 5 — Importar dados (opcional)**

- Importar backup de sessão anterior
- Instalar sistema de jogo (PF2e, SF2e, Etmos)

O onboarding deve ser executado apenas na primeira vez; deve ser re-executável via "Setup → Reconfigure" sem reinstalar o app.

---

## 9. Empacotamento do Runtime Node.js e Módulos Nativos

### O problema

O servidor do Fusion é um app Node.js que usa `better-sqlite3` — um addon nativo (`.node` file compilado com node-gyp). O usuário final não deve precisar ter Node.js instalado. Isso exige empacotar:

1. O runtime Node.js
2. O código JavaScript do servidor
3. O addon nativo `better-sqlite3.node` compilado para cada plataforma/arch

### Opção A: `@yao-pkg/pkg` (fork ativo do vercel/pkg)

Compila o app Node.js em um executável único por plataforma.

**Processo:**

```bash
# Instalar como devDependency
npm install --save-dev @yao-pkg/pkg

# Compilar para todas as plataformas-alvo
pkg index.js \
  --targets node22-win-x64,node22-macos-x64,node22-macos-arm64,node22-linux-x64 \
  --output fusion-server
```

Saída:

- `fusion-server-x64-pc-windows-msvc.exe`
- `fusion-server-x86_64-apple-darwin`
- `fusion-server-aarch64-apple-darwin`
- `fusion-server-x86_64-unknown-linux-gnu`

Esses binários ficam em `src-tauri/binaries/` com sufixo de target triple. O Tauri os inclui automaticamente no bundle.

**Limitação crítica com `better-sqlite3`:**

O `pkg` tem suporte parcial a addons nativos. O arquivo `.node` **não pode ser embutido** no binário; precisa ficar como arquivo externo. Estratégias:

1. **Copiar o `.node` como resource do Tauri:** o arquivo `better-sqlite3.node` fica em `resources/`, e o servidor usa `process.resourcesPath` para localizar o addon
2. **Rebuildar com `node-pre-gyp` durante o build:** compilar o addon para cada target triple antes de empacotar
3. **Substituir `better-sqlite3` por SQLite puro-Rust:** usar o plugin Tauri para SQLite (`tauri-plugin-sql` com backend SQLite), removendo o problema de addon nativo completamente

**Alternativa fortemente recomendada:** mover o SQLite para o lado Rust do Tauri (via `tauri-plugin-sql`). O servidor Node.js se comunica com o banco via IPC Tauri em vez de direct access. Isso elimina todos os problemas de addon nativo cross-platform.

### Opção B: Node.js SEA (Single Executable Application)

Node.js 21.7.3+ inclui suporte nativo a SEA sem ferramentas externas. Node 25.5 (janeiro 2026) simplificou o build com `node --build-sea sea-config.json`.

**Limitações para o Fusion:**

- **Não suporta native addons embutidos no binário** — addons `.node` precisam existir como arquivo externo (mesmo problema do pkg)
- Não tem VFS: dependências que fazem `fs.readFile` de `node_modules` não funcionam dentro do SEA
- O Node.js não é incluído no SEA de forma transparente para cross-compilation (precisa do binário de cada plataforma)

### Opção C: Tauri Sidecar com Node.js embutido

O Tauri também suporta embutir o runtime Node.js (via `externalBin` apontando para o binário `node` em si), mas isso aumenta o tamanho do app em ~50 MB e não é a abordagem recomendada pela documentação oficial.

### Recomendação arquitetural para o Fusion

```
┌─────────────────────────────────────────────────────┐
│  Tauri Rust core                                     │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │  tauri-plugin-  │  │  SQLite via              │  │
│  │  sql (SQLite)   │  │  tauri-plugin-sql        │  │
│  └─────────────────┘  └──────────────────────────┘  │
│  ┌──────────────────────────────────────────────┐    │
│  │  Sidecar: fusion-server (Node.js via pkg)    │    │
│  │  Sem better-sqlite3; usa IPC Tauri para DB   │    │
│  │  Expõe HTTP/WS na porta 30000               │    │
│  └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

Isso resulta em:

- Addon nativo zero no sidecar Node.js
- SQLite gerenciado pelo Rust (mais performático, sem problemas de rebuild)
- Sidecar é JavaScript puro, empacotável com `pkg` sem problemas

---

## 10. Pipeline de Release com GitHub Actions

### Workflow recomendado (`tauri-action`)

O `tauri-apps/tauri-action` é a action oficial que constrói e assina o app para todas as plataformas em paralelo:

**Plataformas necessárias:**

- `windows-latest` → `x86_64-pc-windows-msvc`
- `macos-latest` → `x86_64-apple-darwin` + `aarch64-apple-darwin`
- `ubuntu-22.04` → `x86_64-unknown-linux-gnu`

**Secrets necessários (11 total):**

| Categoria       | Secret                               | Descrição                       |
| --------------- | ------------------------------------ | ------------------------------- |
| macOS signing   | `APPLE_CERTIFICATE`                  | .p12 em base64                  |
| macOS signing   | `APPLE_CERTIFICATE_PASSWORD`         | senha do .p12                   |
| macOS signing   | `APPLE_SIGNING_IDENTITY`             | Developer ID: Nome (TEAMID)     |
| macOS signing   | `APPLE_TEAM_ID`                      | 10 caracteres                   |
| macOS notarize  | `APPLE_ID`                           | e-mail Apple                    |
| macOS notarize  | `APPLE_PASSWORD`                     | app-specific password           |
| Windows signing | `AZURE_CLIENT_ID`                    | App registration                |
| Windows signing | `AZURE_TENANT_ID`                    | Tenant ID                       |
| Windows signing | `AZURE_CLIENT_SECRET`                | Secret (exibido apenas uma vez) |
| Updater         | `TAURI_SIGNING_PRIVATE_KEY`          | chave privada do updater        |
| Updater         | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | senha da chave                  |

**Trigger:** tag semver (`v*.*.*`) faz o workflow gerar artefatos assinados e criar GitHub Release automaticamente.

### Distribuição pós-build

Opções em ordem crescente de sofisticação:

1. **GitHub Releases + `latest.json` manual** — gratuito; bom para MVP
2. **CrabNebula Cloud** — CDN + update server integrado; plano gratuito open-source
3. **S3/R2 + servidor próprio** — controle total; custo baixo para volumes moderados

Para o MVP do Fusion, **GitHub Releases** é suficiente. O `tauri-action` cria a release e faz upload dos artefatos; o `latest.json` pode ser gerado pelo mesmo workflow.

---

## 11. Análise de Trade-offs para o Fusion

### Decisões arquiteturais confirmadas

| Decisão                 | Escolha                              | Justificativa                                       |
| ----------------------- | ------------------------------------ | --------------------------------------------------- |
| Wrapper de desktop      | Tauri v2                             | Bundle menor, sem Chromium embutido, updater nativo |
| Installer Windows       | NSIS                                 | Cross-compile em CI, per-user sem UAC               |
| Code signing Windows    | Azure Artifact Signing               | $9,99/mês vs $300+/ano; sem hardware token          |
| Code signing macOS      | Apple Developer ($99/ano)            | Obrigatório; notarização automática via Tauri       |
| Auto-updater            | tauri-plugin-updater                 | Nativo, criptografado, obrigatório                  |
| Update manifest hosting | GitHub Releases (MVP)                | Gratuito, simples                                   |
| Node.js bundling        | `@yao-pkg/pkg`                       | Binário autocontido; sem deps para o usuário        |
| Addon nativo SQLite     | Mover para Rust (`tauri-plugin-sql`) | Elimina addon nativo cross-platform                 |
| Player discovery (LAN)  | URL de convite + QR code             | Padrão UX; o Foundry valida                         |
| Player discovery (WAN)  | UPnP + Cloudflare Tunnel opcional    | Zero config para maioria dos GMs                    |

### Riscos e mitigações

| Risco                            | Probabilidade                                  | Mitigação                                                   |
| -------------------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| WebView2 ausente em Windows      | Baixa (Windows 10+ tem; Windows 11 sempre tem) | `downloadBootstrapper` no NSIS                              |
| `pkg` não embutir addon `.node`  | Alta se mantiver `better-sqlite3`              | Mover SQLite para Rust                                      |
| Reputação SmartScreen (Windows)  | Alta (primeiros meses)                         | Azure Artifact Signing constrói reputação gradual           |
| macOS Gatekeeper bloqueando      | Certa sem notarização                          | Apple Developer + notarização automática Tauri              |
| UPnP falhar no roteador          | Moderada                                       | Cloudflare Tunnel como fallback; documentar port forwarding |
| Node.js target triple no sidecar | Moderada (ARM64 Windows)                       | Compilar para todos os targets no CI                        |

---

## 12. Fontes

- [Foundry VTT — Installation Guide](https://foundryvtt.com/article/installation/)
- [Foundry VTT — Hosting Options Guide](https://foundryvtt.com/article/hosting/)
- [Foundry VTT — Application Configuration](https://foundryvtt.com/article/configuration/)
- [Foundry VTT — Versioning and Releases](https://foundryvtt.com/article/versioning/)
- [Foundry VTT — Year in Review 2025 (dados de adoção)](https://foundryvtt.com/article/year-in-review-2025/)
- [DeepWiki — Foundry VTT Installation and Setup](https://deepwiki.com/foundryvtt/foundryvtt/2-installation-and-setup)
- [DeepWiki — Foundry VTT Hosting Options](https://deepwiki.com/foundryvtt/foundryvtt/2.2-hosting-options)
- [Tauri v2 — Distribute Overview](https://v2.tauri.app/distribute/)
- [Tauri v2 — Windows Installer](https://v2.tauri.app/distribute/windows-installer/)
- [Tauri v2 — Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/)
- [Tauri v2 — macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri v2 — Updater Plugin](https://v2.tauri.app/plugin/updater/)
- [Tauri v2 — Node.js as Sidecar](https://v2.tauri.app/learn/sidecar-nodejs/)
- [Tauri v2 — Embedding External Binaries](https://v2.tauri.app/develop/sidecar/)
- [Tauri v2 — Deep Linking Plugin](https://v2.tauri.app/plugin/deep-linking/)
- [Tauri v2 — CrabNebula Cloud Distribution](https://v2.tauri.app/distribute/crabnebula-cloud/)
- [Tauri v2 — GitHub Actions Pipeline](https://v2.tauri.app/distribute/pipelines/github/)
- [tauri-apps/tauri-action — GitHub](https://github.com/tauri-apps/tauri-action)
- [@yao-pkg/pkg — npm](https://www.npmjs.com/package/@yao-pkg/pkg)
- [yao-pkg/pkg — GitHub](https://github.com/yao-pkg/pkg)
- [Node.js SEA — Single Executable Applications docs](https://nodejs.org/api/single-executable-applications.html)
- [Ship Your Tauri v2 App Like a Pro: Code Signing (DEV Community)](https://dev.to/tomtomdu73/ship-your-tauri-v2-app-like-a-pro-code-signing-for-macos-and-windows-part-12-3o9n)
- [Ship Your Tauri v2 App Like a Pro: GitHub Actions (DEV Community)](https://dev.to/tomtomdu73/ship-your-tauri-v2-app-like-a-pro-github-actions-and-release-automation-part-22-2ef7)
- [Shipping a Production macOS App with Tauri 2.0 (DEV Community)](https://dev.to/0xmassi/shipping-a-production-macos-app-with-tauri-20-code-signing-notarization-and-homebrew-mc3)
- [Microsoft — Code Signing Options for Windows App Developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- [Azure Artifact Signing — Pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)
- [Trusted Signing now open for individual developers (Microsoft Community Hub)](https://techcommunity.microsoft.com/blog/microsoft-security-blog/trusted-signing-is-now-open-for-individual-developers-to-sign-up-in-public-previ/4273554)
- [Apple Developer Program — $99/year](https://developer.apple.com/programs/)
- [Tauri vs Electron — Comparação 2026 (PkgPulse)](https://www.pkgpulse.com/guides/electron-vs-tauri-2026)
- [How to make auto-updates work with Tauri v2 and GitHub (That Gurjot)](https://thatgurjot.com/til/tauri-auto-updater/)
- [Foundry VTT Self Hosting Guide — Pinggy](https://pinggy.io/blog/foundry_vtt/)
- [Foundry VTT Community Wiki — Local Play](https://foundryvtt.wiki/en/setup/hosting/Local-play)
- [CrabNebula Cloud — Tauri Auto-Updates Docs](https://docs.crabnebula.dev/cloud/guides/auto-updates-tauri/)
