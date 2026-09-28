import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/animations.css";
import {useCallback} from "react";
import {AutoStartGate} from "./components/AutoStartGate";
import {AutoToggle} from "./components/AutoToggle";
import {ProgressBar} from "./components/ProgressBar";
import {Stage} from "./components/Stage";
import {useAudioPlayer} from "./hooks/useAudioPlayer";
import {useAutoMode} from "./hooks/useAutoMode";
import {useStepper} from "./hooks/useStepper";
import {CHAPTERS} from "./registry/chapters";

const DURATIONS=[25000,10000,35000,40000,43000,45000,40000,40000,60000,30000];
export default function App(){
  const captureMode=new URLSearchParams(location.search).has("capture");
  const stepper=useStepper(CHAPTERS); const chapter=CHAPTERS[stepper.cursor.chapter]!; const Chapter=chapter.Component;
  const {mode,cycleMode,autoStarted,setAutoStarted}=useAutoMode(); const onAutoAdvance=useCallback(()=>stepper.next(),[stepper]);
  useAudioPlayer({playbackKey:`${stepper.cursor.chapter}:${stepper.cursor.step}`,src:null,mode,trailMs:200,estimateFallbackMs:DURATIONS[stepper.cursor.step]??3000,onAutoAdvance,autoStarted});
  return <><Stage onAdvance={stepper.next}><div key={chapter.id} className="scene"><Chapter step={stepper.cursor.step}/></div></Stage>{!captureMode&&<ProgressBar chapters={CHAPTERS} cursor={stepper.cursor} onJumpChapter={stepper.jumpToChapter}/>} {!captureMode&&<AutoToggle mode={mode} onCycle={cycleMode}/>}<AutoStartGate visible={mode==="auto"&&!autoStarted} onStart={()=>setAutoStarted(true)}/></>;
}
