import { StoryKingdom } from "../chapters/16-story-kingdom/StoryKingdom";
import { narrations } from "../chapters/16-story-kingdom/narrations";
import type { ChapterDef } from "./types";

export const CHAPTERS: ChapterDef[] = [{
  id: "16-story-kingdom",
  title: "迪士尼：一只老鼠创造的王国",
  narrations,
  Component: StoryKingdom,
}];
