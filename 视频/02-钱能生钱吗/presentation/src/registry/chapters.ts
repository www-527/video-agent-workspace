import type { ChapterDef } from "./types";
import MoneyNightWorkshop from "../chapters/02-money-night-workshop/MoneyNightWorkshop";
import { narrations } from "../chapters/02-money-night-workshop/narrations";

export const CHAPTERS: ChapterDef[] = [
  {
    id: "money-night-workshop",
    title: "钱能生钱吗？",
    narrations,
    Component: MoneyNightWorkshop,
  },
];
