import { SafetyMargin } from "../chapters/06-safety-margin/SafetyMargin";
import { narrations } from "../chapters/06-safety-margin/narrations";
import type { ChapterDef } from "./types";

export const CHAPTERS: ChapterDef[] = [{ id: "06-safety-margin", title: "安全边际：打折买好东西", narrations, Component: SafetyMargin }];
