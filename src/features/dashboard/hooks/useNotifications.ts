"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import type { NotificationSummaryResponse } from "../../../types";

export interface NotificationEvent {
  id: string;
  kind: "report" | "log" | "client";
  title: string;
  at: string;
  targetView: "logs" | "clients";
}

export interface NotificationState {
  events: NotificationEvent[];
  total: number;
}

interface UseNotificationsOptions {
  enabled: boolean;
  notifyReport: boolean;
  notifyLog: boolean;
  notifyClient: boolean;
  currentDate: string;
  runCompletedCount?: number;
  isRunningOverview?: boolean;
}

const POLL_MS_IDLE = 30_000;
const POLL_MS_RUNNING = 20_000;
const EMPTY_STATE: NotificationState = {
  events: [],
  total: 0,
};

function pushEvent(prev: NotificationState, event: NotificationEvent): NotificationState {
  if (prev.events.some((item) => item.id === event.id)) return prev;
  const nextEvents = [event, ...prev.events].slice(0, 25);
  return { events: nextEvents, total: nextEvents.length };
}

export function useNotifications(options: UseNotificationsOptions) {
  const [state, setState] = useState<NotificationState>(EMPTY_STATE);
  const lastSeenRunSignatureRef = useRef<string | null>(null);
  const lastSeenClientSignatureRef = useRef<string | null>(null);
  const lastDateRef = useRef<string | null>(null);
  const lastCompletedCountRef = useRef<number>(0);

  const clear = useCallback(() => {
    setState(EMPTY_STATE);
  }, []);

  const clearOne = useCallback((eventId: string) => {
    const targetId = String(eventId || "").trim();
    if (!targetId) return;
    setState((prev) => {
      const nextEvents = prev.events.filter((event) => event.id !== targetId);
      if (nextEvents.length === prev.events.length) return prev;
      return { events: nextEvents, total: nextEvents.length };
    });
  }, []);

  useEffect(() => {
    if (lastDateRef.current === options.currentDate) return;
    lastDateRef.current = options.currentDate;
    lastSeenRunSignatureRef.current = null;
    lastSeenClientSignatureRef.current = null;
  }, [options.currentDate]);

  useEffect(() => {
    const safeCount = Number(options.runCompletedCount || 0);
    if (!Number.isFinite(safeCount) || safeCount < 0) return;
    if (safeCount < lastCompletedCountRef.current) {
      lastCompletedCountRef.current = safeCount;
    }
  }, [options.runCompletedCount]);

  useEffect(() => {
    if (!options.enabled) return;
    let cancelled = false;

    const check = async () => {
      try {
        const summary = await apiGet<NotificationSummaryResponse>(
          `/api/notifications/summary?date=${encodeURIComponent(options.currentDate)}`,
        );

        if (cancelled) return;
        const latestRun = summary.latest_completed_run;
        if (latestRun) {
          const runSignature = `${latestRun.id}:${latestRun.finished_at || latestRun.started_at || ""}`;
          const eventAt = latestRun.finished_at || latestRun.started_at || new Date().toISOString();
          const safeCompletedCount = Number(options.runCompletedCount || 0);
          const localRunJustCompleted =
            Number.isFinite(safeCompletedCount) && safeCompletedCount > lastCompletedCountRef.current;

          // Se a execução local acabou, dispara notificação mesmo que assinatura já esteja visível no poll.
          if (localRunJustCompleted) {
            if (options.notifyReport) {
              setState((prev) =>
                pushEvent(prev, {
                  id: `run:${runSignature}:report`,
                  kind: "report",
                  title: "Relatório executado / finalizado",
                  at: eventAt,
                  targetView: "logs",
                }),
              );
            }
            if (options.notifyLog) {
              setState((prev) =>
                pushEvent(prev, {
                  id: `run:${runSignature}:log`,
                  kind: "log",
                  title: "Log novo",
                  at: eventAt,
                  targetView: "logs",
                }),
              );
            }
            lastCompletedCountRef.current = safeCompletedCount;
          }

          if (lastSeenRunSignatureRef.current === null) {
            lastSeenRunSignatureRef.current = runSignature;
          } else if (runSignature !== lastSeenRunSignatureRef.current) {
            if (options.notifyReport) {
              setState((prev) =>
                pushEvent(prev, {
                  id: `run:${runSignature}:report`,
                  kind: "report",
                  title: "Relatório executado / finalizado",
                  at: eventAt,
                  targetView: "logs",
                }),
              );
            }
            if (options.notifyLog) {
              setState((prev) =>
                pushEvent(prev, {
                  id: `run:${runSignature}:log`,
                  kind: "log",
                  title: "Log novo",
                  at: eventAt,
                  targetView: "logs",
                }),
              );
            }
            lastSeenRunSignatureRef.current = runSignature;
          }
        }

        const clientSignature = String(summary.clients_snapshot?.signature || "").trim() || null;
        if (clientSignature) {
          if (lastSeenClientSignatureRef.current === null) {
            lastSeenClientSignatureRef.current = clientSignature;
          } else if (clientSignature !== lastSeenClientSignatureRef.current) {
            lastSeenClientSignatureRef.current = clientSignature;
            if (options.notifyClient) {
              const eventAt = summary.clients_snapshot?.last_updated_at || new Date().toISOString();
              setState((prev) =>
                pushEvent(prev, {
                  id: `client:${clientSignature}`,
                  kind: "client",
                  title: "Cliente novo",
                  at: eventAt,
                  targetView: "clients",
                }),
              );
            }
          }
        }
      } catch {
        /* silent */
      }
    };

    check();
    const interval = window.setInterval(
      check,
      options.isRunningOverview ? POLL_MS_RUNNING : POLL_MS_IDLE,
    );
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    options.currentDate,
    options.enabled,
    options.isRunningOverview,
    options.notifyClient,
    options.notifyLog,
    options.notifyReport,
    options.runCompletedCount,
  ]);

  return { state, clear, clearOne };
}
