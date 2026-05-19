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
}

const POLL_MS = 30_000;
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

  const clear = useCallback(() => {
    setState(EMPTY_STATE);
  }, []);

  useEffect(() => {
    if (lastDateRef.current === options.currentDate) return;
    lastDateRef.current = options.currentDate;
    lastSeenRunSignatureRef.current = null;
    lastSeenClientSignatureRef.current = null;
  }, [options.currentDate]);

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
          if (lastSeenRunSignatureRef.current === null) {
            lastSeenRunSignatureRef.current = runSignature;
          } else if (runSignature !== lastSeenRunSignatureRef.current) {
            const eventAt = latestRun.finished_at || latestRun.started_at || new Date().toISOString();
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
    const interval = window.setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [options.currentDate, options.enabled, options.notifyClient, options.notifyLog, options.notifyReport, options.runCompletedCount]);

  return { state, clear };
}
