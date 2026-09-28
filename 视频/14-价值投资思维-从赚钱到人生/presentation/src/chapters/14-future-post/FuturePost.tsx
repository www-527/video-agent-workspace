import "./FuturePost.css";
import "./PillarFix.css";
import { narrations } from "./narrations";
import type { ChapterStepProps } from "../../registry/types";

type Kind="hero"|"secret"|"knowledge"|"skill"|"trust"|"health"|"compound"|"compass"|"why"|"journal"|"counter"|"value"|"pillar"|"robot"|"manual"|"post"|"final";
type Scene={kind:Kind;title:string;caption:string;mark?:string};
const scenes:Scene[]=[
 {kind:"hero",title:"两个包裹，来自同一个未来",caption:"一个装满作品、来信与跑旧的鞋；一个几乎是空的"},
 {kind:"secret",title:"最值得长期投资的，还有未来的你",caption:"今天的选择，正在给五年后的自己寄东西"},
 {kind:"knowledge",title:"知识会连接，不只是堆高",caption:"今天多一把钥匙，明天就能打开新的问题"},
 {kind:"skill",title:"技能从慢动作变成新台阶",caption:"基础动作熟了，困难动作才做得到"},
 {kind:"trust",title:"信任是一次次兑现的回执",caption:"答应的事做到，遇到问题坦白"},
 {kind:"health",title:"健康保护未来的选择",caption:"睡眠、运动与饮食，都在给未来留余地"},
 {kind:"compound",title:"小行动会站在上一次结果之上",caption:"这就是人生复利的共同点"},
 {kind:"compass",title:"长期主义，也要确认方向",caption:"坚持不是低头直走，而是带着指南针"},
 {kind:"why",title:"第一招：多问一个为什么",caption:"好在哪里？证据是什么？",mark:"WHY"},
 {kind:"journal",title:"第二招：先写下自己的判断",caption:"为什么这样选？何时检查？怎样算错？",mark:"WRITE"},
 {kind:"counter",title:"第三招：主动寻找反例",caption:"不是抬杠，是寻找道理的边界",mark:"TEST"},
 {kind:"compass",title:"独立思考，不是故意唱反调",caption:"关键是能说出证据与边界"},
 {kind:"value",title:"人的内在价值，来自四根支柱",caption:"它不是账户里一串零花钱数字"},
 {kind:"pillar",title:"支柱一｜诚信",caption:"答应的事做到，做不到就提前说明",mark:"诚信"},
 {kind:"pillar",title:"支柱二｜能力",caption:"练出能解决真实问题的本领",mark:"能力"},
 {kind:"pillar",title:"支柱三｜品格",caption:"困难时不甩锅，有余力时愿意帮人",mark:"品格"},
 {kind:"pillar",title:"支柱四｜眼界",caption:"为长期目标放下眼前的一点诱惑",mark:"眼界"},
 {kind:"robot",title:"同一个机器人，两种时间表",caption:"一次冲刺五小时，或每天推进二十分钟"},
 {kind:"robot",title:"三个月后，多了一台机器人",caption:"也多了一本故障手册"},
 {kind:"manual",title:"真正复利的是解决问题的方法",caption:"下一次，他已经不再从零开始"},
 {kind:"post",title:"游戏任务｜未来邮局",caption:"选择五年或十年后的寄达日期"},
 {kind:"post",title:"贴上三枚邮票",caption:"守住的事 · 练成的能力 · 希望成为的人"},
 {kind:"final",title:"把今天，一点点寄给未来",caption:"知识已经拿到了，现在去闯关吧。"},
];

function Visual({scene,step}:{scene:Scene;step:number}){
 if(scene.kind==="hero")return <div className="fp-hero"><img src="/assets/hero.png" alt="未来邮局中的两个包裹"/><div className="fp-label a">有内容的未来</div><div className="fp-label b">空白的未来</div></div>;
 if(scene.kind==="secret")return <div className="fp-parcel"><div className="fp-tape"/><span>寄件人<br/><b>今天的你</b></span><i>→</i><span>收件人<br/><b>未来的你</b></span></div>;
 if(scene.kind==="knowledge")return <div className="fp-network">{["概念","新闻","问题","判断","新知识"].map((x,i)=><span key={x} style={{"--i":i} as React.CSSProperties}>{x}</span>)}<svg viewBox="0 0 700 520"><path d="M120 100 L350 260 L590 100 M350 260 L130 430 M350 260 L580 430"/></svg></div>;
 if(scene.kind==="skill")return <div className="fp-stairs">{["基础","熟练","组合","创造"].map((x,i)=><div key={x} style={{"--i":i} as React.CSSProperties}>{x}</div>)}</div>;
 if(scene.kind==="trust")return <div className="fp-receipts">{["答应","做到","坦白","再做到"].map((x,i)=><div key={x} style={{"--i":i} as React.CSSProperties}><span>✓</span>{x}</div>)}</div>;
 if(scene.kind==="health")return <div className="fp-orbit"><div>未来选择</div><span>睡眠</span><span>运动</span><span>饮食</span></div>;
 if(scene.kind==="compound")return <div className="fp-compound">{[1,2,3,5,8,13].map((x,i)=><i key={x} style={{"--i":i,"--h":`${x*26}px`} as React.CSSProperties}/>)}</div>;
 if(scene.kind==="compass")return <div className="fp-compass"><div className="fp-needle">↑</div><span>证据</span><span>方向</span><span>边界</span></div>;
 if(scene.kind==="why")return <div className="fp-question"><b>{scene.mark}</b><div>好在哪里？</div><div>证据是什么？</div></div>;
 if(scene.kind==="journal")return <div className="fp-journal"><span>{scene.mark}</span><i/><i/><i/><b>检查日期 ______</b></div>;
 if(scene.kind==="counter")return <div className="fp-counter"><b>{scene.mark}</b><div className="fp-wall"><i/><i/><i/><i/><i/><i/><i/><i/></div><span>哪块条件拿掉，结论就不成立？</span></div>;
 if(scene.kind==="value")return <div className="fp-temple"><div className="fp-roof">内在价值</div>{[0,1,2,3].map(i=><i key={i}/>)}</div>;
 if(scene.kind==="pillar"){
  const valueIndex=step-12;
  const valueTag=step===13?"兑现":step===14?"创造":step===15?"担当":"延迟满足";
  return <div className={`fp-value-monument value-${valueIndex}`}>
   <div className="fp-value-rail"><i/><i/><i/></div>
   <div className="fp-value-card">
    <div className="fp-value-meta"><span>VALUE PILLAR</span><b>{String(valueIndex).padStart(2,"0")}</b></div>
    <strong>{scene.mark}</strong>
    <em>{valueTag}</em>
    <div className="fp-value-foundation"><i/><i/><i/></div>
   </div>
  </div>;
 }
 if(scene.kind==="robot")return <div className="fp-lab"><div className="fp-bot"><i/><i/><b>◉</b></div><div className="fp-timeline"><span>一次 5 小时</span><span className="active">每天 20 分钟</span></div><div className="fp-sparks">✦ ✦ ✦</div></div>;
 if(scene.kind==="manual")return <div className="fp-manual"><div className="fp-cover">故障手册<br/><small>问题 → 记录 → 方法</small></div><div className="fp-loop">↻</div></div>;
 return <div className={`fp-post ${scene.kind==="final"?"sent":""}`}><div className="fp-envelope"><div className="fp-flap"/><b>TO: 未来的我</b><span>{step===20?"寄达：五年 / 十年":step===21?"三枚邮票已贴好":"今天的行动，已经寄出"}</span>{scene.kind==="final"&&<em className="fp-sentstamp">已投递</em>}</div><div className="fp-stamps"><i>守住</i><i>能力</i><i>成为</i></div><div className="fp-slot"/></div>;
}
export function FuturePost({step}:ChapterStepProps){const scene=scenes[step]??scenes.at(-1)!;return <section className={`fp-scene state-${scene.kind} ${scene.kind==="final"?"final-scene":""}`} data-step={step} data-narration-length={narrations[step]?.replace(/\s/g,"").length??0}><div className="scene-safe fp-layout"><div className="fp-copy"><h1>{scene.title}</h1><p>{scene.caption}</p></div><div className="fp-visual"><Visual scene={scene} step={step}/></div></div></section>}
