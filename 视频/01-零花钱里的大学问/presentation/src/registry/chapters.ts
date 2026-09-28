import type { ChapterDef } from "./types";
import PocketMoneyChapter from "../chapters/01-pocket-money/PocketMoney";
import { narrations as pocketMoneyNarrations } from "../chapters/01-pocket-money/narrations";

export const CHAPTERS: ChapterDef[] = [
  {
    id: "pocket-money",
    title: "零花钱里的大学问",
    narrations: pocketMoneyNarrations,
    Component: PocketMoneyChapter,
  },
];
