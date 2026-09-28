import "./SodaArchive.css";
import { narrations } from "./narrations";
import type { ChapterStepProps } from "../../registry/types";

type Kind="hero"|"secret"|"chain"|"system"|"brand"|"memory"|"formula"|"channel"|"scale"|"moat"|"globe"|"berkshire"|"dividend"|"review"|"icebox"|"shelf"|"observe"|"game"|"final";
type Scene={kind:Kind;title:string;caption:string;mark?:string};
const scenes:Scene[]=[
 {kind:"hero",title:"1886：每天大约只卖九杯",caption:"五美分一杯的深色气泡饮料，会走过一百多年吗？"},
 {kind:"secret",title:"容易模仿的糖水，为什么难以复制？",caption:"答案不在一只瓶子里，而在一整套长期系统"},
 {kind:"chain",title:"浓缩液，从工厂走向每一杯",caption:"生产原料 · 装瓶配送 · 商店餐厅"},
 {kind:"chain",title:"先把生意拆成一条价值链",caption:"谁生产？谁装瓶？谁把饮料卖到你手里？"},
 {kind:"system",title:"简单，不等于容易打败",caption:"真正难复制的，是多年相互咬合的齿轮"},
 {kind:"brand",title:"护城河一｜品牌",caption:"名字、红色、瓶身曲线与许多年的体验",mark:"01"},
 {kind:"memory",title:"品牌，是很多次体验留下的记忆",caption:"记忆缩短选择时间，也会影响支付意愿"},
 {kind:"formula",title:"护城河二｜配方故事",caption:"神秘感很有用，但一张配方铺不满全球货架",mark:"02"},
 {kind:"channel",title:"护城河三｜渠道",caption:"便利店、餐厅、影院、加油站，想喝时就在附近",mark:"03"},
 {kind:"scale",title:"护城河四｜规模",caption:"采购、生产、广告、配送越大，单位成本可能越低",mark:"04"},
 {kind:"moat",title:"四道护城河叠在一起",caption:"品牌易认 · 渠道易买 · 产品易懂 · 规模降本"},
 {kind:"globe",title:"每天约 22 亿份旗下商标饮料",caption:"这是整个公司品牌组合，不是经典可乐单品"},
 {kind:"berkshire",title:"伯克希尔：总成本约 13 亿美元",caption:"多年完成买入；这不是一把梭哈的童话"},
 {kind:"dividend",title:"现金股息：7500 万 → 7.04 亿美元",caption:"1994 与 2022，长期经营结果被看见"},
 {kind:"review",title:"历史成功，不等于任何价格都值得买",caption:"品牌、渠道、消费者、风险与价格，都要复查"},
 {kind:"icebox",title:"运动会后的冰柜前",caption:"味道接近，同学却先伸手拿熟悉的红色瓶"},
 {kind:"shelf",title:"先被想起，又最顺手拿到",caption:"品牌与渠道，两股力量互相加强"},
 {kind:"observe",title:"观察品牌，不是让你多喝汽水",caption:"看它在哪里出现、为何被看见、谁送到那里"},
 {kind:"game",title:"游戏任务｜品牌侦探",caption:"一周记录超市、餐厅、外卖、广告与活动线索"},
 {kind:"game",title:"从四项里选出最强证据",caption:"品牌 · 渠道 · 产品 · 规模，并写下理由"},
 {kind:"final",title:"档案已装入侦探箱",caption:"知识已经拿到了，现在去闯关吧。"},
];

function Visual({scene}:{scene:Scene}){
 if(scene.kind==="hero")return <div className="sa-hero"><img src="/assets/hero.png" alt="1886 年复古汽水柜台"/><div className="sa-price">5¢</div><div className="sa-nine">{Array.from({length:9},(_,i)=><i key={i}/>)}</div></div>;
 if(scene.kind==="secret")return <div className="sa-secret"><div className="sa-bottle">?</div><div className="sa-xray"><i/><i/><i/><i/></div><span>瓶子背后的系统</span></div>;
 if(scene.kind==="chain")return <div className="sa-chain"><div>浓缩液</div><i>→</i><div>装瓶配送</div><i>→</i><div>商店餐厅</div><span className="sa-bubble b1"/><span className="sa-bubble b2"/></div>;
 if(scene.kind==="system")return <div className="sa-gears">{["品牌","配方","渠道","规模"].map((x,i)=><div key={x} style={{"--i":i} as React.CSSProperties}>{x}<i/></div>)}</div>;
 if(scene.kind==="brand")return <div className="sa-brand"><b>{scene.mark}</b><div className="sa-contour"/><span>识别速度</span></div>;
 if(scene.kind==="memory")return <div className="sa-memory">{["看见","尝过","记住","再选择"].map((x,i)=><div key={x} style={{"--i":i} as React.CSSProperties}>{x}</div>)}<svg viewBox="0 0 700 420"><path d="M80 210 C170 40 270 380 360 210 S550 40 640 210"/></svg></div>;
 if(scene.kind==="formula")return <div className="sa-vault"><b>{scene.mark}</b><div className="sa-door"><i/><i/><span>SECRET</span></div><div className="sa-shelves">货架 × 世界</div></div>;
 if(scene.kind==="channel")return <div className="sa-map"><b>{scene.mark}</b>{["便利店","餐厅","影院","加油站"].map((x,i)=><span key={x} style={{"--i":i} as React.CSSProperties}>{x}</span>)}<div className="sa-route"/></div>;
 if(scene.kind==="scale")return <div className="sa-scale"><b>{scene.mark}</b><div className="sa-belt">{[1,2,3,4,5,6].map(i=><i key={i}/>)}</div><div className="sa-cost">数量 ↑<br/>单位成本 <strong>↓</strong></div></div>;
 if(scene.kind==="moat")return <div className="sa-castle"><div className="sa-tower t1">品牌</div><div className="sa-tower t2">渠道</div><div className="sa-tower t3">产品</div><div className="sa-tower t4">规模</div><div className="sa-water"/></div>;
 if(scene.kind==="globe")return <div className="sa-globe"><div className="sa-world">2.2B</div><div className="sa-orbits"><i/><i/><i/></div><span>份 / 天 · 公司旗下商标组合</span></div>;
 if(scene.kind==="berkshire")return <div className="sa-timeline"><div className="sa-line"/><span>1988<br/>开始买入</span><span>多年<br/>持续完成</span><span>成本<br/><b>$1.3B</b></span></div>;
 if(scene.kind==="dividend")return <div className="sa-dividend"><div style={{"--h":"110px"} as React.CSSProperties}><b>$75M</b><span>1994</span></div><i>→</i><div style={{"--h":"520px"} as React.CSSProperties}><b>$704M</b><span>2022</span></div></div>;
 if(scene.kind==="review")return <div className="sa-review">{["品牌还强吗？","渠道还有效吗？","消费者在变吗？","风险与价格？"].map((x,i)=><div key={x} style={{"--i":i} as React.CSSProperties}><i>□</i>{x}</div>)}</div>;
 if(scene.kind==="icebox")return <div className="sa-icebox"><div className="sa-glass"/><div className="sa-doorline"/><div className="sa-cola c1"/><div className="sa-cola c2"/><div className="sa-hand"><i/><i/><i/></div></div>;
 if(scene.kind==="shelf")return <div className="sa-shelf"><div className="sa-head">先想起</div><i>＋</i><div className="sa-near">顺手拿到</div><b>更容易被选择</b></div>;
 if(scene.kind==="observe")return <div className="sa-lens"><div className="sa-city"><i/><i/><i/><i/><i/></div><span>在哪里出现？</span><b>谁把它送到那里？</b></div>;
 return <div className={`sa-game ${scene.kind==="final"?"packed":""}`}><div className="sa-case"><b>BRAND<br/>DETECTIVE</b><span>品牌</span><span>渠道</span><span>产品</span><span>规模</span></div><div className="sa-clues">{["超市","餐厅","外卖","广告","活动"].map(x=><i key={x}>{x}</i>)}</div><div className="sa-latch">×</div></div>;
}
export function SodaArchive({step}:ChapterStepProps){const scene=scenes[step]??scenes.at(-1)!;return <section className={`sa-scene state-${scene.kind} ${scene.kind==="final"?"final-scene":""}`} data-step={step} data-narration-length={narrations[step]?.replace(/\s/g,"").length??0}><div className="scene-safe sa-layout"><div className="sa-copy"><h1>{scene.title}</h1><p>{scene.caption}</p></div><div className="sa-visual"><Visual scene={scene}/></div></div></section>}
