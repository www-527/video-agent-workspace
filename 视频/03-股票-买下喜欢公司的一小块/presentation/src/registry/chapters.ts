import type { ChapterDef } from "./types";
import StockPuzzle from "../chapters/03-stock-puzzle/StockPuzzle";
import { narrations } from "../chapters/03-stock-puzzle/narrations";

export const CHAPTERS: ChapterDef[] = [{ id: "stock-puzzle", title: "股票：买下公司的一小块", narrations, Component: StockPuzzle }];
