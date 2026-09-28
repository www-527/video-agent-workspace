import "./SafetyMargin.css";

const PriceScale = () => <div className="sm-scale">
  <div className="sm-value-band"><span>保守价值范围</span><strong>90—110</strong></div>
  <div className="sm-track"><i className="sm-fill" /></div>
  {[80, 100, 120].map((n, i) => <div className={`sm-pin sm-pin-${i}`} key={n}><b>{n}</b><span>{i === 0 ? "有缓冲" : i === 1 ? "无缓冲" : "付得更高"}</span></div>)}
</div>;

const SortingDesk = () => <div className="sm-sort-desk">
  <div className="sm-task-title">先完成价格分区</div>
  <div className="sm-price-chips"><b>80</b><b>100</b><b>120</b></div>
  <div className="sm-sort-zones">
    <div className="sm-zone-safe"><strong>有安全边际</strong><span>价格低于价值范围</span></div>
    <div className="sm-zone-watch"><strong>接近价值</strong><span>几乎没有犯错空间</span></div>
    <div className="sm-zone-stop"><strong>高于价值</strong><span>先停下，不追价</span></div>
  </div>
  <p>拖动三张价格牌，再说明理由。</p>
</div>;

const TaskBoard = () => <div className="sm-task-board sm-task-final">
  <div className="sm-brief-head"><span>CASE 06</span><div className="sm-task-title">折扣侦探任务单</div><i>待闯关</i></div>
  <div className="sm-missions">
    <div><b>01</b><strong>价格归位</strong><span>把 80 / 100 / 120 放进正确区域</span></div>
    <div><b>02</b><strong>寻找证据</strong><span>查明三件“半价商品”的降价原因</span></div>
    <div><b>03</b><strong>给出结论</strong><span>写出价值范围、证据和所需缓冲</span></div>
  </div>
  <p>知识已经拿到了，现在去闯关吧。</p>
</div>;

export function SafetyMargin({ step }: { step: number }) {
  if (step === 0) return <section className="sm-scene sm-hero">
    <img src="/assets/discount-detective-keyart.png" alt="少年侦探在商场检查两件同为五折但质量不同的外套" />
    <div className="sm-hero-copy"><h1>同样五折</h1><p>一个是宝藏，一个可能还是坑。</p></div>
    <div className="sm-receipts"><i /><i /><i /></div>
  </section>;

  if (step === 1) return <section className="sm-scene sm-secret">
    <div className="sm-stamp-row"><span>好东西</span><i>＋</i><span>价值证据</span><i>＋</i><span>更低价格</span></div>
    <h1>这层缓冲，叫安全边际</h1>
  </section>;

  if (step === 2) return <section className="sm-scene sm-price"><h2>价值不是一个神奇点</h2><PriceScale /><div className="sm-formula">（估计价值 − 支付价格）÷ 估计价值</div></section>;

  if (step === 3) return <section className="sm-scene sm-cushion">
    <h2>给错误留出落地空间</h2>
    <div className="sm-risk-rain"><div>估值偏差</div><div>经营意外</div><div>等待更久</div></div>
    <div className="sm-buffer"><span>支付价 80</span><strong>安全边际</strong><b>20 元缓冲</b></div>
    <p>风险先撞上缓冲，不直接撞上你的判断。</p>
  </section>;

  if (step === 4) return <section className="sm-scene sm-cheap">
    <div className="sm-cheap-card"><div className="sm-shoe">鞋底开胶</div><strong>200 → 80</strong><span>真实价值可能只有 50</span></div>
    <div className="sm-cut">≠</div>
    <div className="sm-cheap-card"><div className="sm-stock">公司受损</div><strong>120 → 60</strong><span>旧估值 100 可能降到 40</span></div>
    <h2>跌得多，不等于自动便宜</h2>
  </section>;

  if (step === 5) return <section className="sm-scene sm-seals">
    <div className="sm-paper"><h2>继续研究许可</h2><div className="sm-seal sm-seal-a">质量过关</div><div className="sm-seal sm-seal-b">价格留白</div><p>漏水的纸船再便宜，也不适合过河。</p></div>
  </section>;

  if (step === 6) return <section className="sm-scene sm-process">
    <h2>五步折扣侦查法</h2>
    <div className="sm-process-line">{["需要且懂", "查质量", "估价值范围", "查降价原因", "比较缓冲"].map((x, i) => <div style={{ "--i": i } as React.CSSProperties} key={x}><b>{i + 1}</b><span>{x}</span></div>)}</div>
    <p>没有把握时，等待也是一个完整决定。</p>
  </section>;

  if (step === 7) return <section className="sm-scene sm-example">
    <img src="/assets/backpack-investigation.png" alt="少年用放大镜比较结实背包和背带破损背包" />
    <div className="sm-evidence sm-evidence-a"><strong>A 包</strong><span>价格记录能对上</span><span>肩带与拉链结实</span><span>使用价值明确</span></div>
    <div className="sm-evidence sm-evidence-b"><strong>B 包</strong><span>“原价”缺少证据</span><span>背带容易断</span><span>折扣响，价值虚</span></div>
  </section>;

  if (step === 8) return <section className="sm-scene sm-game"><SortingDesk /></section>;

  return <section className="sm-scene sm-final"><TaskBoard /></section>;
}
