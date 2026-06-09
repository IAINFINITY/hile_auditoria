# Frontend Migration Checklist

## Objetivo
- [ ] Aplicar a estrutura visual do frontend de `clinic-auditoria-atendimento-main/dashboard` no projeto atual
- [ ] Manter o backend, as APIs, a autenticacao e a logica analitica do projeto atual
- [ ] Preservar todas as secoes e fluxos ja existentes no projeto atual
- [ ] Fazer a migracao por fases pequenas, com validacao entre cada etapa

## Regra de Branding
- [ ] Manter a identidade visual da Hilê como regra fixa da migracao
- [ ] Nao importar as cores da Clinic
- [ ] Nao importar logos, textos institucionais ou linguagem visual proprietaria da Clinic
- [ ] Reaproveitar do projeto doador apenas:
  - [ ] estrutura visual
  - [ ] hierarquia de layout
  - [ ] composicao de shell
  - [ ] ritmo de cards, secoes, espacamento e navegacao
- [ ] Adaptar tudo isso para a paleta, semantica e marca da Hilê

## Regras de Arquitetura
- [ ] Manter o backend atual como unica fonte de dados
- [ ] Manter a autenticacao atual com Supabase + allowlist + superadmin/admin
- [ ] Manter `src/proxy.ts` e toda a seguranca atual
- [ ] Manter `useDashboardController` como fonte principal de estado
- [ ] Nao usar `clinic-auditoria-atendimento-main/dashboard/src/lib/api.ts` como contrato
- [ ] Nao usar `clinic-auditoria-atendimento-main/dashboard/src/lib/auth.ts`
- [ ] Nao reduzir o produto atual para apenas 2 abas
- [ ] Tratar o frontend doador como base visual, nao como estrutura funcional final

## Diagnostico Consolidado

### Projeto atual
- [x] Considerar como base operacional:
  - [x] `src/app/page.tsx`
  - [x] `src/features/dashboard/app/DashboardApp.tsx`
  - [x] `src/features/dashboard/hooks/useDashboardController.ts`
  - [x] `src/features/dashboard/sections/*`
- [x] Preservar:
  - [x] login real
  - [x] logout
  - [x] idle session
  - [x] execucao manual
  - [x] auto-sync
  - [x] logs
  - [x] superadmin
  - [x] settings
  - [x] filtros por owner

### Projeto doador
- [x] Considerar como fonte visual:
  - [x] `clinic-auditoria-atendimento-main/dashboard/src/components/AppShell.tsx`
  - [x] `clinic-auditoria-atendimento-main/dashboard/src/components/Sidebar.tsx`
  - [x] `clinic-auditoria-atendimento-main/dashboard/src/components/ui.tsx`
  - [x] `clinic-auditoria-atendimento-main/dashboard/src/components/charts.tsx`
  - [x] `clinic-auditoria-atendimento-main/dashboard/src/components/audit.tsx`
  - [x] `clinic-auditoria-atendimento-main/dashboard/src/app/globals.css`
- [x] Tratar como referencia parcial:
  - [x] `BrandContext`
  - [x] graficos
  - [x] layout de dashboard
  - [x] layout de auditoria

## Mapa de Reaproveitamento

### Reaproveitar com forca
- [ ] shell visual
- [ ] sidebar
- [ ] topbar
- [ ] estrutura de cards
- [ ] blocos de KPI
- [ ] grids e secoes
- [ ] padrao de estados vazios e de loading
- [ ] organizacao visual das areas principais

### Reaproveitar com adaptacao
- [ ] `BrandContext` como inspiracao para escopo global
- [ ] charts como base visual, adaptando aos dados atuais
- [ ] componentes de auditoria como inspiracao para a `analysis`
- [ ] composicao de filtros e tabelas

### Nao reaproveitar diretamente
- [ ] auth do projeto doador
- [ ] api client do projeto doador
- [ ] contratos de resposta do projeto doador
- [ ] limitacao a duas abas
- [ ] cores da Clinic
- [ ] qualquer texto fixo de marca da Clinic

## Estrategia de Migracao
- [ ] Fazer migracao por camadas
- [ ] Implementar o shell primeiro
- [ ] Aplicar depois os componentes base
- [ ] Migrar `dashboard` antes das secoes secundarias
- [ ] Migrar `analysis` antes de `clients/products/logs/...`
- [ ] Validar comportamento apos cada fase

## Checklist de Implementacao

### Fase 1 - Inventario visual do projeto doador
- [x] Mapear componentes visuais reutilizaveis
- [x] Mapear padroes de layout reutilizaveis
- [x] Mapear tokens visuais que precisam ser reinterpretados para a Hilê
- [x] Identificar quais partes estao acopladas ao backend da Clinic
- [x] Definir o que entra como referencia e o que entra como codigo reaproveitavel

Arquivos principais para inspecao:
- [x] `clinic-auditoria-atendimento-main/dashboard/src/components/AppShell.tsx`
- [x] `clinic-auditoria-atendimento-main/dashboard/src/components/Sidebar.tsx`
- [x] `clinic-auditoria-atendimento-main/dashboard/src/components/ui.tsx`
- [x] `clinic-auditoria-atendimento-main/dashboard/src/components/charts.tsx`
- [x] `clinic-auditoria-atendimento-main/dashboard/src/components/audit.tsx`
- [x] `clinic-auditoria-atendimento-main/dashboard/src/app/globals.css`

### Resultado da Fase 1 - Inventario consolidado

#### Shell e navegacao
- [x] `AppShell.tsx`
  - decisao: reaproveitamento estrutural forte
  - usar como referencia para sidebar fixa, drawer mobile, topbar sticky e tabs
  - nao copiar a navegacao de duas abas como limite funcional
- [x] `Sidebar.tsx`
  - decisao: reaproveitamento estrutural forte
  - usar como base para hierarquia visual, avatar inicial, agrupamento e rodape
  - substituir `BrandContext` e lista de marcas pela navegacao real do projeto atual
- [x] `BrandContext.tsx`
  - decisao: referencia parcial
  - ideia util para escopo global persistido
  - nao serve como estrutura final porque o projeto atual depende de `activeView`, `ownerScope`, `analysisScope`, `dissatisfactionScope` e estado autenticado

#### Componentes base
- [x] `ui.tsx`
  - decisao: reaproveitamento forte com adaptacao de branding
  - `Card` e `Kpi` sao bons candidatos para virar base da nova linguagem visual
  - `Insight` pode ser reaproveitado como padrao de bloco explicativo
  - remover qualquer dependencia de `clinic-red`

#### Graficos
- [x] `charts.tsx`
  - decisao: referencia forte com adaptacao
  - boa composicao visual e leitura limpa
  - forte acoplamento a:
    - tipos de `lib/api.ts` do projeto doador
    - palette hardcoded da Clinic
    - suposicoes de dataset simples
  - estrategia: reaproveitar composicao e estilo, mas adaptar aos tipos e graficos atuais do projeto Hilê

#### Auditoria
- [x] `audit.tsx`
  - decisao: referencia forte para `analysis`
  - `ConversationRow`, `GapItem` e `GapsByType` sao otimos como inspiracao de UX
  - precisa adaptar:
    - taxonomia de gap
    - severidade
    - dados do card
    - links e acoes
  - `AuditorPersona` deve ser tratado com cuidado
    - o conceito de bloco-resumo e bom
    - mas o texto e a persona Clinic nao devem ser copiados

#### Estilos globais
- [x] `globals.css`
  - decisao: referencia parcial
  - a organizacao de tokens e simples e boa
  - os tokens de cor da Clinic nao devem ser importados
  - usar apenas a ideia de centralizar tokens e expor variaveis semanticas da Hilê

#### Layout raiz
- [x] `layout.tsx`
  - decisao: referencia parcial
  - boa composicao de `Provider + AppShell`
  - nao copiar metadata, naming ou organizacao de providers sem adaptar ao app atual

### Saida tecnica da Fase 1
- [x] O projeto doador servira como base visual e estrutural
- [x] O projeto atual continuara como fonte de autenticacao, dados e regras
- [x] O shell doador sera expandido para comportar todas as secoes atuais
- [x] Os componentes visuais doadores serao reinterpretados com branding Hilê
- [x] A migracao seguira para Fase 2 sem reaproveitar auth ou API client do doador

### Fase 2 - Base visual Hilê no projeto atual
- [x] Criar ou ajustar tokens visuais da Hilê
- [x] Garantir que a paleta atual permaneça como fonte oficial
- [ ] Criar componentes base para:
  - [x] cards
  - [x] KPIs
  - [x] wrappers de secao
  - [x] pills/tabs
  - [x] headers de bloco
  - [x] estados vazios
  - [ ] loading states
- [x] Reaproveitar o layout do doador sem copiar as cores da Clinic

Arquivos-alvo provaveis:
- [x] `src/app/globals.css`
- [x] `src/app/styles/*`
- [x] novo diretorio de componentes base/layout

### Resultado parcial da Fase 2
- [x] Nova camada de fundacao visual criada em `src/app/styles/hile-foundation.css`
- [x] Tokens semanticos Hilê adicionados em `src/app/styles/base.css`
- [x] Fundacao registrada em `src/app/globals.css`
- [x] Componentes base criados em `src/features/dashboard/shared/ui/HilePrimitives.tsx`
- [ ] Aplicar esses componentes nas telas reais
- [ ] Criar loading states visuais padronizados com a nova base

### Fase 3 - Novo shell de navegacao
- [x] Adaptar o shell do projeto doador para a arquitetura atual
- [x] Substituir gradualmente o shell atual sem mexer nas regras de negocio
- [x] Manter compatibilidade com:
  - [x] `activeView`
  - [x] `activeSubNavKey`
  - [x] notificacoes
  - [x] currentUser
  - [x] superadmin
  - [x] settings
- [x] Garantir que a navegacao nova comporte todas as secoes atuais

Arquivos-alvo provaveis:
- [x] `src/features/dashboard/sections/layout/ShellNavigation.tsx`
- [x] `src/features/dashboard/sections/layout/shell/*`
- [ ] `src/features/dashboard/app/DashboardApp.tsx`

### Resultado parcial da Fase 3
- [x] Sidebar reorganizada em grupos visuais
- [x] Topbar modernizada com breadcrumb, contexto e notificacoes em shell novo
- [x] Shell mantido sobre a logica atual de navegacao
- [x] Superadmin e configuracoes preservados dentro do shell novo
- [x] Compatibilidade validada com `typecheck` e `lint`
- [ ] Ajustar `DashboardApp.tsx` se precisarmos incorporar estados adicionais do shell
- [ ] Refinar responsividade do shell em telas menores

### Fase 4 - Migrar a tela Dashboard
- [x] Aplicar a composicao visual do doador no dashboard principal
- [x] Reorganizar KPIs com a linguagem visual nova
- [ ] Reorganizar os graficos com hierarquia mais limpa
- [x] Ajustar estados de erro, loading e sem dados
- [x] Preservar:
  - [x] execucao manual
  - [x] leitura do ultimo relatorio
  - [x] auto-refresh
  - [x] status de execucao

Arquivos-alvo provaveis:
- [x] `src/features/dashboard/sections/dashboard/*`
- [ ] `src/features/dashboard/charts/*`

### Resultado parcial da Fase 4
- [x] `MetricsSection` migrada para a nova fundacao visual Hilê
- [x] `GapsSection` migrada para a nova fundacao visual Hilê
- [x] `InsightsSection` migrada para a nova fundacao visual Hilê
- [x] `MovementSection` migrada para a nova fundacao visual Hilê
- [x] Execucao manual preservada no dashboard novo
- [x] Status de execucao e leitura de ultimo relatorio mantidos
- [ ] Reorganizar a camada de graficos de forma mais profunda, se necessario
- [x] MovementSection alinhada visualmente dentro da fase atual
- [x] Cabecalhos centrais do dashboard e da analise agora compartilham a mesma linguagem de shell

### Fase 5 - Migrar a tela Analysis
- [x] Adaptar a ideia da aba `auditoria` do projeto doador para a `analysis` atual
- [x] Criar cards e listas mais claros para severidade e contexto
- [ ] Manter `motivo operacional` visivel quando a severidade exigir justificativa
- [x] Reorganizar filtros sem perder capacidades atuais
- [x] Preservar leitura por owner e por escopo

Arquivos-alvo provaveis:
- [ ] `src/features/dashboard/sections/analysis/*`

### Resultado parcial da Fase 5
- [x] Cabecalho da tela `analysis` migrado para o shell novo
- [x] Blocos de escopo e interpretacao migrados para a fundacao visual Hilê
- [x] Filtros por owner e escopo mantidos
- [x] Estrutura de resumo diario e consolidado parcialmente alinhada com os novos cards Hile
- [x] Blocos de produtos e contexto da analise agora usam a mesma fundacao visual
- [ ] Migrar o corpo das views de `analysis`
- [x] Ajustar visual da parte consolidada (`overall`) para o novo padrao
- [x] Ajustar visual da parte diaria para o novo padrao

### Fase 6 - Encaixar as demais secoes
- [x] Adaptar `clients`
- [x] Adaptar `products`
- [x] Adaptar `logs`
- [x] Adaptar `attendants`
- [x] Adaptar `dissatisfaction`
- [x] Adaptar `settings`
- [x] Adaptar `superadmin`
- [x] Garantir unidade visual entre dashboard, analysis, products e clients
- [x] Garantir que nenhuma tela principal fique com cara de sistema antigo no meio do novo

### Fase 7 - Polimento final
- [x] Ajustar responsividade desktop
- [x] Ajustar responsividade notebook
- [x] Ajustar responsividade mobile
- [x] Ajustar transicoes e navegacao
- [x] Revisar tipografia
- [x] Revisar contraste
- [x] Revisar semantica de severidade
- [x] Revisar empty states
- [x] Revisar loading states

## Navegacao Futura - Regra Geral
- [x] Nao limitar a interface a `Metricas` e `Auditoria IA`
- [x] Expandir o shell doador para acomodar todas as secoes atuais
- [ ] Manter a profundidade de navegacao necessaria para:
  - [x] dashboard
  - [x] analysis
  - [x] attendants
  - [x] dissatisfaction
  - [x] clients
  - [x] products
  - [x] logs
  - [x] settings
  - [x] superadmin

## Riscos e Mitigacoes

### Risco 1 - Trazer identidade visual errada
- [ ] Mitigacao: revisar qualquer componente importado para remover cores e textos da Clinic

### Risco 2 - Quebrar autenticacao
- [ ] Mitigacao: manter auth atual intacta e migrar so o visual

### Risco 3 - Quebrar contratos de API
- [ ] Mitigacao: ligar os novos componentes ao controller e aos endpoints atuais

### Risco 4 - Reduzir o escopo do produto
- [ ] Mitigacao: tratar o doador como base visual, nunca como limite funcional

### Risco 5 - Fazer migracao grande demais de uma vez
- [ ] Mitigacao: entregar por fases pequenas com validacao

## Checklist de Testes

### Testes tecnicos
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`

### Testes de autenticacao
- [ ] login com admin
- [ ] login com superadmin
- [ ] logout manual
- [ ] expiracao por inatividade

### Testes de produto
- [ ] abrir dashboard sem execucao manual
- [ ] validar ultimo relatorio disponivel
- [ ] rodar execucao manual
- [ ] refletir auto-sync na interface
- [ ] validar logs operacionais
- [ ] validar falhas de execucao
- [ ] validar filtros por owner

### Testes de areas
- [ ] dashboard
- [ ] analysis
- [ ] attendants
- [ ] dissatisfaction
- [ ] clients
- [ ] products
- [ ] logs
- [ ] settings
- [ ] superadmin

### Testes visuais
- [ ] desktop grande
- [ ] notebook
- [ ] mobile
- [ ] loading
- [ ] vazio
- [ ] erro
- [ ] cards criticos
- [ ] listas longas

## Primeira Entrega Recomendada
- [ ] Portar o shell visual do projeto doador para o projeto atual
- [ ] Preservar auth, backend e controller
- [ ] Manter branding da Hilê
- [ ] Nao migrar ainda a totalidade das telas
- [ ] Validar navegacao completa antes de passar para Dashboard e Analysis







