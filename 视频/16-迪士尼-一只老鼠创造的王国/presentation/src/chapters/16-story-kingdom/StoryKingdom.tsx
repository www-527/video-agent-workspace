import type { ChapterStepProps } from "../../registry/types";
import "./StoryKingdom.css";

const branches = ["电影", "乐园", "周边", "流媒体", "授权"];
const moat = ["超级IP", "创造力", "规模体系"];
const taskBranches = ["故事", "活动", "玩具", "数字内容", "授权合作"];
const growthOutcomes = ["传播", "活动", "商品"];

function Title({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <h1 className={`sk-title ${small ? "sk-title--small" : ""}`}>{children}</h1>;
}

export function StoryKingdom({ step }: ChapterStepProps) {
  if (step === 0) return <div className="scene sk-scene sk-cover">
    <img className="sk-cover-img" src="/assets/ch16-story-kingdom.png" />
    <div className="sk-cover-shade" />
    <div className="sk-cover-copy"><Title>一颗故事种子<br />怎么长成一整个王国？</Title><div className="sk-question-line" /></div>
  </div>;

  if (step === 1) return <div className="scene sk-scene sk-secret">
    <img className="sk-secret-art" src="/assets/ch16-secret-story-tree.png" alt="一颗从发光种子长出五颗故事果实的树" />
    <div className="sk-secret-shade" />
    <div className="scene-safe sk-secret-safe">
      <div className="sk-secret-copy">
        <p className="sk-secret-kicker">今天破解</p>
        <Title small>一个受欢迎的 IP<br /><em>为什么能反复结果？</em></Title>
        <div className="sk-secret-root"><i /><span>根，是喜欢</span></div>
      </div>
    </div>
  </div>;

  if (step === 2) return <div className="scene sk-scene scene-safe sk-origin">
    <div className="sk-projector"><div className="sk-reel sk-r1" /><div className="sk-reel sk-r2" /><div className="sk-beam"><div className="sk-mouse-shadow"><i /><b /><span /></div></div></div>
    <div className="sk-origin-copy"><div className="hero-num">1928</div><Title small>一切始于<br />一只小老鼠</Title><p>黑白银幕里的角色，成为王国的第一颗种子。</p></div>
  </div>;

  if (step === 3) return <div className="scene sk-scene scene-safe sk-routes">
    <Title small>同一个角色，走出五条路</Title>
    <div className="sk-route-map"><div className="sk-character">IP</div>{branches.map((x, i) => <div className={`sk-route sk-route-${i + 1}`} key={x}><span>{x}</span><i /></div>)}</div>
    <p className="sk-route-note">电影票房 · 乐园门票 · 周边商品 · 会员观看 · 授权费</p>
  </div>;

  if (step === 4) return <div className="scene sk-scene scene-safe sk-flywheel">
    <Title small>故事会推动下一次故事</Title>
    <div className="sk-wheel"><div className="sk-wheel-core">IP</div>{["故事", "喜欢", "消费", "传播"].map((x, i) => <div className={`sk-wheel-node sk-wn${i + 1}`} key={x}>{x}</div>)}<div className="sk-wheel-orbit" /></div>
    <p>一次成功不是终点，它会把观众重新送回故事。</p>
  </div>;

  if (step === 5) return <div className="scene sk-scene scene-safe sk-moat">
    <Title small>三层护城河，守住故事王国</Title>
    <div className="sk-castle"><div className="sk-tower sk-tower-a" /><div className="sk-tower sk-tower-b" /><div className="sk-gate">故事</div>{moat.map((x, i) => <div className={`sk-moat-ring sk-mr${i + 1}`} key={x}><span>{x}</span></div>)}</div>
    <p>童年记忆难复制 · 会讲故事难复制 · 完整体系更难复制</p>
  </div>;

  if (step === 6) return <div className="scene sk-scene scene-safe sk-crisis">
    <div className="sk-crisis-castle"><div className="sk-cloud" /><div className="sk-dark-tower"><i /><i /><i /></div><div className="sk-root-light">根还在</div></div>
    <div className="sk-crisis-copy"><div className="hero-num">1984</div><Title small>王国熄灯<br />故事的根没有熄灭</Title><div className="sk-rebuild"><span>翻新乐园</span><span>重启动画</span><span>开发商店</span></div></div>
  </div>;

  if (step === 7) return <div className="scene sk-scene scene-safe sk-school">
    <Title small>生活例子：运动会的小狮子</Title>
    <div className="sk-lion-track"><div className="sk-lion"><i /><b /><span /></div>{["开幕短片", "胸章", "班服贴纸", "纪念册", "合影区"].map((x, i) => <div className={`sk-school-stop sk-ss${i + 1}`} key={x}>{x}</div>)}</div>
    <p>一张画有了性格和故事，就能走进更多场景。</p>
  </div>;

  if (step === 8) return <div className="scene sk-scene scene-safe sk-compare">
    <Title small>喜欢，才让故事继续生长</Title>
    <div className="sk-compare-grid">
      <section className="sk-compare-panel sk-compare-panel--alive">
        <div className="sk-growth-diagram">
          <div className="sk-growth-story">故事</div>
          <div className="sk-growth-line sk-growth-line--top" />
          <div className="sk-growth-heart">喜欢</div>
          <div className="sk-growth-line sk-growth-line--stem" />
          <div className="sk-growth-line sk-growth-line--bar" />
          {growthOutcomes.map((label, index) => <div className={`sk-growth-outcome sk-go${index + 1}`} key={label}>{label}</div>)}
        </div>
        <div className="sk-compare-caption"><strong>有人喜欢</strong><span>一个故事，长出更多场景</span></div>
      </section>
      <section className="sk-compare-panel sk-compare-panel--stock">
        <div className="sk-inventory" aria-label="十个整齐堆放的库存箱">
          <div className="sk-boxes">{Array.from({ length: 10 }, (_, i) => <i key={i} />)}</div>
          <div className="sk-inventory-count">× 10</div>
        </div>
        <div className="sk-compare-caption"><strong>没人喜欢</strong><span>十种商品，仍是十种库存</span></div>
      </section>
    </div>
  </div>;

  return <div className="scene sk-scene scene-safe sk-final">
    <div className="sk-task-tree">
      <svg className="sk-task-connectors" viewBox="0 0 860 780" aria-hidden="true">
        <path className="sk-task-trunk" d="M430 620 L430 100" />
        <path d="M430 166 C385 166 350 166 306 166" />
        <path d="M430 276 C475 276 510 276 554 276" />
        <path d="M430 386 C385 386 350 386 306 386" />
        <path d="M430 496 C475 496 510 496 554 496" />
        <path d="M430 606 C385 606 350 606 306 606" />
        {[166, 276, 386, 496, 606].map(y => <circle cx="430" cy={y} r="7" key={y} />)}
      </svg>
      <div className="sk-task-crown">五根价值树枝</div>
      {taskBranches.map((label, index) => <div className={`sk-task-branch sk-tb${index + 1}`} key={label}><span>{label}</span></div>)}
      <div className="sk-task-avatar">你的<br />角色</div>
      <div className="sk-task-root">为什么会被喜欢？</div>
    </div>
    <div className="sk-task-copy"><Title small>故事是种子，喜欢是根</Title><p className="sk-final-summary">迪士尼先创造让人喜欢的角色和故事，<br />再让这份喜欢走进更多场景。<br /><em>创造力，让价值不断生长。</em></p><strong>知识已经拿到了，现在去闯关吧。</strong></div>
  </div>;
}
