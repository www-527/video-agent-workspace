import type { ChapterStepProps } from "../../registry/types";
import "./WaterSystem.css";

const H = ({ children }: { children: React.ReactNode }) => (
  <h1 className="ws-h">{children}</h1>
);

const Bottle = ({ small = false }: { small?: boolean }) => (
  <div className={`ws-bottle ${small ? "small" : ""}`}>
    <i />
    <div className="ws-water" />
    <b />
  </div>
);

const costStops = ["瓶盖标签", "运输仓储", "渠道货架", "广告品牌", "公司利润"];
const networkStops = ["山泉", "区域仓库", "学校与社区", "服务区与乡村", "随手可见的货架"];
const repeatStops = ["随手拿到", "喝完", "再次选择"];
const gateStops = ["安全信任", "门店同意", "运输补货", "首次尝试"];

export function WaterSystem({ step }: ChapterStepProps) {
  if (step === 0)
    return (
      <div className="scene ws-scene ws-cover">
        <img src="/assets/ch19-water-network.png" />
        <div className="ws-cover-wash" />
        <div className="ws-cover-copy">
          <H>
            两元一瓶
            <br />
            水却只值几分钱？
          </H>
          <p>剩下的钱，买到的是一整套系统。</p>
        </div>
        <div className="ws-coin">2元</div>
      </div>
    );

  if (step === 1)
    return (
      <div className="scene ws-scene scene-safe ws-secret">
        <div className="ws-drop">
          <div className="ws-gears">
            <i />
            <i />
            <i />
          </div>
        </div>
        <div>
          <span className="ws-label">今天破解</span>
          <H>
            品牌 × 渠道 × 成本
            <br />
            <em>一起咬合</em>
          </H>
        </div>
      </div>
    );

  if (step === 2)
    return (
      <div className="scene ws-scene scene-safe ws-cost-redesign">
        <div className="ws-cost-heading">
          <H>
            2元，不只买了<em>一口水</em>
          </H>
          <p>它要穿过五道真实的过程，才能稳稳出现在手边。</p>
        </div>
        <div className="ws-cost-journey">
          <div className="ws-cost-token hero-num">2元</div>
          <div className="ws-cost-stream" aria-label="两元钱经过五个环节">
            <svg viewBox="0 0 1160 360" aria-hidden="true">
              <path className="ws-cost-bank" d="M20 180 C170 40 270 315 420 180 S690 45 835 180 S1010 320 1140 180" />
              <path className="ws-cost-current" d="M20 180 C170 40 270 315 420 180 S690 45 835 180 S1010 320 1140 180" />
            </svg>
            <div className="ws-cost-stops">
              {costStops.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
          </div>
          <div className="ws-cost-bottle-wrap">
            <Bottle />
            <div className="ws-water-value">水本身 · 几分钱</div>
          </div>
        </div>
      </div>
    );

  if (step === 3)
    return (
      <div className="scene ws-scene scene-safe ws-brand">
        <div className="ws-mountain">
          <div className="ws-sun" />
          <div className="ws-peak p1" />
          <div className="ws-peak p2" />
          <div className="ws-lake" />
          <div className="ws-ripple">天然</div>
        </div>
        <div className="ws-brand-copy">
          <H>
            一句定位
            <br />
            把水源放进记忆
          </H>
          <blockquote>“我们只是大自然的搬运工”</blockquote>
          <p>雪山、湖泊、清澈水源，把“天然”变成可看见的信任。</p>
        </div>
      </div>
    );

  if (step === 4)
    return (
      <div className="scene ws-scene ws-network-redesign">
        <img src="/assets/ch19-redesign-distribution-journey.png" />
        <div className="ws-network-wash" />
        <div className="ws-network-title scene-safe">
          <H>
            二十多年，铺成一条<em>到你手边的路</em>
          </H>
        </div>
        <div className="ws-network-route scene-safe">
          <svg viewBox="0 0 1710 610" aria-hidden="true">
            <path d="M90 435 C310 380 370 470 555 390 S850 275 1040 330 S1330 465 1600 320" />
          </svg>
          <div className="ws-route-runner" />
          <div className="ws-network-stops">
            {networkStops.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </div>
        <p className="ws-network-conclusion">没有这条路，再好的水也只能留在仓库。</p>
      </div>
    );

  if (step === 5)
    return (
      <div className="scene ws-scene scene-safe ws-scale">
        <H>规模，把每一瓶变得更高效</H>
        <div className="ws-flywheel">
          <div className="ws-wheel-center">
            <Bottle small />
          </div>
          {['大批采购', '满载运输', '高效仓储', '更多铺货'].map((label, index) => (
            <div className={`ws-wheel-node wn${index}`} key={label}>{label}</div>
          ))}
          <div className="ws-wheel-ring" />
        </div>
        <div className="ws-scale-copy">
          <strong>品牌让人愿意拿</strong>
          <strong>渠道让人随手拿</strong>
          <strong>规模让成本更低</strong>
        </div>
      </div>
    );

  if (step === 6)
    return (
      <div className="scene ws-scene scene-safe ws-repeat-redesign">
        <div className="ws-repeat-title">
          <H>
            喝完，<em>又会再买</em>
          </H>
          <p>高频刚需，让一次选择变成一次又一次。</p>
        </div>
        <div className="ws-repeat-loop">
          <svg viewBox="0 0 1420 520" aria-hidden="true">
            <path className="ws-loop-shadow" d="M120 260 C260 40 570 35 710 260 C850 485 1160 480 1300 260 C1160 40 850 35 710 260 C570 485 260 480 120 260" />
            <path className="ws-loop-light" d="M120 260 C260 40 570 35 710 260 C850 485 1160 480 1300 260 C1160 40 850 35 710 260 C570 485 260 480 120 260" />
          </svg>
          <div className="ws-travel-bottle"><Bottle small /></div>
          <div className="ws-repeat-core">
            <strong>高频复购</strong>
            <span>简单，不等于容易</span>
          </div>
          <div className="ws-repeat-stops">
            {repeatStops.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </div>
        <p className="ws-repeat-conclusion">几百万个销售点 × 一次次复购，把普通两元水放大成大生意。</p>
      </div>
    );

  if (step === 7)
    return (
      <div className="scene ws-scene ws-life-redesign">
        <img src="/assets/ch19-redesign-shelf-choice.png" />
        <div className="ws-life-wash" />
        <div className="ws-life-copy scene-safe">
          <H>
            视线先到
            <br />
            <em>手才伸出</em>
          </H>
          <p>选择只用几秒，品牌与渠道却准备了很多年。</p>
        </div>
        <svg className="ws-gaze-path" viewBox="0 0 1920 1080" aria-hidden="true">
          <path d="M470 335 C760 275 1070 290 1390 350" />
          <circle cx="1390" cy="350" r="86" />
        </svg>
        <div className="ws-life-factors">
          <span>熟悉广告</span>
          <span>视线正中</span>
          <span>位置顺手</span>
          <span>规格与价格合适</span>
        </div>
      </div>
    );

  if (step === 8)
    return (
      <div className="scene ws-scene scene-safe ws-gates-redesign">
        <div className="ws-gates-title">
          <H>
            半价，只够走到<em>入口</em>
          </H>
          <p>真正抵达全国货架，还要依次穿过四道门。</p>
        </div>
        <div className="ws-gate-corridor">
          <div className="ws-half-ticket hero-num">
            <span>新品牌</span>
            1元
          </div>
          <div className="ws-floor-light" />
          <div className="ws-arches">
            {gateStops.map((label, index) => (
              <div className={`ws-arch a${index}`} key={label}>
                <i />
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="ws-destination">
            <div className="ws-destination-shelf">
              <Bottle small /><Bottle small /><Bottle small />
            </div>
            <strong>全国货架</strong>
          </div>
        </div>
        <p className="ws-gate-conclusion">低价是一个条件，不是魔法钥匙。</p>
      </div>
    );

  return (
    <div className="scene ws-scene scene-safe ws-final">
      <div className="ws-scan">
        <div className="ws-mini-shelf">
          {Array.from({ length: 30 }, (_, index) => <Bottle key={index} small />)}
        </div>
        <div className="ws-scanner" />
      </div>
      <div className="ws-final-copy">
        <H>
          卖水
          <br />
          卖的是整套系统
        </H>
        <p className="ws-summary">品牌定位、渠道网络、规模效率和持续复购，共同把普通商品变成难复制的护城河。</p>
        <strong>知识已经拿到了，现在去闯关吧。</strong>
      </div>
    </div>
  );
}
