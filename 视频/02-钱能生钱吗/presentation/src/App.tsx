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

const SILENT_STEP_DURATIONS_MS = [
  25000, 10000, 32000, 25000, 35000, 30000, 36000, 35000, 47000, 55000, 32000,
];

export default function App() {
  const captureMode = new URLSearchParams(window.location.search).has("capture");
  const stepper = useStepper(CHAPTERS);
  const chapter = CHAPTERS[stepper.cursor.chapter]!;
  const Chapter = chapter.Component;
  const stepText = chapter.narrations[stepper.cursor.step] ?? "";
  const { mode, cycleMode, autoStarted, setAutoStarted } = useAutoMode();
  const onAutoAdvance = useCallback(() => stepper.next(), [stepper]);

  useAudioPlayer({
    src: null,
    mode,
    trailMs: 200,
    estimateFallbackMs: SILENT_STEP_DURATIONS_MS[stepper.cursor.step] ?? Math.max(2400, stepText.length * 220),
    onAutoAdvance,
    autoStarted,
  });

  return (
    <>
      <Stage onAdvance={stepper.next}>
        <div key={chapter.id} className="scene">
          <Chapter step={stepper.cursor.step} />
        </div>
      </Stage>
      {!captureMode && (
        <ProgressBar chapters={CHAPTERS} cursor={stepper.cursor} onJumpChapter={stepper.jumpToChapter} />
      )}
      {!captureMode && <AutoToggle mode={mode} onCycle={cycleMode} />}
      <AutoStartGate visible={mode === "auto" && !autoStarted} onStart={() => setAutoStarted(true)} />
    </>
  );
}
