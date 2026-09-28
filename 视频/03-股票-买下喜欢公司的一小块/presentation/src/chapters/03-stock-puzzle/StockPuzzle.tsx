import type { CSSProperties, ReactNode } from "react";
import type { ChapterStepProps } from "../../registry/types";
import "./StockPuzzle.css";

function Title({ children, note }: { children: ReactNode; note: ReactNode }) {
  return <div className="sp-title"><h1>{children}</h1><p>{note}</p></div>;
}

function Cup({ small = false }: { small?: boolean }) {
  return <div className={`sp-cup ${small ? "sp-cup-small" : ""}`}><div className="sp-lid" /><div className="sp-straw" /><i /><i /><i /></div>;
}

function Hook() {
  return <div className="sp-scene sp-hook scene-safe">
    <div className="sp-keyart"><img src="/assets/milk-tea-share-puzzle-keyart.png" alt="奶茶店主把公司拼图交给小屿" /><div className="sp-keyart-wash" />
      <div className="sp-hook-card"><span>20万 + ? = 50万</span><h1>还差30万<br />这家店该怎么开？</h1><b>100位邻居 × 3000元</b></div>
    </div>
  </div>;
}

function Secrets() {
  const items = [["有", "所有权", "股票背后是什么"], ["分", "分享结果", "回报与风险一起出现"], ["研", "研究公司", "喜欢只是起点"]];
  return <div className="sp-scene sp-secrets scene-safe"><Title note="三枚印章，盖在同一份股东手册上">今天要看懂什么？</Title>
    <div className="sp-stamps">{items.map((item, index) => <div className="sp-stamp" style={{ "--i": index } as CSSProperties} key={item[1]}><i>{item[0]}</i><strong>{item[1]}</strong><span>{item[2]}</span></div>)}</div>
  </div>;
}

function Funding() {
  return <div className="sp-scene sp-funding scene-safe"><Title note="投资人用资金，换取一部分公司所有权">开第二家店，需要一场交换</Title>
    <div className="sp-funding-stage">
      <div className="sp-shop-plan"><div className="sp-store"><div /><Cup small /></div><strong>第二家店</strong><span>装修 · 设备 · 人员 · 原料</span></div>
      <div className="sp-money-stack"><b>50万</b><div className="sp-money-bar"><i /><em /></div><span><strong>已有20万</strong><strong>还差30万</strong></span></div>
      <div className="sp-exchange"><div className="sp-cash-packets">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</div><div className="sp-double-arrow">⇄</div><div className="sp-share-tiles">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</div><b>资金 ⇄ 所有权</b></div>
    </div>
  </div>;
}

function ShareMath() {
  const tiles = Array.from({ length: 100 }, (_, index) => index);
  return <div className="sp-scene sp-share-math scene-safe"><Title note="教学简化模型：融资后按50万元分成100份">先把100块拼图分明白</Title>
    <div className="sp-share-stage">
      <div className="sp-puzzle-grid">{tiles.map((tile) => <i className={tile < 40 ? "sp-founder-tile" : "sp-investor-tile"} style={{ "--tile": tile } as CSSProperties} key={tile} />)}</div>
      <div className="sp-share-ledger"><div className="sp-ledger-founder"><span>老板原有20万</span><strong>40块</strong><small>40%</small></div><div className="sp-ledger-investors"><span>邻居投入30万</span><strong>60块</strong><small>60%</small></div><div className="sp-ledger-person"><span>100位邻居平均</span><strong>60 ÷ 100</strong><small>每人0.6%</small></div></div>
    </div>
  </div>;
}

function ProfitFlow() {
  return <div className="sp-scene sp-profit scene-safe"><Title note="股东分享成果，也承担经营失败的风险">股份怎样和经营结果连起来？</Title>
    <div className="sp-profit-machine">
      <div className="sp-sales"><Cup /><strong>卖出奶茶</strong><span>顾客付的钱进入公司</span></div>
      <div className="sp-pipe sp-pipe-one"><i /></div>
      <div className="sp-cost-filter"><strong>减去成本</strong><div><i>房租</i><i>工资</i><i>原料</i><i>税费</i></div></div>
      <div className="sp-pipe sp-pipe-two"><i /></div>
      <div className="sp-profit-tank"><span>剩下的才是</span><strong>利润</strong><div className="sp-profit-liquid" /></div>
      <div className="sp-profit-split"><div><b>留在公司</b><span>开新店 · 买设备</span></div><div><b>分给股东</b><span>可能形成分红</span></div></div>
    </div>
  </div>;
}

function NotLottery() {
  return <div className="sp-scene sp-not-lottery scene-safe"><Title note="一次开奖，和一家公司每天经营，是两种完全不同的故事">股票不是彩票</Title>
    <div className="sp-compare">
      <div className="sp-lottery"><div className="sp-ticket"><i /><strong>?</strong><span>一次结果</span></div><h2>盯着明天涨不涨</h2><p>运气决定一张票的结局</p></div>
      <div className="sp-business"><div className="sp-mini-store"><div className="sp-open-sign" /><Cup small /><div className="sp-customer-line"><i /><i /><i /></div></div><h2>研究公司怎样经营</h2><p>顾客 · 产品 · 成本 · 分店 · 风险</p></div>
      <div className="sp-compare-divider"><span>≠</span></div>
    </div>
  </div>;
}

function Detective() {
  const clues = [["钱", "靠什么赚钱？"], ["客", "顾客为何复购？"], ["久", "五年后还在吗？"], ["险", "最大的风险？"]];
  return <div className="sp-scene sp-detective scene-safe"><Title note="好产品不一定等于好公司，好公司也不等于任何价格都值得买">把“我喜欢”升级成证据</Title>
    <div className="sp-case-board"><div className="sp-magnifier"><div /><span>证</span><b>四张证据</b></div>{clues.map((clue, index) => <div className={`sp-clue sp-clue-${index + 1}`} style={{ "--clue": index } as CSSProperties} key={clue[1]}><i>{clue[0]}</i><strong>{clue[1]}</strong></div>)}<svg viewBox="0 0 1200 520"><path d="M600 260 L180 120 M600 260 L1020 120 M600 260 L180 420 M600 260 L1020 420" /></svg></div>
  </div>;
}

function FourGates() {
  const gates = [["1", "品牌", "我认识它"], ["2", "公司", "背后是谁经营"], ["3", "上市", "能否公开买到"], ["4", "价格", "现在是否合理"]];
  return <div className="sp-scene sp-four-gates scene-safe"><Title note="熟悉的品牌，不一定有公开交易的股票">研究顺序不能跳关</Title>
    <div className="sp-gate-road"><div className="sp-road-progress" />{gates.map((gate, index) => <div className="sp-gate" style={{ "--gate": index } as CSSProperties} key={gate[1]}><i>{gate[0]}</i><strong>{gate[1]}</strong><span>{gate[2]}</span></div>)}<div className="sp-private-note"><b>LEGO Group</b><span>私人持有 · 非上市</span><em>知名 ≠ 一定能买</em></div></div>
  </div>;
}

function LifeExample() {
  return <div className="sp-scene sp-life scene-safe"><Title note="熟悉产品给线索，比较生意才形成判断">小屿的两张公司研究卡</Title>
    <div className="sp-research-table">
      <div className="sp-research-card sp-game-card"><div className="sp-card-illustration"><div className="sp-controller"><i /><i /></div><span>最近很火</span></div><h2>喜欢的游戏公司</h2><ul><li><b>产品</b>一款热门游戏</li><li><b>复购</b>玩家持续充值</li><li><b>风险</b>收入太依赖单一爆款</li></ul></div>
      <div className="sp-evidence-scale"><div className="sp-scale-beam" /><div className="sp-scale-stand" /><strong>证据<br />比喜好更重</strong></div>
      <div className="sp-research-card sp-food-card"><div className="sp-card-illustration"><div className="sp-breakfast"><i /><i /><i /></div><span>反复购买</span></div><h2>早餐食品公司</h2><ul><li><b>产品</b>家庭日常食品</li><li><b>复购</b>很多顾客每周购买</li><li><b>风险</b>竞争激烈、成本变化</li></ul></div>
    </div>
  </div>;
}

function Game() {
  return <div className="sp-scene sp-final scene-safe"><div className="sp-game-table"><div className="sp-game-heading"><h1>拼出一家公司</h1><p>街角股东大会现在开始</p></div><div className="sp-game-tasks"><button data-no-advance><i>1</i><strong>分股份</strong><span>老板40块 · 投资人60块</span></button><button data-no-advance><i>2</i><strong>辨所有权</strong><span>股票，还是彩票想法？</span></button><button data-no-advance><i>3</i><strong>做研究卡</strong><span>产品 · 复购 · 五年 · 风险</span></button></div><div className="sp-game-puzzle">{Array.from({ length: 12 }, (_, i) => <i style={{ "--piece": i } as CSSProperties} key={i} />)}<strong>开始闯关</strong></div><p className="sp-final-line">知识已经拿到了，现在去闯关吧。</p></div></div>;
}

export default function StockPuzzle({ step }: ChapterStepProps) {
  if (step === 0) return <Hook />;
  if (step === 1) return <Secrets />;
  if (step === 2) return <Funding />;
  if (step === 3) return <ShareMath />;
  if (step === 4) return <ProfitFlow />;
  if (step === 5) return <NotLottery />;
  if (step === 6) return <Detective />;
  if (step === 7) return <FourGates />;
  if (step === 8) return <LifeExample />;
  return <Game />;
}
