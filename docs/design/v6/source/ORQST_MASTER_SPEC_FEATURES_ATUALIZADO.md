# ORQST — Especificação mestra para implementação no Codex
**Versão:** 1.0 · **Data:** 04/11/2026 · **Status:** diretiva de implementação, sujeita à auditoria do repositório atual

> **OBJETIVO INEGOCIÁVEL:** migrar o desktop do ORQST para Tauri 2 e entregar terminais multiagentes operacionais, com experiência visual moderna, reaproveitando **código real** de projetos existentes quando compatível. Não entregar apenas análises, mockups ou novos documentos. Não reescrever módulos funcionais sem justificativa.

## 1. Contexto e resultado esperado

O ORQST é um desktop para supervisionar, controlar e orquestrar agentes de programação executados por CLIs reais. O produto deve permitir que o usuário abra múltiplos terminais, escolha os respectivos agentes, atribua nomes e papéis, conecte terminais por menções `@`, delegue tarefas, acompanhe execução e se recupere de falhas sem reiniciar a aplicação.

**Dois conjuntos de requisitos devem ser atendidos integralmente:**
1. **Arquitetura e reutilização:** Tauri 2 + React/TypeScript + Core Node.js + SQLite, inspeção e reaproveitamento efetivo de Anywh, Tucano e Overclock.
2. **Experiência visual e operacional:** terminais que possam ser criados, fechados, ocultados, expandidos, redimensionados, reorganizados, renomeados, designados como orquestradores e conectados por mensagens/menções.

A implementação **não deve** ficar limitada ao par A/B: suportar 1, 2, 3, 6 ou mais agentes, conforme capacidade da máquina.

## 2. Fontes de referência e o que verificar

| Projeto | Repositório / fonte | Estudar prioritariamente | O que NÃO assumir |
|---|---|---|---|
| **Anywh** | https://github.com/anywh-sh/anywh | Tauri, React, Relay Node.js, runtimes/CLI adapters, Codex, Claude, ciclo de vida de sessões, Agent Host, reconexão | Que seus módulos são plug-and-play no ORQST |
| **Tucano** | https://github.com/eduwxyz/tucano | Electron/React, criação e colaboração de agentes, canais, menções, roteamento, delegação e UX | Que roteador, JEV ou browser use estejam disponíveis em código público sem verificar |
| **Overclock** | https://overclock.sh | UX de panes, composição de terminais, navegação e comunicação | Que haja repositório/licença pública reutilizável: localizar e comprovar antes de copiar |
| **ORQST atual** | repositório local sob trabalho do Codex; GitHub: https://github.com/walissonhms/orqst | Core, React, persistência, PTY, telemetria, identidade visual, implementações existentes | Que o estado atual corresponda a documentos antigos |

**Links técnicos do Anywh a inspecionar:**
- https://github.com/anywh-sh/anywh/blob/main/docs/architecture.md
- https://github.com/anywh-sh/anywh/blob/main/docs/agent-host.md
- https://github.com/anywh-sh/anywh/blob/main/relay/src/runtimes/README.md

**Importante:** as referências acima são pontos de partida indicados em discussões anteriores; o Codex deve validar existência, versão/commit, licença e comportamento no código-fonte antes de afirmar qualquer integração. Registrar links permanentes com SHA de commit e caminhos exatos. A licença atribuída anteriormente a Anywh e Tucano foi Apache-2.0, mas **revalidar `LICENSE`, `NOTICE` e licenças de dependências** no commit efetivamente utilizado. Para Overclock, não presumir licença.

## 3. Stack alvo e responsabilidades

| Camada | Tecnologia | Responsabilidade |
|---|---|---|
| Shell desktop | **Tauri 2** (Rust somente na integração nativa necessária) | Janela, menu, bandeja, atalhos, notificações, ciclo de vida do sidecar, permissões |
| Frontend | **React + TypeScript + Tailwind** | Layout, panes, abas, ações, estado visual, dashboards |
| Terminal UI | **xterm.js**, caso já presente ou aprovado na auditoria | Emulação VT, entrada/saída e resize do terminal |
| Core | **Node.js 24**, como processo local independente/sidecar | CLIs, PTY, sessões, orquestração, mensagens, telemetria |
| Transporte | **API local + WebSocket**, preservando contratos existentes quando possível | Comandos, eventos e stream de terminal |
| Persistência | **SQLite** | Agentes, workspaces, equipes, terminais, vínculos, mensagens, eventos e preferências |
| CLIs | **Codex, Claude Code, OpenCode**, extensível a Pi, DeepSeek Harness, Ollama e outros | Execução real por adaptadores independentes |
| Testes | **Vitest + testes de integração/E2E adequados ao repositório** | Validação de fluxo, falhas, contratos e interface |

Não migrar automaticamente o Core Node.js para Rust. Não executar CLIs diretamente no processo de renderização do Tauri. Se o Core usar `node-pty`, verificar empacotamento e compatibilidade por plataforma; preservar PTY existente quando confiável.

### 3.1 Diagrama lógico

```text
┌─────────────────────────────────────────────────────────────┐
│ ORQST Desktop · Tauri 2                                     │
│ React/TS · Workspace · Panes · Terminal · Dashboard         │
└──────────────────────────┬──────────────────────────────────┘
                           │ API local + WebSocket
┌──────────────────────────▼──────────────────────────────────┐
│ ORQST Core · Node.js 24                                     │
│ Session Manager │ Runtime Registry │ PTY Manager            │
│ Agent Router    │ Message Bus      │ Event/Metric Collector │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
       ┌───────▼────────┐             ┌────────▼─────────┐
       │ CLI adapters   │             │ SQLite           │
       │ Codex / Claude │             │ estado e eventos │
       │ OpenCode / ... │             └──────────────────┘
       └────────────────┘
```

## 4. Estratégia REUSE-FIRST: obrigatório implementar, não só documentar

### 4.1 Auditoria antes de qualquer alteração
1. Verificar `git status`, branch, alterações não commitadas e trabalho em andamento (inclusive eventual `pane-664`). Não sobrescrever trabalho de outros agentes.
2. Inventariar o Core, shell Electron, frontend, terminais, adaptadores, banco, IPC, WebSocket e testes.
3. Clonar/consultar fontes de referência em diretório de pesquisa separado; fixar commits.
4. Mapear arquivo/classe/função exata de cada componente candidato, dependências, licença e contratos.
5. Para cada candidato, decidir **reusar diretamente / adaptar / manter implementação ORQST / não utilizar**, com justificativa técnica e de licença.
6. Escolher **um primeiro componente reutilizável** que resolva problema real (prioridade: lifecycle/driver Codex ou Claude) e integrá-lo em pequena entrega testável.
7. Preservar atribuições e licenças de código incorporado; não copiar trechos com licença desconhecida.

### 4.2 Matriz de prioridade
| Ordem | Módulo | Fonte principal | Evidência exigida |
|---|---|---|---|
| P0 | Inicialização e recuperação isolada de CLI | Anywh | Arquivos/commits de origem, teste CLI real, falha isolada |
| P0 | Adaptadores Codex e Claude | Anywh | Contrato implementado, autenticação/erro tratados |
| P0 | Shell Tauri e ciclo de vida do Core | Anywh como referência | Instalador executa Core e fecha corretamente |
| P1 | Multi-pane terminal | ORQST existente + UX Overclock | Resize, abrir/fechar, foco, persistência |
| P1 | Menções e mensagens entre agentes | Tucano | Envio e recebimento comprovados em CLI real |
| P1 | Equipes e seleção de orquestrador | Tucano | Criação via UI, sem arquivo externo |
| P2 | Roteamento inteligente | Tucano, após auditoria | Política verificável, fallback manual |
| P2 | Browser use/JEV | Investigar separadamente | Identidade do projeto, licença, testes, autorização |

**Regra:** não implementar mecanismo paralelo se já existir equivalente estável no ORQST. Reaproveitamento significa código incorporado e testado, não apenas inspiração visual ou citação de README.

## 5. Modelo funcional dos terminais

### 5.1 Criar e gerenciar
Cada terminal tem `id` imutável, `displayName` editável, `mentionHandle` único, `runtimeId`, `workspaceId`, `sessionId`, `role`, `status`, `layoutState` e metadados de execução.

Ações obrigatórias:
- **Novo terminal:** selecionar CLI, modelo quando disponível, pasta de trabalho, nome e opcionalmente equipe.
- **Fechar terminal:** diferenciar *fechar pane* de *encerrar processo*; perguntar quando houver processo/tarefa ativa e risco de perda.
- **Ocultar/restaurar:** esconder visualmente sem interromper sessão.
- **Expandir/maximizar/restaurar:** ocupar a área de trabalho, voltar ao layout anterior sem perder sessão.
- **Redimensionar:** divisores arrastáveis, resize real de PTY (`cols`/`rows`) e xterm.
- **Mover/reordenar:** arrastar pane entre posições e abas, respeitando acessibilidade.
- **Renomear:** atualizar título e opcionalmente handle; evitar colisão de menções.
- **Duplicar configuração:** novo terminal com mesmas preferências, mas sessão/processo independentes.
- **Reiniciar/reconectar:** somente terminal afetado, sem bloquear os demais.
- **Persistir layout:** restaurar tamanho, ordem, abas, seleção e estado após reinício.

### 5.2 Papéis e orquestração
Permitir designar qualquer terminal como **Orquestrador** via menu de contexto, com indicador visual distinto e possibilidade de trocar de orquestrador. Papel é uma atribuição de coordenação, **não** uma autorização implícita para executar comandos perigosos. Permitir agentes executores e revisores; não exigir um orquestrador para uso básico.

Exemplo: `@frontend` (Claude) implementa interface; `@backend` (Codex) desenvolve API; `@reviewer` (OpenCode) revisa. O orquestrador pode delegar a qualquer um conforme permissões e configuração.

### 5.3 Menções e roteamento
- Cada terminal possui handle único, como `@terminal1`, `@terminal2`, `@codex-backend`.
- Campo de composição com autocomplete ao digitar `@`, incluindo nome, CLI, status e papel.
- O usuário escolhe **explicitamente quais terminais podem interagir**: matriz de permissões por origem/destino, incluindo bloqueio de autoenvio e ciclos.
- Mensagem `@terminal2 revise este diff` gera evento persistido com remetente, destinatário, payload, timestamp, correlationId e estado.
- Estados distinguíveis: **criada → enfileirada → enviada → entregue/aceita → em execução → concluída/falhou/cancelada**. Não afirmar “concluída” apenas porque foi escrita no PTY.
- Mostrar trilha de delegação, resposta e erros por terminal.
- Evitar loop A→B→A com limite de hops, deduplicação, TTL, cancelamento e regras de autorização.
- O roteamento automático é opcional e explicável; escolha explícita `@` tem precedência.
- Implementar ponte real com cada CLI. **Texto visualmente exibido em um pane não comprova que o agente o recebeu.**

### 5.4 Falhas e recuperação
- CLI ausente, sem autenticação, versão incompatível, spawn negado, PTY indisponível, crash e desconexão não podem congelar a interface.
- Mostrar erro específico e botões **Tentar novamente**, **Alterar CLI**, **Ver logs**.
- Falha de T-002 não altera T-001.
- Se Core cair, frontend mostra reconexão; não criar processos duplicados ao restaurar.
- Persistir eventos e metadados; distinguir sessão recuperável de processo encerrado.
- Definir timeouts, cancelamento, backpressure de streams e limpeza de processos órfãos.

## 6. Especificação visual — terminal workspace

### 6.1 Direção de design
Visual premium de ferramenta de desenvolvimento: dark-first, fundo grafite/preto com profundidade sutil, alto contraste, tipografia legível, bordas discretas, cantos moderados, ícones consistentes e animações curtas. **Inspiração de experiência**: Overclock para múltiplos panes e Tucano para colaboração entre agentes. **Não copiar identidade visual de terceiros.** Preservar logo, mascote robô e marca ORQST existentes; não inventar novo mascote.

### 6.2 Estrutura
```text
┌──────────────────────────────────────────────────────────────────────────┐
│ ORQST   Workspace: Meu Projeto ▾    ● Core conectado    + Novo agente  │
├──────────────┬───────────────────────────────────────────────────────────┤
│ SIDEBAR      │ Abas: [Equipe 1] [Backend] [+]                            │
│              ├────────────────────────────┬──────────────────────────────┤
│ Visão geral  │ ★ @orquestrador            │ @frontend · Claude           │
│ Equipes      │ Codex · executando         │ Claude · pronto              │
│ Terminais    │ [↗] [⋯] [×]               │ [↗] [⋯] [×]                │
│ Atividades   ├────────────────────────────┼──────────────────────────────┤
│ Métricas     │ $ saída real da CLI        │ $ saída real da CLI          │
│ Configurações│ ...                        │ ...                          │
│              ├────────────────────────────┴──────────────────────────────┤
│              │ @backend  [mensagem / delegação...]         [Enviar]      │
├──────────────┴───────────────────────────────────────────────────────────┤
│ Eventos: Tarefa #123 · @orquestrador → @frontend · Em execução           │
└──────────────────────────────────────────────────────────────────────────┘
```
Este desenho é **wireframe funcional**, não layout pixel-perfect. Codex deve adaptar à UI existente e aos tamanhos de tela.

### 6.3 Cabeçalho de cada pane
Mostrar: ícone oficial do CLI (quando permitido), nome editável, handle, papel (estrela/coroa discreta para orquestrador), modelo opcional, indicador de estado, diretório de trabalho e ações. Ações principais visíveis: **maximizar/restaurar** e **fechar**; demais em menu `⋯`: renomear, mover, duplicar, reiniciar, tornar orquestrador, permissões de comunicação, detalhes e logs.

### 6.4 Layout e comportamento
- Layout inicial 2 colunas; oferecer 1, 2, 3 colunas e grade adaptativa sem limite rígido de agentes.
- Permitir split horizontal e vertical, abas por grupo e scroll quando necessário.
- Terminal maximizado mantém header e botão claro de restauração.
- Pane com tarefa ativa deve ser identificável mesmo quando fora de foco.
- Estados visuais: inicializando, pronto, executando, aguardando usuário, erro, desconectado, encerrado.
- Atalhos configuráveis para criar pane, alternar foco, maximizar, buscar terminal, enviar mensagem.
- Acessibilidade: navegação por teclado, foco visível, labels, contraste, respeito a `prefers-reduced-motion`.
- Responsividade: janelas estreitas convertem grade em abas ou lista; evitar pane minúsculo ilegível.
- Terminal não deve perder scrollback ou texto digitado por rerender desnecessário.

### 6.5 Comunicação visual entre panes
Ao mencionar `@frontend`, mostrar sugestão contextual e confirmação de destino. No painel de atividades, exibir arestas de delegação e eventos de entrega. Indicador sutil no pane destinatário ao receber tarefa. Não simular respostas: toda mensagem deve refletir evento real do Core.

## 7. Contratos de domínio sugeridos (ajustar ao código existente)

```ts
type TerminalStatus =
  | 'starting' | 'ready' | 'running' | 'waiting_input'
  | 'error' | 'disconnected' | 'stopped';

interface TerminalInstance {
  id: string;
  displayName: string;
  mentionHandle: string;
  runtimeId: string;
  workspaceId: string;
  sessionId?: string;
  role: 'orchestrator' | 'worker' | 'reviewer';
  status: TerminalStatus;
}

interface AgentMessage {
  id: string;
  correlationId: string;
  fromTerminalId: string;
  toTerminalId: string;
  body: string;
  state: 'created' | 'queued' | 'sent' | 'accepted'
       | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  hopCount: number;
}
```

Não impor esses tipos se contratos equivalentes já existirem; preferir adaptação incremental. **Nomes e estados são proposta do ORQST, não afirmação de APIs existentes em Anywh/Tucano.**

### 7.1 Eventos mínimos
`terminal.created`, `terminal.started`, `terminal.output`, `terminal.resized`, `terminal.stopped`, `terminal.failed`, `terminal.reconnected`, `message.queued`, `message.accepted`, `message.completed`, `message.failed`, `team.orchestrator.changed`.

Versionar eventos e persistir IDs estáveis; evitar usar nome de pane como chave primária.

## 8. Segurança e distribuição
- Core local deve usar loopback e autenticação/token de sessão, proteção contra origens não autorizadas e validação de comandos.
- Não expor Relay/Core em `0.0.0.0` por padrão; Anywh já foi apontado como referência com Relay voltado a redes confiáveis — auditar modelo de ameaça antes de adaptar.
- Permissões Tauri mínimas; não habilitar shell irrestrito no frontend.
- Tratar segredos/credenciais com armazenamento apropriado e nunca registrar tokens em logs.
- Respeitar permissões do usuário para operações em arquivos, execução de comandos e browser use.
- Planejar sidecar Node por macOS (Intel/Apple Silicon), Windows e Linux, dependências nativas de PTY, assinatura e instaladores.
- Definir comportamento ao fechar janela: sair, minimizar para tray ou manter Core, conforme configuração explícita.

## 9. Plano de execução incremental — entregas concretas

**Etapa 0 — baseline (sem reescrita):** executar testes existentes, mapear processos ativos, salvar estado Git, listar componentes e bloqueios. Saída: inventário curto com arquivos.

**Etapa 1 — prova de reaproveitamento:** inspecionar Anywh e integrar **um componente real** (ou demonstrar com evidências por que não é reutilizável), com atribuição e teste. Priorizar adaptador/lifecycle. Não criar apenas um wrapper fictício.

**Etapa 2 — Tauri 2:** introduzir shell Tauri, conectar frontend ao Core, empacotar sidecar e validar startup/shutdown/reconnect. Só retirar Electron após paridade comprovada.

**Etapa 3 — terminais:** panes reais com criar/fechar/ocultar/maximizar/resize/reordenar/renomear, persistência e tratamento de falha.

**Etapa 4 — equipes e menções:** criar equipes pela UI, definir orquestrador, permissões entre terminais, autocomplete `@`, entrega real, rastreamento de estados e prevenção de loops.

**Etapa 5 — refinamento visual:** polir layout inspirado em Overclock/Tucano, sem comprometer comportamento, desempenho ou acessibilidade.

**Etapa 6 — validação multiplataforma e documentação:** testes reais, instaladores, atribuições de licenças, guia de execução e lista de limitações.

Ao fim de **cada etapa**, entregar: arquivos alterados, origem dos componentes reutilizados (URL + SHA + caminho), comandos de teste, resultado dos testes, evidência de UI/CLI real e riscos pendentes. Não declarar “pronto” sem teste.

## 10. Critérios de aceite obrigatórios

- [ ] Aplicação inicia em Tauri 2 e Core Node sem depender do Electron.
- [ ] Interface preserva identidade ORQST e componentes atuais válidos.
- [ ] Criar Codex e Claude via UI sem configuração manual externa obrigatória.
- [ ] Adicionar terceiro e quarto agente sem lógica fixa de A/B.
- [ ] Fechar pane sem matar sessão quando opção for ocultar; encerrar processo apenas quando solicitado.
- [ ] Maximizar/restaurar, redimensionar e mover panes sem perder saída/entrada.
- [ ] Renomear panes e mencionar por `@handle` com autocomplete e IDs estáveis.
- [ ] Designar/trocar orquestrador por UI; permissões de comunicação editáveis.
- [ ] Entrega real de `@terminal1 → @terminal2` e retorno verificável.
- [ ] Estados de mensagens representam eventos reais, sem falso “concluído”.
- [ ] Falha ao iniciar Claude não impede Codex ou novo terminal.
- [ ] Recuperação/reconexão não cria processos duplicados.
- [ ] Layout, equipes e configurações persistem em SQLite.
- [ ] Core local protegido e permissões mínimas de desktop.
- [ ] Código de terceiros efetivamente reutilizado identificado e licenças respeitadas.
- [ ] Testes automatizados e teste manual com CLIs reais documentados.

## 11. Cenários de teste mínimos
1. Criar Codex + Claude + OpenCode, trocar foco e maximizar Claude; Codex continua executando.
2. Renomear `terminal2` para `frontend`; enviar `@frontend revise o componente` e verificar aceite e resultado real.
3. Definir Codex como orquestrador, delegar a Claude, receber retorno e verificar trilha de eventos.
4. Simular Claude ausente, corrigir CLI e clicar **Tentar novamente** sem reiniciar aplicativo.
5. Encerrar Core abruptamente, reconectar frontend e restaurar sessões sem duplicação.
6. Fechar somente pane enquanto processo roda; restaurar pane e validar scrollback.
7. Reiniciar aplicativo e validar layouts, handles, permissões e sessões recuperáveis.
8. Testar loop A→B→A e confirmar TTL/hop limit e cancelamento.
9. Testar janelas pequenas, teclado e redução de movimento.
10. Testar empacotamento em macOS, Windows e Linux; registrar o que foi de fato executado.

## 12. Instrução final ao Codex

**Não comece implementando tudo do zero.** Primeiro leia o repositório ORQST atual, preserve trabalho em andamento e inspecione o código dos projetos citados. Priorize módulos reais e compatíveis de Anywh para Core/CLI e Tucano para comunicação/roteamento; use Overclock como referência visual até confirmar fonte e licença. Faça commits pequenos, testes executáveis e entregas demonstráveis. Não altere a arquitetura silenciosamente nem substitua funcionalidades existentes sem necessidade. Se uma decisão de produto for indispensável e não estiver definida aqui, apresente opções e peça confirmação antes de implementar.

**Primeira resposta esperada do Codex:** estado do Git e trabalho em andamento; arquivos do ORQST relevantes; commits/arquivos de referência encontrados; primeiro componente que será realmente reutilizado; plano de execução em etapas curtas; teste que comprovará o reaproveitamento. **Depois executar**, não parar no planejamento.


## Workspace → Feature → Terminais: requisito aprovado (04/11/2026)

**Hierarquia obrigatória:** `Workspace → Feature → TerminalPane → AgentSession`. Um Workspace representa o projeto e sua pasta raiz; cada Workspace possui Features independentes, com nome, descrição, status (`planned`, `active`, `blocked`, `completed`, `archived`), terminais, tarefas, histórico, permissões e layout. **Feature é entidade persistida, não só pasta visual.** A mesma Feature pode possuir N terminais de diferentes CLIs e modelos. O preset A/B não limita a quantidade.

### Regras de identidade e isolamento
- `workspaceId`, `featureId`, `paneId`, `sessionId`, `taskId` são IDs estáveis; não usar títulos como chaves. Cada terminal pertence a uma Feature e um Workspace; o processo é gerenciado pelo Core, não pelo componente React.
- `@backend` é resolvido primeiro no escopo da Feature atual. Para outras Features, exigir referência explícita, por exemplo `@autenticacao/backend` (ou seletor de destino com IDs estáveis). Duplicidades não podem causar envio silencioso ao destinatário errado.
- Por padrão, a comunicação automática ocorre somente dentro da Feature; comunicação entre Features e Workspaces exige autorização explícita, confirmação de destino e trilha de auditoria. O agente não adquire privilégios ao ser marcado como orquestrador.
- Trocar de Feature ou Workspace altera apenas a visão ativa: não encerra processos, tarefas nem mensagens em andamento. Minimizar/ocultar pane não mata sessão. Encerrar processo é operação separada, com confirmação apropriada.
- Layout (`docked`, `floating`, proporções, ordem, panes minimizados, foco) persiste **por Feature**, não globalmente. Cada Feature pode ter seu próprio orquestrador e política de comunicação.
- Features podem ser criadas, renomeadas, duplicadas como configuração, arquivadas e removidas, com política clara de processos ativos, dados e confirmação. Nunca excluir histórico nativo de CLIs ao apagar uma Feature.

### UI V5 — adição sem redesenho
- Sidebar compacta: lista expansível de Workspaces → Features, contadores de terminais e botão `+ Nova Feature` dentro do Workspace selecionado. Mostrar estado e Feature ativa; permitir alternar sem perder o layout.
- Cabeçalho: breadcrumb `Workspace / Feature`, ações `+ Terminal`, `Delegar`, `Organizar` e gerenciamento da Feature.
- Área central: **exatamente a experiência de terminais docked V5 aprovada**, ocupando a área útil, com resize, drag/swap, minimizar, maximizar, menu `⋯`, terminal CLI nativo e animações de mensagens reais.
- Fluxo de criação de Feature: nome, descrição opcional, pasta/worktree opcional sob Workspace, status inicial, modelos/agentes padrão opcionais. Não exigir arquivo de configuração externo.
- Criar terminais no escopo da Feature ativa. O orquestrador pode abrir novos terminais dentro dela mediante autorização; selecionar CLI e modelo individualmente.
- Indicadores e métricas devem permitir filtros por Workspace, Feature, terminal, CLI e modelo. Não somar dados indisponíveis como zero.

### Persistência e eventos
Propor migrações aditivas para `features`, `feature_terminal_assignments` (se necessário), `feature_layouts`, `feature_permissions`, e relações por `featureId` em tarefas/delegações. Ajustar à estrutura SQLite existente, sem duplicar entidades. Criar eventos versionados `feature.created`, `feature.updated`, `feature.activated`, `feature.archived`, `feature.terminal_added`, `feature.terminal_removed`; preservar APIs v1 ou versionar novos contratos. Garantir reconciliação e recuperação sem sessões duplicadas.

### Cenários de aceitação
1. Workspace ORQST possui Features Autenticação (3 terminais), Dashboard (2) e Banco de dados (1); cada uma abre o layout salvo.
2. Alternar Autenticação → Dashboard → Autenticação mantém os processos e recupera o layout, sem reexecutar agentes.
3. Criar `@backend` em duas Features não confunde destinatários; comunicação cruzada sem permissão é bloqueada.
4. Criar Feature e terminais inteiramente pela UI, sem editar JSON externo; erros não travam a seleção.
5. Fechar/arquivar Feature com tarefas ativas apresenta escolhas explícitas e não encerra outras Features.
6. Delegar tarefas dentro da Feature, acompanhar eventos reais e retorno; animações refletem eventos do Core.
7. Atualizar README, ROADMAP, contratos, modelo de dados, documentação UI/UX, testes e CHANGELOG.

**Reuse-first:** antes de implementar qualquer parte acima, verificar Anywh (`https://github.com/anywh-sh/anywh`) e Tucano (`https://github.com/eduwxyz/tucano`) para recursos equivalentes; citar arquivo/commit/licença efetivamente verificados. Overclock (`https://overclock.sh`) é referência de experiência, não fonte presumida de código reutilizável.
