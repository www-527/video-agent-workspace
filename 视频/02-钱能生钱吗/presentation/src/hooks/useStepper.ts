import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChapterDef } from "../registry/types";

const STORAGE_KEY = "money-night-workshop-video-cursor-v2";
export type Cursor = { chapter: number; step: number };

export interface StepperState {
  cursor: Cursor;
  totalChapters: number;
  chapterTotalSteps: number;
  globalIndex: number;
  totalGlobal: number;
  next(): void;
  prev(): void;
  jumpToChapter(idx: number, step?: number): void;
  jumpToGlobal(globalIdx: number): void;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function sanitize(cursor: Cursor, chapters: ChapterDef[]): Cursor {
  if (chapters.length === 0) return { chapter: 0, step: 0 };
  const chapter = clamp(cursor.chapter | 0, 0, chapters.length - 1);
  const step = clamp(cursor.step | 0, 0, Math.max(0, chapters[chapter]!.narrations.length - 1));
  return { chapter, step };
}

export function useStepper(chapters: ChapterDef[]): StepperState {
  const [cursor, setCursor] = useState<Cursor>(() => {
    const fallback = { chapter: 0, step: 0 };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) return sanitize(JSON.parse(raw), chapters);
    } catch {
      /* ignore invalid persisted state */
    }
    return fallback;
  });

  useEffect(() => setCursor((current) => sanitize(current, chapters)), [chapters]);
  useEffect(() => window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cursor)), [cursor]);

  const offsets = useMemo(() => {
    const result: number[] = [];
    let total = 0;
    chapters.forEach((chapter) => {
      result.push(total);
      total += chapter.narrations.length;
    });
    return result;
  }, [chapters]);
  const totalGlobal = useMemo(() => chapters.reduce((sum, chapter) => sum + chapter.narrations.length, 0), [chapters]);
  const globalIndex = (offsets[cursor.chapter] ?? 0) + cursor.step;

  const next = useCallback(() => {
    setCursor((current) => {
      const chapter = chapters[current.chapter]!;
      if (current.step < chapter.narrations.length - 1) return { ...current, step: current.step + 1 };
      if (current.chapter < chapters.length - 1) return { chapter: current.chapter + 1, step: 0 };
      return current;
    });
  }, [chapters]);

  const prev = useCallback(() => {
    setCursor((current) => {
      if (current.step > 0) return { ...current, step: current.step - 1 };
      if (current.chapter > 0) {
        const previous = chapters[current.chapter - 1]!;
        return { chapter: current.chapter - 1, step: previous.narrations.length - 1 };
      }
      return current;
    });
  }, [chapters]);

  const jumpToChapter = useCallback((idx: number, step = 0) => {
    const chapter = clamp(idx, 0, chapters.length - 1);
    setCursor({ chapter, step: clamp(step, 0, chapters[chapter]!.narrations.length - 1) });
  }, [chapters]);

  const jumpToGlobal = useCallback((global: number) => {
    const target = clamp(global, 0, totalGlobal - 1);
    let total = 0;
    for (let index = 0; index < chapters.length; index += 1) {
      const count = chapters[index]!.narrations.length;
      if (target < total + count) {
        setCursor({ chapter: index, step: target - total });
        return;
      }
      total += count;
    }
  }, [chapters, totalGlobal]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft" || event.key === "Backspace") {
        event.preventDefault();
        prev();
      } else if (event.key === "Home") jumpToChapter(0, 0);
      else if (event.key === "End") {
        const last = chapters.length - 1;
        jumpToChapter(last, chapters[last]!.narrations.length - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chapters, jumpToChapter, next, prev]);

  return {
    cursor,
    totalChapters: chapters.length,
    chapterTotalSteps: chapters[cursor.chapter]!.narrations.length,
    globalIndex,
    totalGlobal,
    next,
    prev,
    jumpToChapter,
    jumpToGlobal,
  };
}
