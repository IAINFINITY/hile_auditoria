"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import type { ReportHistoryResponse, ClientsByDateResponse } from "../../../types";

export interface NotificationState {
  newReport: boolean;
  newLog: boolean;
  newClient: boolean;
  total: number;
}

interface UseNotificationsOptions {
  enabled: boolean;
  notifyReport: boolean;
  notifyLog: boolean;
  notifyClient: boolean;
  currentDate: string;
}

const POLL_MS = 30_000;

export function useNotifications(options: UseNotificationsOptions) {
  const [state, setState] = useState<NotificationState>({ newReport: false, newLog: false, newClient: false, total: 0 });
  const lastSeenRunIdRef = useRef<string | null>(null);
  const lastSeenFinishedAtRef = useRef<string | null>(null);
  const knownClientPksRef = useRef<Set<string> | null>(null);

  const clear = useCallback(() => {
    setState({ newReport: false, newLog: false, newClient: false, total: 0 });
  }, []);

  useEffect(() => {
    if (!options.enabled) return;
    let cancelled = false;

    const check = async () => {
      try {
        const [historyRes, clientsRes] = await Promise.allSettled([
          apiGet<ReportHistoryResponse>("/api/report-day/history?limit=5"),
          apiGet<ClientsByDateResponse>(`/api/clients?date=${options.currentDate}`),
        ]);

        if (cancelled) return;

        if (historyRes.status === "fulfilled") {
          const items = historyRes.value.items || [];
          const latestRun = items.find((i) => i.status === "completed") || null;

          if (latestRun) {
            if (lastSeenRunIdRef.current === null) {
              lastSeenRunIdRef.current = latestRun.id;
              lastSeenFinishedAtRef.current = latestRun.finished_at;
            } else {
              const isNewRun = latestRun.id !== lastSeenRunIdRef.current;
              const isNewer =
                latestRun.finished_at &&
                lastSeenFinishedAtRef.current &&
                new Date(latestRun.finished_at).getTime() > new Date(lastSeenFinishedAtRef.current).getTime();

              if (isNewRun && isNewer) {
                setState((prev) => {
                  const nr = options.notifyReport;
                  const nl = options.notifyLog;
                  return {
                    newReport: nr,
                    newLog: nl,
                    newClient: prev.newClient,
                    total: (nr ? 1 : 0) + (nl ? 1 : 0) + (prev.newClient ? 1 : 0),
                  };
                });
                lastSeenRunIdRef.current = latestRun.id;
                lastSeenFinishedAtRef.current = latestRun.finished_at;
              }
            }
          }
        }

        if (clientsRes.status === "fulfilled") {
          const items = clientsRes.value.items || [];
          const currentPks = new Set(items.map((c) => c.phonePk));
          if (knownClientPksRef.current === null) {
            knownClientPksRef.current = currentPks;
          } else {
            let hasNew = false;
            for (const pk of currentPks) {
              if (!knownClientPksRef.current.has(pk)) { hasNew = true; break; }
            }
            if (hasNew) {
              knownClientPksRef.current = currentPks;
              setState((prev) => {
                const nc = options.notifyClient;
                return { ...prev, newClient: nc, total: prev.total + (nc ? 1 : 0) };
              });
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
  }, [options.enabled, options.notifyReport, options.notifyLog, options.notifyClient, options.currentDate]);

  return { state, clear };
}
