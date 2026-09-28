import type{ChapterStepProps}from"../../registry/types";import"./CoreBrick.css";
const Brick=({tone="a",label=""}:{tone?:string;label?:string})=><div className={`cb-brick cb-${tone}`}><i/><i/><i/><i/>{label&&<span>{label}</span>}</div>;
const Heading=({children}:{children:React.ReactNode})=><h1 className="cb-heading">{children}</h1>;
export function CoreBrick({step}:ChapterStepProps){
if(step===0)return <div className="scene cb-scene cb-cover"><img src="/assets/ch17-core-brick-workshop.png"/><div className="cb-cover-mask"/><div className="cb-cover-copy"><Heading>做得越多<br/>为什么越接近倒塌？</Heading><p>救下城堡的，是一块最普通的积木。</p></div><div className="cb-falling">{["游戏","乐园","电视","新玩具"].map((x,i)=><Brick key={x} tone={`t${i}`} label={x}/>)}</div></div>;
if(step===1)return <div className="scene cb-scene scene-safe cb-secret"><div className="cb-focus-brick"><Brick label="核心"/></div><div><span className="cb-kicker">今天破解</span><Heading>护城河藏在<br/><em>最难复制</em>的一件事里</Heading></div></div>;
if(step===2)return <div className="scene cb-scene scene-safe cb-workshop"><div className="cb-bench"><div className="cb-saw"/><div className="cb-rail">{["汽车","城堡","怪兽"].map((x,i)=><div className={`cb-model cb-model-${i}`} key={x}><Brick tone={`t${i}`} label={x}/></div>)}</div></div><div className="cb-work-copy"><div className="hero-num">1932→1949</div><Heading>一块砖<br/>无限重组</Heading><p>卖的不是塑料，是一套创造系统。</p></div></div>;
if(step===3)return <div className="scene cb-scene scene-safe cb-collapse"><Heading>业务越长，核心越暗</Heading><div className="cb-business-tree"><div className="cb-core"><Brick label="积木"/></div>{["电脑游戏","主题公园","电视节目","新玩具线","更多项目"].map((x,i)=><div className={`cb-limb cb-limb-${i}`} key={x}><Brick tone={`t${i%4}`} label={x}/></div>)}</div><div className="cb-year">2003 · 差点破产</div></div>;
if(step===4)return <div className="scene cb-scene scene-safe cb-prune">
  <div className="cb-prune-copy">
    <div className="cb-prune-year">2004</div>
    <Heading>砍掉分支<br/><em>把资源还给核心</em></Heading>
    <p>不是再发明一百件东西，<br/>而是把那块砖做得更准、更稳、更好玩。</p>
  </div>
  <div className="cb-prune-story" aria-label="偏离核心的业务退出，传统积木、经典系列和拼搭系统重新组成稳定核心">
    <div className="cb-prune-away">
      {["电脑游戏","主题公园","电视节目","新玩具线"].map((label,index)=><Brick key={label} tone={`t${index}`} label={label}/>)}
      <span>偏离核心的业务退出</span>
    </div>
    <div className="cb-prune-flow"><i/><strong>资源重新集中</strong><i/></div>
    <div className="cb-prune-tower">
      <Brick tone="t1" label="经典系列"/>
      <Brick label="传统积木"/>
      <Brick tone="t2" label="拼搭系统"/>
      <span>核心重新咬合</span>
    </div>
  </div>
</div>;
if(step===5)return <div className="scene cb-scene scene-safe cb-micron"><Heading>几微米，决定“刚刚好”</Heading><div className="cb-caliper"><div className="cb-jaw cb-j1"/><div className="cb-jaw cb-j2"/><div className="cb-scale">μm</div><Brick/></div><div className="cb-fit-states"><span>太松</span><strong>刚刚好</strong><span>太紧</span></div><p>比头发丝更细的误差，变成几十年磨出的手感。</p></div>;
if(step===6)return <div className="scene cb-scene scene-safe cb-fort">
  <img className="cb-fort-art" src="/assets/ch17-core-fortress.png" alt="四面不同积木墙共同保护中央核心城堡"/>
  <div className="cb-fort-copy">
    <Heading>四面墙，<br/><em>互相咬合</em></Heading>
    <p>品牌建立信任，工艺形成手感，<br/>创意让系统不断生长，品质守住安全。</p>
    <strong>少掉一面，城堡都会变脆。</strong>
  </div>
  <div className="cb-fort-label cb-fort-brand">品牌</div>
  <div className="cb-fort-label cb-fort-craft">工艺</div>
  <div className="cb-fort-label cb-fort-creative">创意</div>
  <div className="cb-fort-label cb-fort-quality">品质</div>
  <div className="cb-fort-core">核心生意</div>
</div>;
if(step===7)return <div className="scene cb-scene scene-safe cb-club"><Heading>生活例子：资源被摊薄</Heading><div className="cb-resource"><div className="cb-main">自由搭建<div className="cb-tokens">{Array.from({length:12},(_,i)=><i key={i}/>)}</div></div>{["烘焙","街舞","编程","摄影"].map((x,i)=><div className={`cb-side cb-side-${i}`} key={x}>{x}<span/></div>)}</div><p>老师、材料、时间都有限。开第五个小组，不如先救回最会做的活动。</p></div>;
if(step===8)return <div className="scene cb-scene scene-safe cb-shell"><Heading>外壳可以换，核心不能退</Heading><div className="cb-core-stack"><div className="cb-skin cb-skin-a">故事外壳</div><div className="cb-skin cb-skin-b">颜色外壳</div><div className="cb-inner"><Brick label="系统"/><strong>咬合</strong><strong>安全</strong></div></div><p>专注，是知道城堡正中央必须留下哪一块。</p></div>;
return <div className="scene cb-scene scene-safe cb-final">
  <div className="cb-final-visual">
    <img src="/assets/ch17-core-fortress.png" alt="由四面墙保护中央核心的积木城堡"/>
    <div className="cb-final-focus"><span>核心积木</span></div>
  </div>
  <div className="cb-final-copy">
    <Heading>守住核心，<br/><em>才能拼得更远</em></Heading>
    <p className="cb-summary">乐高守住积木系统，再用品牌、工艺、创意和品质筑起护城河。专注不是拒绝变化，而是知道什么绝不能丢。</p>
    <div className="cb-foundation" aria-label="品牌、工艺、创意和品质共同支撑核心">
      {["品牌","工艺","创意","品质"].map((item,index)=><span className={`cb-foundation-${index}`} key={item}>{item}</span>)}
    </div>
    <strong>知识已经拿到了，现在去闯关吧。</strong>
  </div>
</div>}
