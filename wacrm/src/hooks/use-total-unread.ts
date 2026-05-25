"use client";

import { useEffect, useRef, useState } from "react";

export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);
  const countsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      let data: { id: string; unread_count: number }[] | null = null;
      try {
        const res = await fetch("/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            table: "conversations",
            select: "id,unread_count",
          }),
        });
        if (!res.ok) return;
        const json = await res.json();
        const raw: unknown = json?.data;
        if (cancelled || !Array.isArray(raw)) return;
        data = raw as { id: string; unread_count: number }[];
      } catch {
        return;
      }


      const map = new Map<string, number>();
      let sum = 0;
      for (const row of data) {
        const n = row.unread_count ?? 0;
        map.set(row.id, n);
        if (n > 0) sum += 1;
      }
      countsRef.current = map;
      setTotal(sum);
    };

    fetchAll();

    const interval = setInterval(async () => {
      let data: { id: string; unread_count: number }[] | null = null;
      try {
        const res = await fetch("/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            table: "conversations",
            select: "id,unread_count",
          }),
        });
        if (!res.ok) return;
        const json = await res.json();
        const raw: unknown = json?.data;
        if (cancelled || !Array.isArray(raw)) return;
        data = raw as { id: string; unread_count: number }[];
      } catch {
        return;
      }

      const map = countsRef.current;
      for (const row of data) {
        map.set(row.id, row.unread_count ?? 0);
      }
      // Remove IDs no longer present
      const fetchedIds = new Set(data.map((r) => r.id));
      for (const id of map.keys()) {
        if (!fetchedIds.has(id)) map.delete(id);
      }
      let sum = 0;
      for (const n of map.values()) if (n > 0) sum += 1;
      setTotal(sum);
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return total;
}
