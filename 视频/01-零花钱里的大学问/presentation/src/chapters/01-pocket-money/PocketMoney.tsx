import { useMemo, useState } from "react";
import type { ChapterStepProps } from "../../registry/types";
import "./PocketMoney.css";

const money = (count: number, accent = false) =>
  Array.from({ length: count }, (_, index) => (
    <span className={`coin ${accent ? "coin--accent" : ""}`} key={index}>¥</span>
  ));

export default function PocketMoney({ step }: ChapterStepProps) {
  const [gameChoice, setGameChoice] = useState<"need" | "want" | "save" | null>(null);
  const progress = useMemo(() => Math.round(((step + 1) / 9) * 100), [step]);

  return (
    <main className="lesson-shell" aria-label="第一章 零花钱里的大学问">
      <div className="lesson-grain" />
      <header className="lesson-header">
        <div className="chapter-mark"><span>01</span><b>零花钱里的大学问</b></div>
        <div className="lesson-progress"><i style={{ width: `${progress}%` }} /></div>
        <div className="step-count">{String(step + 1).padStart(2, "0")} / 09</div>
      </header>

      <section className={`lesson-scene lesson-scene-${step}`} key={step}>
        {step === 0 && (
          <div className="hook-grid">
            <div className="hook-copy">
              <div className="eyebrow">一个故事问题</div>
              <h1>同样的 <em>20元</em><br />为什么结局不同？</h1>
              <p>花掉它，还是让它为未来工作？</p>
              <div className="choice-row">
                <div className="choice-card choice-card--fast"><span>现在</span><b>全部花掉</b></div>
                <div className="versus">VS</div>
                <div className="choice-card choice-card--slow"><span>未来</span><b>留下一颗种子</b></div>
              </div>
            </div>
            <div className="hero-art"><div className="sun-orbit" /><img src="/assets/golden-goose-chalk.png" alt="会下金蛋的鹅" /></div>
          </div>
        )}

        {step === 1 && (
          <div className="secret-scene">
            <div className="eyebrow">今天要破解什么秘密</div>
            <h2>钱生钱的第一把钥匙</h2>
            <div className="secret-equation">
              <div className="secret-token"><span className="seed-icon">●</span><b>本金</b><small>能继续创造价值的钱</small></div>
              <div className="math-sign">+</div>
              <div className="secret-token"><span className="egg-icon">●</span><b>收益</b><small>本金带来的新收获</small></div>
              <div className="math-sign">+</div>
              <div className="secret-token"><span className="scale-icon">↔</span><b>分配</b><small>让现在与未来都满意</small></div>
            </div>
            <div className="chalk-arrow">保护本金 <span>→</span> 收获更多选择</div>
          </div>
        )}

        {step === 2 && (
          <div className="goose-story">
            <div className="story-visual"><img src="/assets/golden-goose-chalk.png" alt="金鹅与金蛋" /></div>
            <div className="story-copy">
              <div className="eyebrow">核心知识 · 金鹅的故事</div>
              <h2>别为了金蛋，<br />伤害会下蛋的鹅</h2>
              <div className="goose-map">
                <div><span className="map-goose">鹅</span><b>本金</b><small>持续创造价值</small></div>
                <i>每天带来</i>
                <div><span className="map-egg">蛋</span><b>收益</b><small>新增的收获</small></div>
              </div>
              <blockquote>聪明不是一次拿走最多，<br />而是让好事可以持续发生。</blockquote>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="needs-scene">
            <div className="eyebrow">核心知识 · 需要和想要</div>
            <h2>每次花钱前，先放进正确的篮子</h2>
            <div className="basket-grid">
              <div className="basket basket--need"><div className="basket-title"><span>必须</span><b>需要 NEED</b></div><ul><li>🍚 吃饭</li><li>✏️ 学习用品</li><li>🚌 必要交通</li></ul></div>
              <div className="basket basket--want"><div className="basket-title"><span>可以等等</span><b>想要 WANT</b></div><ul><li>🧸 新玩具</li><li>🧋 第二杯奶茶</li><li>✨ 跟风小饰品</li></ul></div>
            </div>
            <div className="question-strip"><b>买之前问：</b><span>真的会用吗？</span><span>一周后还想要吗？</span><span>不买会影响生活吗？</span></div>
          </div>
        )}

        {step === 4 && (
          <div className="marshmallow-scene">
            <div className="eyebrow">核心知识 · 延迟满足</div>
            <h2>现在 1 颗，还是等一等得到 2 颗？</h2>
            <div className="time-choice">
              <div className="now-card"><div className="mallow">1</div><b>马上吃</b><small>即时快乐</small></div>
              <div className="clock-face"><span>10</span><i /><b>暂停十秒</b></div>
              <div className="later-card"><div className="mallow-pair"><span>1</span><span>2</span></div><b>耐心等待</b><small>更多选择</small></div>
            </div>
            <p className="big-quote">等待不是委屈自己，<br /><strong>是用一点耐心，换明天更多选择。</strong></p>
          </div>
        )}

        {step === 5 && (
          <div className="split-scene">
            <div className="eyebrow">核心知识 · 20元分配法</div>
            <h2>先存后花，未来的你先领一份</h2>
            <div className="twenty-split">
              <div className="split-card save"><div className="split-number">10<small>元</small></div><b>储蓄</b><span>保护本金</span><div className="coins-row">{money(5, true)}</div></div>
              <div className="split-card spend"><div className="split-number">6<small>元</small></div><b>需要</b><span>必要开支</span><div className="coins-row">{money(3)}</div></div>
              <div className="split-card joy"><div className="split-number">4<small>元</small></div><b>快乐</b><span>认真选择</span><div className="coins-row">{money(2)}</div></div>
            </div>
            <div className="formula-line"><b>20元</b><span>=</span><em>10元未来</em><span>+</span><em>6元需要</em><span>+</span><em>4元快乐</em></div>
          </div>
        )}

        {step === 6 && (
          <div className="calendar-scene">
            <div className="eyebrow">核心知识 · 小坚持的力量</div>
            <div className="calendar-layout">
              <div className="week-stack">
                <div className="week-card"><span>每周</span><b>5元</b></div>
                <div className="times">×</div>
                <div className="week-card"><span>一年</span><b>52周</b></div>
              </div>
              <div className="equals-burst">=</div>
              <div className="total-pot"><span>一年后</span><b>260<small>元</small></b><div className="pot-coins">{money(9, true)}</div></div>
            </div>
            <div className="possibility-row"><span>📚 一套好书</span><span>🧭 一次体验</span><span>🌱 第一笔本金</span></div>
            <h2 className="bottom-message">大结果，来自许多次小小的坚持。</h2>
          </div>
        )}

        {step === 7 && (
          <div className="example-scene">
            <div className="eyebrow">一个生活例子</div>
            <h2>差别不在钱多钱少，而在先做分配</h2>
            <div className="kid-compare">
              <div className="kid-card kid-card--ming"><div className="avatar">明</div><h3>小明</h3><div className="money-track"><span>20元</span><i>→</i><span>零食</span><i>→</i><strong>0元</strong></div><p>月底遇到喜欢的书，只能放弃。</p></div>
              <div className="compare-divider"><b>同样<br />20元</b></div>
              <div className="kid-card kid-card--hong"><div className="avatar">红</div><h3>小红</h3><div className="money-track"><span>20元</span><i>→</i><span>先存10元</span><i>→</i><strong>买到书</strong></div><p>享受了当下，也保留了未来。</p></div>
            </div>
          </div>
        )}

        {step === 8 && (
          <div className="game-scene">
            <div className="game-badge">GAME 01</div>
            <h2>20元分配挑战</h2>
            <p>先热身：一支上课必须用的铅笔，应该放进哪个盒子？</p>
            <div className="game-item">✏️ <b>铅笔 · 2元</b></div>
            <div className="game-boxes" data-no-advance>
              {(["need", "want", "save"] as const).map((choice) => (
                <button className={gameChoice === choice ? "selected" : ""} key={choice} onClick={() => setGameChoice(choice)}>
                  <span>{choice === "need" ? "需要" : choice === "want" ? "想要" : "储蓄"}</span>
                  <small>{choice === "need" ? "影响正常生活" : choice === "want" ? "可以稍后再买" : "留给未来"}</small>
                </button>
              ))}
            </div>
            <div className={`game-feedback ${gameChoice ? "visible" : ""}`}>{gameChoice === "need" ? "判断正确！铅笔属于学习需要。" : gameChoice ? "再想想：没有它，会影响今天上课吗？" : "选择一个盒子"}</div>
            <div className="final-line">知识已经拿到了，现在去闯关吧。</div>
          </div>
        )}
      </section>
    </main>
  );
}
