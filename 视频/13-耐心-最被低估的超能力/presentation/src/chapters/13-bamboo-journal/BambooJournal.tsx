import "./BambooJournal.css";
import { narrations } from "./narrations";
import type { ChapterStepProps } from "../../registry/types";

type Kind = "hero" | "secret" | "rhizome" | "shoot" | "business" | "observe" | "signal" | "plan" | "guitar" | "game" | "final";
type Scene = { kind: Kind; title: string; caption: string; accent?: string };
const scenes: Scene[] = [
  { kind:"hero", title:"泥土下面，真的什么都没发生吗？", caption:"小芽等了十天，竹林依然安静" },
  { kind:"secret", title:"耐心，不是干等", caption:"让正确的小行动，有时间连在一起" },
  { kind:"rhizome", title:"先纠正一个流行故事", caption:"竹子并非整齐地等四年、第五年才生长" },
  { kind:"shoot", title:"突然破土，其实准备已久", caption:"竹鞭与根系先在地下储备、扩展" },
  { kind:"business", title:"看不见的经营，也在生长", caption:"开店、改产品、服务顾客，都是地下的根" },
  { kind:"observe", title:"耐心必须带着观察", caption:"理由还在吗？公司还在变好吗？" },
  { kind:"observe", title:"长期持有，不等于永远不变", caption:"不要用一天的涨跌推翻长期判断" },
  { kind:"signal", title:"信号一：事实真的变坏", caption:"需求、诚信、优势，都要重新检查", accent:"01" },
  { kind:"signal", title:"信号二：价格跑得太远", caption:"当兴奋超过价值，耐心也要会刹车", accent:"02" },
  { kind:"signal", title:"信号三：出现更好的机会", caption:"新机会也要经过同一套检查", accent:"03" },
  { kind:"signal", title:"信号四：生活需要用钱", caption:"投资服务生活，不能绑住生活", accent:"04" },
  { kind:"observe", title:"决定变不变的，是事实", caption:"不是朋友一句话，也不是价格一天的表情" },
  { kind:"plan", title:"给耐心一张五年计划", caption:"先写清楚：五年后想完成什么？", accent:"目标" },
  { kind:"plan", title:"小行动从哪里来？", caption:"每周储蓄、持续学习、模拟记录", accent:"行动" },
  { kind:"plan", title:"先写下坏天气预案", caption:"继续与停止，都要有事实条件", accent:"预案" },
  { kind:"plan", title:"选一个固定复盘日", caption:"一年一次，检查目标、方法与新知识", accent:"复盘" },
  { kind:"guitar", title:"第一周，声音也许并不好听", caption:"把吉他放在角落，半年后不会自动会弹" },
  { kind:"guitar", title:"每天十分钟，动作会扎根", caption:"一个月换和弦，半年弹完一首歌" },
  { kind:"game", title:"游戏任务｜五年竹林计划", caption:"填满五块竹节，让地下根系连起来" },
  { kind:"final", title:"竹笋准备破土", caption:"知识已经拿到了，现在去闯关吧。" },
];

function Visual({ scene, step }:{ scene:Scene; step:number }) {
  if (scene.kind === "hero") return <div className="bj-hero"><img src="/assets/hero.png" alt="春雨后的竹林与地下根系"/><span className="bj-rain r1"/><span className="bj-rain r2"/><span className="bj-rain r3"/></div>;
  if (scene.kind === "secret") return <div className="bj-secret"><span>正确行动</span><i/><span>时间</span><i/><b>复利</b></div>;
  if (scene.kind === "rhizome") return <div className="bj-soil"><div className="bj-ground"/><div className="bj-roots"><i/><i/><i/><i/></div><div className="bj-myth">“四年不长”</div><div className="bj-stamp">需要校正</div></div>;
  if (scene.kind === "shoot") return <div className="bj-growth"><div className="bj-bamboo"><i/><i/><i/><i/><i/></div><div className="bj-days">45—60 天<br/><b>接近 20 米</b></div></div>;
  if (scene.kind === "business") return <div className="bj-business"><div className="bj-shop">开店</div><div className="bj-product">改产品</div><div className="bj-people">服务顾客</div><svg viewBox="0 0 900 260"><path d="M60 170 C190 70 280 240 410 130 S650 200 840 80"/></svg></div>;
  if (scene.kind === "observe") return <div className="bj-lens"><div className="bj-eye">事实</div><div className="bj-axis"><span>一天</span><span>一年</span><span>五年</span></div></div>;
  if (scene.kind === "signal") return <div className="bj-signal"><b>{scene.accent}</b><div className="bj-branch"><i/><i/><i/></div><span>{step === 7 ? "需求｜诚信｜优势" : step === 8 ? "价格｜价值｜边界" : step === 9 ? "比较｜验证｜选择" : "上学｜家庭｜目标"}</span></div>;
  if (scene.kind === "plan") return <div className="bj-plan"><div className="bj-node">{scene.accent}</div><div className="bj-joints">{[0,1,2,3,4].map((n)=><i key={n} className={n <= step-12 ? "on" : ""}/>)}</div><div className="bj-note">目标 · 行动 · 来源 · 预案 · 复盘</div></div>;
  if (scene.kind === "guitar") return <div className="bj-guitar"><div className="bj-neck"><i/><i/><i/><i/><i/></div><div className="bj-body">♪</div><div className="bj-calendar">{step === 16 ? "第 1 周" : "每天 10 分钟"}</div></div>;
  return <div className={`bj-game ${scene.kind === "final" ? "ready" : ""}`}><div className="bj-rootline"/>{["目标","小行动","来源","预案","复盘"].map((x,i)=><div className="bj-segment" key={x} style={{"--i":i} as React.CSSProperties}>{x}</div>)}<div className="bj-sprout"><i/><i/><i/></div></div>;
}

export function BambooJournal({ step }:ChapterStepProps) {
  const scene = scenes[step] ?? scenes.at(-1)!;
  return <section className={`bj-scene state-${scene.kind} ${scene.kind === "final" ? "final-scene" : ""}`} data-step={step} data-narration-length={narrations[step]?.replace(/\s/g,"").length ?? 0}><div className="scene-safe bj-layout"><div className="bj-copy"><h1>{scene.title}</h1><p>{scene.caption}</p></div><div className="bj-visual"><Visual scene={scene} step={step}/></div></div></section>;
}
