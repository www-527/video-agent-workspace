import { SignalDetective } from "../chapters/12-signal-detective/SignalDetective";
import { narrations } from "../chapters/12-signal-detective/narrations";
import type { ChapterDef } from "./types";

export const CHAPTERS: ChapterDef[] = [
  { id: "12-signal-detective", title: "避开陷阱：别当韭菜", narrations, Component: SignalDetective },
];
