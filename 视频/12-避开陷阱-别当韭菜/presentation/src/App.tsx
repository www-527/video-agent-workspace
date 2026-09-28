import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/animations.css";
import { useCallback } from "react";
import { AutoStartGate } from "./components/AutoStartGate";
import { AutoToggle } from "./components/AutoToggle";
import { ProgressBar } from "./components/ProgressBar";
import { Stage } from "./components/Stage";
import { useAudioPlayer } from "./hooks/useAudioPlayer";
import { useAutoMode } from "./hooks/useAutoMode";
import { useStepper } from "./hooks/useStepper";
import { CHAPTERS } from "./registry/chapters";

const estimateDuration = (text: string) => Math.max(3500, text.length * 250 + 900);

export default function App() {
  const capture = new URLSearchParams(location.search).has("capture");
  const s = useStepper(CHAPTERS);
  const chapter = CHAPTERS[s.cursor.chapter]!;
  const Chapter = chapter.Component;
  const { mode, cycleMode, autoStarted, setAutoStarted } = useAutoMode();
  const advance = useCallback(() => s.next(), [s]);
  const narration = chapter.narrations[s.cursor.step] ?? "";
  useAudioPlayer({ playbackKey: `${s.cursor.chapter}:${s.cursor.step}`, src:`/audio/${chapter.id}/${s.cursor.step+1}.mp3`, mode, trailMs: 200, estimateFallbackMs: estimateDuration(narration), onAutoAdvance: advance, autoStarted });
  return <><Stage onAdvance={s.next}><div key={chapter.id} className="scene"><Chapter step={s.cursor.step} /></div></Stage>{!capture && <ProgressBar chapters={CHAPTERS} cursor={s.cursor} onJumpChapter={s.jumpToChapter} />}{!capture && <AutoToggle mode={mode} onCycle={cycleMode} />}<AutoStartGate visible={mode === "auto" && !autoStarted} onStart={() => setAutoStarted(true)} /></>;
}
