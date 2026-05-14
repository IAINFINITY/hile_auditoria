# Hilê Auditoria

## What This Is

Hilê Auditoria é um dashboard operacional que consolida auditorias de atendimento do Chatwoot com análise de IA (Dify) e histórico persistente em Supabase. O produto ajuda operação e gestão a identificar gaps críticos, acompanhar contexto por conversa e consultar histórico por data sem reprocessamento desnecessário. O foco atual é confiabilidade de dados, segurança e experiência de consulta.

## Core Value

Transformar conversas em decisões operacionais confiáveis, com rastreabilidade e segurança.

## Requirements

### Validated

- ✅ Pipeline de overview diário com métricas, gaps e relatório consolidado
- ✅ Persistência de execução e relatórios no banco para consulta posterior
- ✅ Interface dashboard com filtros de período e navegação por seções

### Active

- [ ] Fortalecer autenticação/autorização via Supabase Auth (somente usuários do banco)
- [ ] Melhorar consistência de dados para evitar duplicatas e gaps de sincronização
- [ ] Padronizar qualidade de análise/relatório para consultas históricas
- [ ] Melhorar observabilidade e logs de falhas para suporte operacional

### Out of Scope

- Cadastro público/self-service de usuários — acesso deve ser controlado via banco
- Alterações de design system complexas fora do padrão visual já aprovado

## Context

- Stack principal: Next.js + React + TypeScript + Tailwind + Prisma + Supabase
- Fonte operacional: Chatwoot (conversas, etiquetas, contexto de atendimento)
- Fonte de análise: Dify (classificação, severidade, recomendações)
- Requisitos críticos: segurança, integridade de dados, rastreabilidade por conversa e data

## Constraints

- **Security**: Autenticação deve depender de Supabase Auth e autorização por tabela de admins
- **Scalability**: Persistência deve evitar duplicatas e reprocessamentos custosos
- **Compatibility**: Frontend deve permanecer compatível com layout operacional aprovado
- **Reliability**: Execuções devem ser reproduzíveis para auditoria histórica

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Migrar frontend para Next.js + TS + Tailwind | Melhor base para SaaS, organização e manutenção | ✓ Good |
| Persistir relatórios e execuções no Supabase com Prisma | Histórico consultável e menor custo de reanálise | ✓ Good |
| Restringir criação de usuários ao banco | Requisito de segurança e governança | ✓ Good |
| Separar auditoria em etapas (coleta, análise, relatório) | Facilita troubleshooting e escalabilidade | — Pending |

---
*Last updated: 2026-05-14 after GSD health recovery*
