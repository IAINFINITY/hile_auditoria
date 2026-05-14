# Roadmap: Hilê Auditoria

## Overview

Evoluir o dashboard de auditoria para um produto SaaS confiável, seguro e escalável, com autenticação robusta, persistência consistente e leitura operacional clara dos relatórios.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 1: Security Foundation** - Consolidar autenticação/autorização e hardening de endpoints
- [ ] **Phase 2: Data Integrity** - Eliminar duplicatas e garantir consistência de persistência
- [ ] **Phase 3: Reporting Reliability** - Garantir completude do relatório e filtros corretos em histórico
- [ ] **Phase 4: Operational UX** - Melhorar experiência de uso e observabilidade operacional

## Phase Details

### Phase 1: Security Foundation
**Goal**: Implementar autenticação/autorização segura usando Supabase Auth + regras de acesso para API.
**Depends on**: Nothing (first phase)
**Requirements**: REQ-SEC-01, REQ-SEC-02, REQ-SEC-03
**Success Criteria** (what must be TRUE):
  1. Apenas usuários autorizados no banco conseguem acessar recursos protegidos.
  2. Rotas críticas de API retornam 401/403 corretamente para sessões inválidas.
  3. Configuração de segurança base (headers e validações) está ativa em produção.
**Plans**: 3 plans

Plans:
- [ ] 01-01: Consolidar fluxo de login e sessão no frontend
- [ ] 01-02: Aplicar autorização em endpoints sensíveis
- [ ] 01-03: Revisão de hardening e validação de segurança

### Phase 2: Data Integrity
**Goal**: Remover riscos de duplicidade e garantir idempotência no salvamento de relatórios/insights.
**Depends on**: Phase 1
**Requirements**: REQ-DATA-01, REQ-DATA-02
**Success Criteria** (what must be TRUE):
  1. Execução duplicada no mesmo dia não gera registros inconsistentes.
  2. Índices/constraints impedem duplicidade estrutural no banco.
  3. Histórico por data retorna dados únicos e coerentes.
**Plans**: 3 plans

Plans:
- [ ] 02-01: Revisar modelo Prisma e constraints de unicidade
- [ ] 02-02: Ajustar fluxo de overwrite por data quando necessário
- [ ] 02-03: Validar consultas históricas com cenários de borda

### Phase 3: Reporting Reliability
**Goal**: Garantir que o relatório consolidado exiba contexto completo e filtros funcionais.
**Depends on**: Phase 2
**Requirements**: REQ-REP-01, REQ-REP-02, REQ-REP-03
**Success Criteria** (what must be TRUE):
  1. Contexto por usuário não aparece vazio quando há dados processados.
  2. Gaps/insights e etiquetas refletem fielmente os dados do Chatwoot.
  3. Filtros por data/situação/severidade retornam resultados corretos.
**Plans**: 3 plans

Plans:
- [ ] 03-01: Corrigir pipeline de montagem de contexto por usuário
- [ ] 03-02: Ajustar captura e persistência de etiquetas
- [ ] 03-03: Revisar filtros e paginação do relatório

### Phase 4: Operational UX
**Goal**: Refinar UX operacional com feedback de execução, estabilidade de navegação e observabilidade.
**Depends on**: Phase 3
**Requirements**: REQ-UX-01, REQ-UX-02
**Success Criteria** (what must be TRUE):
  1. Navegação entre seções não causa saltos indesejados de scroll.
  2. Estado de execução é claro para o usuário sem logs ruidosos.
  3. Indicadores e gráficos carregam dados persistidos de forma consistente.
**Plans**: 2 plans

Plans:
- [ ] 04-01: Refinar feedback visual e estados de carregamento
- [ ] 04-02: Ajustar consistência de gráficos e seções com dados do banco

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Security Foundation | 0/3 | Not started | - |
| 2. Data Integrity | 0/3 | Not started | - |
| 3. Reporting Reliability | 0/3 | Not started | - |
| 4. Operational UX | 0/2 | Not started | - |
