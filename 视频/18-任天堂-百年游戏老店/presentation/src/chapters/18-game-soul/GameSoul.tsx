import type { ReactNode } from "react";
import type { ChapterStepProps } from "../../registry/types";
import "./GameSoul.css";

const Title = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <h1 className={`gs-title ${className}`}>{children}</h1>
);

const Eyebrow = ({ children }: { children: ReactNode }) => (
  <div className="gs-eyebrow"><i />{children}</div>
);

const PaperLeaves = ({ count = 9 }: { count?: number }) => (
  <div className="gs-paper-leaves" aria-hidden="true">
    {Array.from({ length: count }, (_, index) => <i key={index} />)}
  </div>
);

export function GameSoul({ step }: ChapterStepProps) {
  if (step === 0) {
    return (
      <div className="scene gs-scene gs-cover">
        <img className="gs-bg gs-cover-art" src="/assets/ch18-century-portal-redesign.png" alt="" />
        <div className="gs-cover-wash" />
        <div className="gs-cover-copy">
          <Eyebrow>第18章 · 百年游戏老店</Eyebrow>
          <Title>一家纸牌店<br />怎么活过一百多年？</Title>
          <p>它换过无数工具，却没有换掉让人快乐的“魂”。</p>
        </div>
        <div className="gs-cover-seal"><span>1889</span><b>至今</b></div>
        <PaperLeaves count={12} />
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="scene gs-scene gs-secret">
        <div className="gs-safe gs-secret-layout">
          <div className="gs-secret-copy">
            <Eyebrow>今天要破解的秘密</Eyebrow>
            <Title>风口一直变<br />长期赢家守住什么？</Title>
            <p>工具可以转向，能力圈与快乐体验不能漂走。</p>
          </div>
          <div className="gs-compass-stage" aria-label="快乐体验是稳定方向">
            <div className="gs-wind-word w1">性能</div>
            <div className="gs-wind-word w2">手游</div>
            <div className="gs-wind-word w3">新设备</div>
            <div className="gs-wind-word w4">热度</div>
            <div className="gs-compass-disc">
              <div className="gs-compass-needle" />
              <strong>快乐体验</strong>
              <small>稳定的方向</small>
            </div>
          </div>
        </div>
        <PaperLeaves count={10} />
      </div>
    );
  }

  if (step === 2) {
    const eras = [
      { year: "1889", label: "花札纸牌", icon: "cards" },
      { year: "漫长试错", label: "换过许多工具", icon: "detour" },
      { year: "1970s", label: "进入电子游戏", icon: "arcade" },
      { year: "今天", label: "让人再玩一次", icon: "play" },
    ];
    return (
      <div className="scene gs-scene gs-history">
        <img className="gs-bg gs-history-art" src="/assets/ch18-century-portal-redesign.png" alt="" />
        <div className="gs-history-wash" />
        <div className="gs-safe gs-history-layout">
          <div className="gs-history-head">
            <Eyebrow>换工具，不换核心</Eyebrow>
            <Title>从纸牌小店，到电子游戏世界</Title>
          </div>
          <div className="gs-history-ribbon">
            {eras.map((era, index) => (
              <div className={`gs-era era-${index}`} key={era.year}>
                <div className={`gs-era-icon ${era.icon}`}><i /><i /><i /></div>
                <b>{era.year}</b>
                <span>{era.label}</span>
              </div>
            ))}
          </div>
          <p className="gs-history-answer">真正没变的是：设计规则，让人愿意一起玩，再玩一次。</p>
        </div>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="scene gs-scene gs-memory">
        <img className="gs-bg gs-memory-art" src="/assets/ch18-play-world-redesign.png" alt="" />
        <div className="gs-memory-wash" />
        <div className="gs-safe gs-memory-layout">
          <div className="gs-memory-copy">
            <Eyebrow>IP为什么会越来越值钱？</Eyebrow>
            <Title>角色，是记忆的开关</Title>
            <div className="gs-big-stat"><strong>8亿+</strong><span>相关系列累计销量</span></div>
            <p>玩家记住的不只是通关，而是和家人朋友一起玩的感受。</p>
          </div>
          <div className="gs-memory-notes">
            <span>孩子</span><i />
            <span>长大</span><i />
            <span>把快乐交给下一代</span>
          </div>
        </div>
        <PaperLeaves count={8} />
      </div>
    );
  }

  if (step === 4) {
    return (
      <div className="scene gs-scene gs-polish">
        <div className="gs-safe gs-polish-layout">
          <div className="gs-polish-copy">
            <Eyebrow>信任是怎么打磨出来的？</Eyebrow>
            <Title>宁可慢一点<br />也不随便交差</Title>
            <p>熟悉的角色再次出现，应该带来真正的新玩法。</p>
          </div>
          <div className="gs-workbench">
            <div className="gs-worklight" />
            <div className="gs-game-block"><span>新玩法</span><i className="gs-groove g1" /><i className="gs-groove g2" /></div>
            <div className="gs-polisher"><i /></div>
            <div className="gs-shavings">{Array.from({ length: 11 }, (_, index) => <i key={index} />)}</div>
            <div className="gs-craft-note n1">反复测试</div>
            <div className="gs-craft-note n2">删掉无聊</div>
            <div className="gs-craft-note n3">留下惊喜</div>
          </div>
          <div className="gs-trust-line"><span>一次热度</span><i /><strong>下一次体验的期待</strong></div>
        </div>
      </div>
    );
  }

  if (step === 5) {
    const islands = ["全家体感", "随身带走", "拆开分享"];
    return (
      <div className="scene gs-scene gs-direction">
        <div className="gs-safe gs-direction-layout">
          <div className="gs-direction-copy">
            <Eyebrow>不跟着风口乱跑</Eyebrow>
            <Title>技术是工具<br /><em>好玩才是方向</em></Title>
            <p>每次选择，都先回答同一个问题：它会不会让游戏更好玩？</p>
          </div>
          <div className="gs-play-land">
            <div className="gs-sun"><span>好玩</span></div>
            <svg className="gs-joy-path" viewBox="0 0 900 600" aria-hidden="true">
              <path d="M80 485 C210 380, 285 505, 410 390 S640 185, 815 230" />
            </svg>
            {islands.map((label, index) => <div className={`gs-island island-${index}`} key={label}><i /><span>{label}</span></div>)}
            <div className="gs-handheld"><i /><b /></div>
            <div className="gs-fads"><span>性能</span><span>手游</span><span>新设备</span></div>
          </div>
        </div>
      </div>
    );
  }

  if (step === 6) {
    return (
      <div className="scene gs-scene gs-rebuild">
        <div className="gs-safe gs-rebuild-layout">
          <div className="gs-rebuild-head">
            <Eyebrow>失败不是换掉灵魂的理由</Eyebrow>
            <Title>跌下去以后，回到能力圈重组</Title>
          </div>
          <div className="gs-ravine-scene">
            <div className="gs-left-cliff"><span>一次失败</span></div>
            <div className="gs-ravine-glow" />
            <div className="gs-fallen-piece">Wii U</div>
            <div className="gs-bridge-slabs">
              <span>便携</span><span>投屏</span><span>分享</span>
            </div>
            <div className="gs-right-cliff"><strong>重新出发</strong><small>熟悉的能力，新的组合</small></div>
            <div className="gs-traveler"><i /></div>
          </div>
          <p className="gs-rebuild-answer">没有慌乱换赛道，而是耐心修正错误。</p>
        </div>
      </div>
    );
  }

  if (step === 7) {
    return (
      <div className="scene gs-scene gs-life">
        <div className="gs-life-left">
          <div className="gs-life-copy">
            <Eyebrow>生活里的追风口</Eyebrow>
            <Title>热闹两天</Title>
            <p>画面很炫，内容很空，很快没人再提。</p>
          </div>
          <div className="gs-hype-device" aria-hidden="true"><i /><b>炫</b><span /></div>
          <div className="gs-firework">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</div>
          <div className="gs-week">第1周<i /><span>热度归零</span></div>
        </div>
        <div className="gs-life-right">
          <img className="gs-bg gs-life-art" src="/assets/ch18-play-world-redesign.png" alt="" />
          <div className="gs-life-shade" />
          <div className="gs-life-return">
            <span>一年后</span>
            <Title>还想再玩</Title>
            <p>每次聚会，全家都能加入。</p>
          </div>
        </div>
        <div className="gs-versus">VS</div>
      </div>
    );
  }

  if (step === 8) {
    const tests = [
      ["01", "记得", "角色多年后还被记得？"],
      ["02", "更新", "新作品有真正的新玩法？"],
      ["03", "守圈", "失败后回到能力圈改进？"],
    ];
    return (
      <div className="scene gs-scene gs-inspect">
        <div className="gs-safe gs-inspect-layout">
          <div className="gs-inspect-head">
            <Eyebrow>判断长期生命力</Eyebrow>
            <Title>把公司放进三束光里</Title>
          </div>
          <div className="gs-lenses">
            {tests.map(([number, verb, question], index) => (
              <div className={`gs-lens lens-${index}`} key={number}>
                <b>{number}</b><strong>{verb}</strong><span>{question}</span><i />
              </div>
            ))}
            <div className="gs-company-silhouette"><i /><span>长期公司</span></div>
          </div>
          <p className="gs-inspect-answer">画面最亮的不一定走得最远；让人念念不忘，才有长期生命力。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="scene gs-scene gs-final">
      <img className="gs-bg gs-final-art" src="/assets/ch18-play-world-redesign.png" alt="" />
      <div className="gs-final-wash" />
      <div className="gs-safe gs-final-layout">
        <div className="gs-final-copy">
          <Eyebrow>第18章 · 总结</Eyebrow>
          <Title>工具会变<br />好玩的魂不变</Title>
          <div className="gs-three-roots"><span>角色</span><span>玩法</span><span>玩家信任</span></div>
          <p>任天堂走过一百多年，不是一直做同一种产品，而是始终守住“让人快乐”的核心。</p>
          <strong className="gs-final-line">知识已经拿到了，现在去闯关吧。</strong>
        </div>
      </div>
      <PaperLeaves count={10} />
    </div>
  );
}
