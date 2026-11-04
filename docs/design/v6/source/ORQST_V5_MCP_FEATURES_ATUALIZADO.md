# ORQST — Contrato obrigatório da UI V5, menções, MCP e delegação entre terminais

**Versão:** 1.0 · **Data:** 2026-11-04 · **Destinatário:** Codex · **Tipo:** especificação de implementação complementar à especificação mestra.

> **INSTRUÇÃO PRINCIPAL:** A UI aprovada é `ORQST_workspace_v5_docked.html`. Implemente o comportamento real mantendo sua organização visual. Não redesenhe livremente. Não entregue somente documentação ou uma simulação de terminal. Preserve código e trabalhos em andamento; inspecione o estado do repositório antes de editar.

## 1. Arquivos que devem ser lidos, nesta ordem

1. `ORQST_MASTER_SPEC_TAURI_REUSE_UI.md` — arquitetura, Tauri 2, Core Node, reutilização e requisitos gerais.
2. `ORQST_workspace_v5_docked.html` — **fonte visual aprovada** para layout e controles, mas o HTML é um protótipo; **não** é a implementação do runtime.
3. Este arquivo — comportamento preciso de menções, comunicação e MCP.
4. Documentos existentes no ORQST: ADRs, ROADMAP, contratos de ciclo de vida, segurança, Pane Communication e Agentic Mode. Não substituir decisões já implementadas sem registrar divergências.

**Precedência:** segurança e contratos reais existentes > requisitos funcionais deste documento > wireframe HTML. Em caso de conflito, relatar e resolver com alteração mínima, sem inventar funcionalidades.

## 2. Resultado final observável

Um usuário abre o ORQST no Tauri 2, cria terminais Codex/Claude Code/OpenCode com CLIs instalados e autenticados, nomeia `@orquestrador`, `@backend`, `@frontend`, `@database`, escolhe um orquestrador e determina quem pode enviar mensagens para quem. No terminal oficial do orquestrador, pede: **“Peça ao @backend criar a API e ao @database preparar as migrations. Depois me traga os resultados.”** O agente usa uma ferramenta ORQST autorizada, o Core cria duas delegações rastreáveis, entrega aos destinatários reais, acompanha o andamento e retorna resultados. Na V5, uma animação curta e discreta indica o envio, os panes exibem estados reais e o usuário pode inspecionar cada tarefa.

**Proibido declarar sucesso apenas porque uma mensagem apareceu na tela ou foi escrita no PTY.**

## 3. Layout V5 — requisitos que NÃO podem ser reinterpretados

- **Modo padrão Docked:** panes encaixados, sem espaçamento de cartões; quatro terminais usam a maior parte da área de trabalho, com cabeçalhos compactos (referência visual: V5).
- Sidebar compacta de workspaces/missões; barra superior compacta; dock inferior para terminais minimizados.
- Divisórias arrastáveis entre colunas e linhas; grade 2×2 e layouts alternativos, com dimensões persistidas.
- Cada pane tem: indicador de estado, CLI, ID estável, nome, badge de orquestrador quando aplicável, **minimizar**, **maximizar/restaurar**, **⋯**, **fechar**.
- Menu `⋯`: configurações, renomear, definir/remover orquestrador, selecionar destinos autorizados, abrir painel de mensagens/delegações, tornar flutuante/encaixar, duplicar configuração, minimizar, encerrar sessão (ação distinta de fechar pane).
- Arrastar pelo cabeçalho troca panes entre slots; modo flutuante opcional permite arrastar livremente e redimensionar pelo canto. Docked é o padrão.
- O pane maximizado ocupa a área útil sem perder a sessão; ao restaurar recupera geometria anterior.
- Fechar/ocultar painel **não** significa matar processo; mostrar escolha clara quando houver sessão ativa.
- Ao minimizar, botão de restauração aparece no dock inferior. Ao restaurar, o processo e scrollback não devem ser reiniciados.
- Os terminais exibem a **UI original de cada CLI** por xterm.js + PTY ou um renderer estruturado quando o adapter exige App Server/SDK; não transformar todas as interfaces em chat genérico.
- **Não criar um campo global de chat obrigatório** nem adicionar um segundo input sobreposto a cada terminal. O CLI continua recebendo teclado normalmente. A interface de delegação é opcional.
- Cores: fundo escuro, bordas discretas e acentos roxos do ORQST; usar o mascote/branding já aprovado. Não copiar marca ou elementos protegidos do Overclock.
- Animação: linhas finas com pequenos pulsos em trânsito, acionadas por eventos reais de envio; não lasers fortes, efeitos permanentes ou distrações sobre o texto. `prefers-reduced-motion` desativa animação sem perder informação.

### 3.1 Diferença entre demonstração e produção

O V5 usa terminais e mensagens simulados. Em produção, substituir conteúdo fake por PTY/driver real, `terminal.output`, estado do processo e eventos persistidos. O HTML não autoriza copiar strings de simulação para o produto como se fossem dados reais.

## 4. Onde ficam as menções — DUAS vias complementares

### Via A — dentro do CLI oficial (fluxo principal)

O usuário escreve linguagem natural no próprio Codex/Claude/OpenCode: “mande @backend revisar”, “peça ao @database preparar o schema”. A interpretação pode ser feita pelo agente com acesso às ferramentas MCP ORQST. O CLI continua controlando seu input, histórico, atalhos e UX.

**Não interceptar e reescrever todas as teclas ou prompts do PTY** para detectar `@`. Essa estratégia quebra CLIs interativos, shells, multiline, paste e confirmações. Também não assumir que qualquer texto com `@` é uma delegação autorizada.

O ORQST deve disponibilizar instruções curtas e documentação de ferramentas ao agente, incluindo mapeamento de nomes, regras de autorização e exemplos de uso. A ferramenta recebe um destino estruturado e o Core valida a identidade real do pane.

Se um CLI/versão não suportar a ponte MCP necessária, mostrar capacidade `indisponível` e permitir delegação via painel ORQST; não fingir que o CLI recebeu a ferramenta.

### Via B — painel opcional de delegação (fluxo visual)

- Botão **Delegar** no topo e item **Delegar para…** no menu `⋯`.
- Painel lateral ou popover compacto com `Origem`, `Destinatários`, `Tarefa`, `Permissões`, `Enviar`.
- Autocomplete ao digitar `@`: nome, handle, CLI, ID, status, modelo e workspace.
- Múltiplos destinos explícitos: `@backend @database` cria **uma delegação por destino**, correlacionadas à tarefa-pai.
- Mostrar visualização do fluxo e status; sem ocultar terminais ou roubar foco de digitação sem solicitação.
- Painel de atividade separado permite filtrar por terminal, tarefa, erro e aprovação.

### 4.1 Semântica das menções

- `paneId`: identificador imutável, por exemplo UUID; `T-001` pode ser ID de exibição estável por workspace.
- `mentionHandle`: alias único por workspace/equipe, normalizado; `@backend` aponta para um `paneId` resolvido, nunca apenas string.
- Nome visual editável pode ter espaços e não é chave de roteamento.
- Renomear não quebra mensagens em fila; IDs persistidos continuam iguais.
- Alias duplicado deve ser rejeitado ou exigir desambiguação explícita; jamais escolher destinatário arbitrário.
- `@todos` ou broadcast **não** é implícito; precisa de permissão e confirmação.
- O agente não pode criar permissões por citar outro agente em texto.

## 5. Modelo de permissões e papéis

- Orquestrador é **papel selecionável** em qualquer terminal, não um provedor ou modelo especial.
- Pode haver um orquestrador por equipe ativa (definir política explícita); troca de papel preserva tarefas em curso e exige tratamento de handoff.
- Usuário configura destinos permitidos por pane (matriz `origem → destino`); permitir A→B, A↔B, A→B/C, somente orquestrador delega, etc.
- Escopo de workspace e permissão de execução continuam obrigatórios; conteúdo de uma mensagem não concede acesso a arquivos, terminal ou rede.
- Operações sensíveis (comandos, alterações de arquivos, encerramento de processos, execução remota) respeitam aprovações do CLI e do Core.
- `close_terminal` exige distinção entre `hidePane`, `detachSession`, `stopTurn` e `terminateProcess`; nunca misturar.
- MCP não deve expor ferramentas administrativas a agentes não autorizados; autorização no servidor, não apenas no frontend.

## 6. Contratos MCP — proposta de nomes, validar contratos existentes antes de criar

| Ferramenta | Entrada mínima | Saída | Política |
|---|---|---|---|
| `orqst.list_terminals` | workspace/team | IDs, aliases, status e capacidades autorizadas | Leitura restrita ao escopo |
| `orqst.send_message` | `destinationPaneId` ou alias, mensagem, correlationId | ID e estado de entrega | Validação de origem e destino |
| `orqst.delegate_task` | destino(s), descrição, prazo, limites, contexto referenciado | taskId(s) e estado inicial | Orquestração autorizada |
| `orqst.get_task_status` | taskId | estado observado e timestamps | Somente escopo permitido |
| `orqst.get_task_result` | taskId | resultado/referência/erro | Respeitar acesso e retenção |
| `orqst.create_terminal` | perfil CLI, workspace, modelo, permissão | paneId e estado | Ação privilegiada; aprovação conforme política |
| `orqst.close_terminal` | paneId, operação explícita | confirmação de transição | Não matar processo por engano |

**Os nomes acima são PROPOSTOS.** Se o ORQST já possui MCP tools equivalentes, adaptar em vez de duplicar. MCP é um canal de ferramentas, não um substituto de fila, autorização, estado ou driver.

### 6.1 Contrato mínimo de uma delegação

```ts
interface DelegationRequest {
  schemaVersion: 1;
  sourcePaneId: string; // derivado da identidade autenticada, não confiado ao texto do agente
  destinationPaneId: string;
  workspaceId: string;
  taskId: string;
  parentTaskId?: string;
  correlationId: string;
  idempotencyKey: string;
  instruction: string;
  contextRefs?: string[];
  maxDepth: number;
  deadlineAt?: string;
  permissionScopeRef: string;
}
```

No servidor: validar versão, origem, destino, estado do pane, permissões, limites, budget e idempotência; persistir antes de entregar. Não aceitar `sourcePaneId` arbitrário vindo de payload não autenticado.

## 7. Pipeline de entrega e estados verificáveis

```text
Usuário/CLI -> MCP ORQST -> autenticação + autorização
 -> resolve alias/ID -> persiste tarefa (queued)
 -> seleciona adapter do destino -> entrega
 -> evento de aceite quando suportado -> running
 -> evento de conclusão/erro -> persiste resultado
 -> notifica UI e agente solicitante
```

- Estados: `created`, `queued`, `dispatching`, `sent`, `accepted` (somente quando comprovado), `running`, `completed`, `failed`, `cancelled`, `expired`, `uncertain`.
- `sent` significa tentativa de envio ao transporte, não execução confirmada.
- CLI ocupado: enfileirar com limites, política de TTL e cancelamento. Pane fechado: rejeitar ou reter conforme política, sem envio silencioso perdido.
- Falha entre execução e persistência: marcar `uncertain` e verificar efeitos antes de reexecutar. Não prometer exatamente-uma-vez.
- Resposta deve correlacionar `taskId`/`correlationId` e retornar ao solicitante sem duplicar contexto inteiro.
- Guardas: idempotência, limite de profundidade, budget, detecção de ciclos, retries com backoff, timeout e auditoria.
- O Core deve manter processos e filas independentes do renderer Tauri.

## 8. Integração com CLIs oficiais (Native CLI First)

### Codex

Verificar App Server oficial e integração atual do ORQST; preferir operações estruturadas de thread/turn quando apropriado. Para modo terminal interativo, preservar o CLI/PTY. Não presumir que um daemon JSON-RPC e um terminal PTY sejam intercambiáveis. Garantir identidade de sessão, aprovações e continuidade.

### Claude Code

Verificar CLI oficial, modo stream-json/SDK e suporte MCP na versão instalada. Preservar sessão nativa; não reenviar transcrição inteira se o CLI já possui resume. Distinguir modo interativo PTY de execução gerenciada.

### OpenCode

Verificar API/SDK/servidor e CLI oficial na versão instalada. Suportar quando disponível; não simular entrega. Capabilities por versão devem indicar `native`, `bridged` ou `unavailable`.

**Seleção de modelo:** catálogo real do CLI/adapter, respeitando autenticação e versões; não inventar modelos disponíveis. O usuário pode escolher modelo por pane quando suportado.

## 9. UI — feedback e animação dirigidos por eventos

| Evento real | Visual V5 | Observação |
|---|---|---|
| `delegation.queued` | pequeno contador no cabeçalho | sem linha de transferência ainda |
| `delegation.dispatching` | linha sutil origem→destino com partículas pequenas | duração limitada, sem obstruir texto |
| `delegation.accepted` | breve pulso na borda do pane destinatário | somente se o adapter confirmar |
| `delegation.running` | indicador de atividade no cabeçalho | não repetir animação constantemente |
| `delegation.completed` | retorno visual curto destino→origem + atividade | exibir link para resultado |
| `delegation.failed` | badge de erro e notificação acionável | não usar animação de sucesso |
| `approval.required` | indicador de atenção e ação explícita | não aprovar automaticamente |

Se o usuário minimizar, maximizar ou mover panes durante uma animação, recalcular posições ou encerrar a animação com segurança; nunca deixar linhas presas em coordenadas antigas. Eventos simultâneos devem ser agregados/limitados para não causar sobrecarga. Acessibilidade: texto de status, não depender apenas de cor/efeito, respeitar `prefers-reduced-motion`.

## 10. Reuse-first: consulta obrigatória e permanente

**Sempre que houver dúvida ou bloqueio em runtime, sessões, Tauri, CLIs, filas ou UI, investigar o código já existente ANTES de implementar alternativa nova.**

- **Anywh**: https://github.com/anywh-sh/anywh — prioridade para Tauri, Relay, drivers Codex/Claude, detecção, sessões e Agent Host. Começar por `relay/src/runtimes/README.md`, `docs/architecture.md` e `docs/agent-host.md`, validando os arquivos reais no commit escolhido.
- **Tucano**: https://github.com/eduwxyz/tucano — prioridade para comunicação multiagente, canais, roteamento, UI e integração de CLIs. Verificar se a implementação mencionada está efetivamente publicada; não assumir que o JEV está no repositório sem prova.
- **Overclock**: https://overclock.sh — **referência de experiência visual**; copiar código somente se houver repositório/licença verificável. A captura fornecida pelo usuário é referência para densidade, layout e comportamento, não para marca.
- **ORQST atual**: preservar contratos e testes existentes. Se houver implementação parcial funcional, reutilizá-la.

Para cada código incorporado: documentar **repo, URL de arquivo, SHA de commit, licença, arquivo destino, adaptação e teste**. Respeitar Apache-2.0 e NOTICE quando aplicáveis; conferir licenças efetivas e dependências. Não importar tudo sem revisão de segurança.

Registrar a regra de consulta no `AGENTS.md` do ORQST e no guia de contribuição, para que futuros agentes também a sigam. **Consulta é obrigatória; copiar código não é**, quando houver incompatibilidade comprovada.

## 11. Plano de implementação — não travar em planejamento

**Marco 0 — Auditoria curta:** `git status`, trabalho em andamento, testes atuais, inventário de PTY/IPC/MCP/menções, comparação V5. Não sobrescrever alterações do pane em execução.

**Marco 1 — Runtime real:** pelo menos dois CLIs oficiais detectados e executados/gerenciados com segurança, mantendo Tauri 2 + Core Node e isolamento de falhas. Preferir reaproveitar driver/host compatível do Anywh.

**Marco 2 — UI V5 fiel:** grade docked, divisórias, drag entre slots, modo flutuante, maximizar, minimizar, restaurar, menu ⋯, renomear, configuração e persistência de layout. Testes visuais contra o HTML V5 e screenshot de referência.

**Marco 3 — Menções e MCP:** alias único, resolução de destinatário, ferramentas disponíveis ao CLI quando suportadas, matriz de permissões, painel visual opcional, fila e estados persistidos.

**Marco 4 — Delegação real A→B e A→B/C:** tarefas com evidência de entrega/execução/resultado; retorno ao orquestrador e animações reais. Reusar comunicação do Tucano somente após auditoria e compatibilidade.

**Marco 5 — Recuperação e distribuição:** falhas sem travar Desktop, reconnect, sessão ocupada, processos órfãos, reboot, testes macOS/Windows/Linux conforme ambientes disponíveis; documentar o que não foi testado.

Cada marco exige código funcional, testes, arquivos alterados, demonstração e lacunas restantes. Não declarar um marco concluído por ter criado apenas componentes visuais ou documentos.

## 12. Testes de aceitação — mínimos e obrigatórios

1. Criar 4 panes reais, dois Codex e dois Claude (quando CLIs instalados), cada um com nome, ID e modelo suportado; abrir também OpenCode quando disponível.
2. Renomear `T-002` para `Backend` e mencionar `@backend` sem perder o vínculo após reiniciar o Desktop.
3. Definir T-001 como orquestrador; selecionar T-002 e T-003 como destinos autorizados.
4. No CLI do T-001, solicitar delegação com `@backend` e `@database`; confirmar chamadas MCP reais e IDs de tarefas no Core.
5. Verificar fila, entrega, aceite quando observável, conclusão e retorno ao solicitante; demonstrar com logs/eventos reais, não texto fictício.
6. Negar tentativa de delegar para terminal não autorizado; testar alias inexistente e alias duplicado.
7. Terminal destinatário ocupado, CLI ausente, autenticação inválida, timeout, erro de processo e reinício do Core; nenhum deve bloquear a UI ou os outros panes.
8. Mover, trocar slots, redimensionar, maximizar, minimizar e restaurar panes durante execução sem reiniciar sessões.
9. Confirmar que animações só ocorrem em eventos apropriados e não ficam presas após resize, troca de layout ou encerramento.
10. Validar saída ANSI, atalhos, foco, seleção, copiar/colar e teclado dos CLIs oficiais.
11. Validar testes automatizados, build, empacotamento e documentação; distinguir teste simulado de teste real.
12. Garantir que `@` digitado no CLI para outro fim não seja interceptado indevidamente.

## 13. Critérios de rejeição — exemplos de implementação ERRADA

- Quatro cards com logs falsos em vez de terminais reais.
- Campo global obrigatório substituindo entrada nativa do Codex/Claude.
- Mensagem escrita no PTY marcada automaticamente como “concluída”.
- `@backend` resolvido só por busca textual sem identidade/escopo/permissão.
- MCP exposto a todos os agentes com permissão irrestrita de abrir/fechar processos.
- “Fechar pane” matar o processo sem confirmação.
- Layout flutuante como único modo, em vez do docked V5 aprovado.
- Animações neon excessivas, contínuas ou cobrindo texto do terminal.
- Criar uma segunda camada de sessão/driver apesar de existir equivalente funcional no ORQST.
- Declarar reutilização de Anywh/Tucano sem apontar código efetivamente incorporado.
- Redesenhar o frontend sem comparar com o HTML V5 e sem aprovação.

## 14. Entrega e relatório final do Codex

Produzir ao final de cada marco:

- Arquivos/commits alterados, justificativa e testes executados.
- Screenshots da V5 implementada em **grade, maximizado, minimizado, menu ⋯ e painel de delegação**.
- Vídeo ou log demonstrando **um agente real delegando a outro**, com evento e resultado rastreáveis.
- Tabela de capacidades reais por CLI/versão e diferenças entre PTY e API estruturada.
- `docs/REUSE_AUDIT.md` com URLs, commits, licenças e trechos aproveitados.
- Documentação de como configurar, iniciar, retomar e solucionar falhas, além do README/ROADMAP atualizados.

**Ordem para o Codex:** leia os arquivos de referência, audite o estado atual, identifique o menor conjunto de alterações seguras e **implemente os marcos em sequência**, sem parar indefinidamente em planejamento. Se a escolha exigir mudança destrutiva, segurança relaxada ou quebra de compatibilidade, solicite aprovação específica.


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
