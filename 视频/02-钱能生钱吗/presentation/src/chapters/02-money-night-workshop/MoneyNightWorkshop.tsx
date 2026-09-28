import type { CSSProperties, ReactNode } from "react";
import type { ChapterStepProps } from "../../registry/types";
import "./MoneyNightWorkshop.css";

function Coin({ worker = false, sleeping = false, small = false }: { worker?: boolean; sleeping?: boolean; small?: boolean }) {
  return (
    <div className={`mnw-coin ${worker ? "mnw-coin-worker" : ""} ${sleeping ? "mnw-coin-sleep" : ""} ${small ? "mnw-coin-small" : ""}`}>
      <div className="mnw-coin-rim" />
      <span>100</span>
      {worker && <div className="mnw-hardhat" />}
      {sleeping && <div className="mnw-nightcap" />}
    </div>
  );
}

function SceneTitle({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="mnw-title-group">
      <h1>{children}</h1>
      {note && <p>{note}</p>}
    </div>
  );
}

function HookScene() {
  return (
    <div className="mnw-scene mnw-hook scene-safe">
      <div className="mnw-keyart">
        <img src="/assets/money-night-workshop-keyart.png" alt="小屿和两枚走向不同道路的金币" />
        <div className="mnw-keyart-shade" />
        <div className="mnw-hook-copy">
          <span className="mnw-hook-kicker">同样的 100 元</span>
          <h1>一张睡觉<br />一张上夜班</h1>
          <div className="mnw-hook-question">一年后，谁更有用？</div>
        </div>
      </div>
    </div>
  );
}

function SecretScene() {
  return (
    <div className="mnw-scene mnw-secret scene-safe">
      <SceneTitle note="三把钥匙，打开同一座工坊">今晚要破解什么？</SceneTitle>
      <div className="mnw-keyring">
        <div className="mnw-key mnw-key-interest"><span>01</span><strong>利息</strong><small>钱的工作报酬</small></div>
        <div className="mnw-key mnw-key-power"><span>02</span><strong>购买力</strong><small>100元到底能买多少</small></div>
        <div className="mnw-key mnw-key-risk"><span>03</span><strong>风险</strong><small>更多，不等于一定更多</small></div>
      </div>
    </div>
  );
}

function BankFlowScene() {
  return (
    <div className="mnw-scene mnw-bank-flow scene-safe">
      <SceneTitle note="不是复制钱，而是提供保管与借贷服务">利息从哪里来？</SceneTitle>
      <div className="mnw-flow-map">
        <div className="mnw-flow-node mnw-depositor">
          <div className="mnw-person"><span /></div>
          <strong>储户</strong><small>把资金存入银行</small>
        </div>
        <div className="mnw-flow-line mnw-line-a"><i /></div>
        <div className="mnw-bank-building">
          <div className="mnw-bank-roof" /><div className="mnw-bank-columns"><i /><i /><i /></div>
          <strong>银行</strong><small>保管 · 借贷 · 服务</small>
        </div>
        <div className="mnw-flow-line mnw-line-b"><i /></div>
        <div className="mnw-flow-node mnw-borrower">
          <div className="mnw-shop"><span /></div>
          <strong>借款人</strong><small>按约定支付利息</small>
        </div>
        <div className="mnw-return-line"><i /><b>一小部分利息回到储户</b></div>
      </div>
    </div>
  );
}

function InterestScene() {
  return (
    <div className="mnw-scene mnw-interest scene-safe">
      <SceneTitle note="每100元存满一年，先看清利率和期限">利息，像鹅带回来的蛋</SceneTitle>
      <div className="mnw-interest-stage">
        <div className="mnw-goose"><div className="mnw-goose-body" /><div className="mnw-goose-neck" /><div className="mnw-goose-head" /><div className="mnw-goose-beak" /></div>
        <div className="mnw-eggs"><i /><i /><i /></div>
        <div className="mnw-rate-board">
          <div><span>1%</span><b>100 → 101</b><small>利息 1 元</small></div>
          <div><span>3%</span><b>100 → 103</b><small>利息 3 元</small></div>
        </div>
      </div>
    </div>
  );
}

function InflationScene() {
  return (
    <div className="mnw-scene mnw-inflation scene-safe">
      <SceneTitle note="面值没有变，能换到的东西却可能减少">100 元没变，购买力变淡了</SceneTitle>
      <div className="mnw-dilution-lab">
        <div className="mnw-glass">
          <div className="mnw-juice"><span className="mnw-water-layer" /></div>
          <div className="mnw-drop mnw-drop-a" /><div className="mnw-drop mnw-drop-b" /><div className="mnw-drop mnw-drop-c" />
        </div>
        <div className="mnw-power-meter">
          <div className="mnw-meter-row"><span>面值</span><div><i className="mnw-full" /></div><b>100</b></div>
          <div className="mnw-meter-row"><span>购买力</span><div><i className="mnw-shrinking" /></div><b>变弱</b></div>
          <p>钱的力量，不只看数字<br />还要看它能完成多少任务</p>
        </div>
      </div>
    </div>
  );
}

function IceCreamScene() {
  const years = [["今年", "5.00"], ["第1年", "5.15"], ["第2年", "5.30"], ["第10年", "6.72"]];
  return (
    <div className="mnw-scene mnw-icecream scene-safe">
      <SceneTitle note="假设每年涨价3%">同一支冰淇淋，价格在走路</SceneTitle>
      <div className="mnw-price-stage">
        <div className="mnw-icecream-art"><div className="mnw-scoop" /><div className="mnw-cone" /></div>
        <div className="mnw-price-rail">
          <div className="mnw-price-progress" />
          {years.map(([year, price], index) => (
            <div className="mnw-price-stop" key={year} style={{ "--stop": index } as CSSProperties}>
              <i /><small>{year}</small><strong>¥{price}</strong>
            </div>
          ))}
          <Coin small />
        </div>
        <div className="mnw-buying-power"><b>10元</b><span>今天能买 2 支</span><span>十年后买不到 2 支</span></div>
      </div>
    </div>
  );
}

function SavingsInvestmentScene() {
  return (
    <div className="mnw-scene mnw-two-belts scene-safe">
      <SceneTitle note="先匹配目标，再选择道路">储蓄和投资，不是同一条传送带</SceneTitle>
      <div className="mnw-belt-grid">
        <div className="mnw-belt-card mnw-saving-belt">
          <div className="mnw-belt-heading"><strong>储蓄</strong><span>近期要用 · 规则清楚</span></div>
          <div className="mnw-conveyor"><div className="mnw-conveyor-track" /><Coin small /><div className="mnw-small-gain">+ 少量利息</div></div>
          <p>回报通常不高，但更适合不能轻易损失的钱</p>
        </div>
        <div className="mnw-belt-card mnw-invest-belt">
          <div className="mnw-belt-heading"><strong>投资</strong><span>长期增长 · 承担风险</span></div>
          <div className="mnw-risk-track"><Coin small worker /><div className="mnw-uphill" /><div className="mnw-pit" /><div className="mnw-goal-flag" /></div>
          <p>目标是争取更多，不是保证更多</p>
        </div>
      </div>
    </div>
  );
}

function JobsScene() {
  const jobs = [
    { cls: "stock", title: "股票", desc: "拥有公司的一小部分", glyph: "企" },
    { cls: "fund", title: "基金", desc: "持有一篮子资产", glyph: "篮" },
    { cls: "bond", title: "债券", desc: "借出资金，等待还本", glyph: "借" },
    { cls: "value", title: "价值投资", desc: "理解公司 · 比较价格 · 耐心", glyph: "研" },
  ];
  return (
    <div className="mnw-scene mnw-jobs scene-safe">
      <SceneTitle note="不同岗位，对应不同权利、规则和风险">钱可以去哪些岗位？</SceneTitle>
      <div className="mnw-job-hub">
        <div className="mnw-hub-core"><Coin worker /><span>选择前先理解</span></div>
        {jobs.map((job, index) => (
          <div className={`mnw-job mnw-job-${job.cls}`} style={{ "--job": index } as CSSProperties} key={job.title}>
            <i>{job.glyph}</i><strong>{job.title}</strong><small>{job.desc}</small>
          </div>
        ))}
        <svg viewBox="0 0 1000 560" aria-hidden="true"><path d="M500 280 L180 115 M500 280 L820 115 M500 280 L180 445 M500 280 L820 445" /></svg>
      </div>
    </div>
  );
}

function CalculatorScene() {
  return (
    <div className="mnw-scene mnw-calculator scene-safe">
      <SceneTitle note="先算利息，再加回本金">工坊计算台</SceneTitle>
      <div className="mnw-calc-machine">
        <div className="mnw-formula-strip"><span>利息</span><b>=</b><strong>本金</strong><b>×</b><strong>利率</strong></div>
        <div className="mnw-calc-display">
          <div className="mnw-calc-row"><span>100 × 2%</span><i><em>2</em><small>元利息</small></i><b>期末 102 元</b></div>
          <div className="mnw-calc-row"><span>100 × 5%</span><i><em>5</em><small>元利息</small></i><b>期末 105 元</b></div>
        </div>
        <div className="mnw-compound-compare">
          <div><small>每年只按原本金</small><strong>1080</strong><span>单利</span></div>
          <div className="mnw-more"><small>利息也加入本金</small><strong>1081.6</strong><span>复利 · 多 1.6 元</span></div>
        </div>
        <div className="mnw-gears"><i /><i /><i /></div>
      </div>
    </div>
  );
}

function MonthlyScene() {
  const months = Array.from({ length: 12 }, (_, index) => index + 1);
  return (
    <div className="mnw-scene mnw-monthly scene-safe">
      <SceneTitle note="会套公式只是第一步，看懂条件才是真本领">每月50元，一年发生了什么？</SceneTitle>
      <div className="mnw-month-stage">
        <div className="mnw-envelope-line">
          {months.map((month) => <div className="mnw-envelope" key={month} style={{ "--month": month } as CSSProperties}><i>¥50</i><span>{month}月</span></div>)}
        </div>
        <div className="mnw-month-summary">
          <div className="mnw-assumption"><small>公式练习的假设</small><strong>600 × 5% = 30</strong><span>整笔600元存满一年 → 期末630元</span></div>
          <div className="mnw-reality"><small>真实的逐月存入</small><div className="mnw-duration-bars"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><span>每笔钱“上班”的时间不同，要看实际计息规则</span></div>
        </div>
      </div>
    </div>
  );
}

function GameScene() {
  return (
    <div className="mnw-scene mnw-final scene-safe">
      <div className="mnw-game-gate">
        <div className="mnw-game-title"><h1>唤醒 100 元</h1><p>三关任务已经亮灯</p></div>
        <div className="mnw-missions">
          <button data-no-advance><i>1</i><strong>选择去向</strong><span>存钱罐 · 银行 · 投资体验</span></button>
          <button data-no-advance><i>2</i><strong>算出利息</strong><span>100元 × 2% / 5%</span></button>
          <button data-no-advance><i>3</i><strong>判断购买力</strong><span>冰淇淋从5元涨到6元</span></button>
        </div>
        <div className="mnw-start-portal" data-no-advance><Coin worker /><span>先看时间，再看风险，最后做选择</span><strong>开始闯关</strong></div>
        <p className="mnw-final-line">知识已经拿到了，现在去闯关吧。</p>
      </div>
    </div>
  );
}

export default function MoneyNightWorkshop({ step }: ChapterStepProps) {
  if (step === 0) return <HookScene />;
  if (step === 1) return <SecretScene />;
  if (step === 2) return <BankFlowScene />;
  if (step === 3) return <InterestScene />;
  if (step === 4) return <InflationScene />;
  if (step === 5) return <IceCreamScene />;
  if (step === 6) return <SavingsInvestmentScene />;
  if (step === 7) return <JobsScene />;
  if (step === 8) return <CalculatorScene />;
  if (step === 9) return <MonthlyScene />;
  return <GameScene />;
}
