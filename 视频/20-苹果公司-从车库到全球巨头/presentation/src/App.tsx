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

const DURATIONS = [25000, 10000, 38000, 38000, 38000, 38000, 32000, 32000, 30000, 30000, 32000];

export default function App() {
  const capture = new URLSearchParams(location.search).has("capture");
  const stepper = useStepper(CHAPTERS);
  const chapter = CHAPTERS[stepper.cursor.chapter]!;
  const Chapter = chapter.Component;
  const { mode, cycleMode, autoStarted, setAutoStarted } = useAutoMode();
  const advance = useCallback(() => stepper.next(), [stepper]);
  const currentNarration = chapter.narrations[stepper.cursor.step];
  const audioSrc = currentNarration ? `/audio/${chapter.id}/${stepper.cursor.step + 1}.mp3` : null;

  useAudioPlayer({
    src: audioSrc,
    mode,
    trailMs: 200,
    estimateFallbackMs: DURATIONS[stepper.cursor.step] ?? 3000,
    onAutoAdvance: advance,
    autoStarted,
    resetKey: stepper.globalIndex,
  });

  return (
    <>
      <Stage onAdvance={stepper.next}>
        <div key={chapter.id} className="scene">
          <Chapter step={stepper.cursor.step} />
        </div>
      </Stage>
      {!capture && (
        <ProgressBar
          chapters={CHAPTERS}
          cursor={stepper.cursor}
          onJumpChapter={stepper.jumpToChapter}
        />
      )}
      {!capture && <AutoToggle mode={mode} onCycle={cycleMode} />}
      <AutoStartGate
        visible={mode === "auto" && !autoStarted}
        onStart={() => setAutoStarted(true)}
      />
    </>
  );
}
