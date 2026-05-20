-- Fecha execuções presas em running (sem finalizar) há mais de 30 minutos
-- Pode ajustar o intervalo conforme necessidade operacional.
UPDATE public.analysis_runs
SET
  "status" = 'failed',
  "finishedAt" = NOW()
WHERE
  "status" = 'running'
  AND "finishedAt" IS NULL
  AND "startedAt" < (NOW() - INTERVAL '30 minutes');