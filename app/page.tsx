import { XiangqiGame } from "../components/xiangqi/XiangqiGame";

const boardSpecs = [
  ["棋盘拓扑", "9 纵 × 10 横"],
  ["核心结构", "双九宫 · 楚河汉界"],
  ["标准阵容", "32 子 · 红方先行"],
  ["规则模式", "popular-v1 · 本机双人"],
];

const designNotes = [
  {
    index: "01",
    title: "规则先正确",
    copy: "九道纵线、十道横线、两座九宫、河界断线，以及兵炮位标均按中国象棋棋盘结构构建。",
  },
  {
    index: "02",
    title: "一方秦俑沙盘",
    copy: "烧土棋台、黑漆线格、青绿河界与微缩秦代营垒共同构成桌面沙盘，让 Q 版秦俑成为视觉主角。",
  },
  {
    index: "03",
    title: "规则驱动表现",
    copy: "选择、合法落点、走子、吃子、将军和终局全部由纯规则状态驱动，三维场景只负责表现，不会自行改写局面。",
  },
];

export default function Home() {
  return (
    <main className="board-page">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="兵临九宫首页">
          <span className="brand-seal">帅</span>
          <span>
            <strong>兵临九宫</strong>
            <small>3D 中国象棋 · 本机双人</small>
          </span>
        </a>
        <span className="phase-badge">可玩棋局 · POPULAR V1</span>
      </header>

      <section className="board-intro" id="top">
        <div className="board-title">
          <p className="eyebrow">QIN TERRACOTTA DIORAMA · 秦俑沙盘</p>
          <h1>俑已列阵，<br />请执一手。</h1>
        </div>
        <div className="board-summary">
          <p className="lede">
            Q 版秦俑沙盘现已接入完整的本机双人规则：32 枚棋子按标准阵型列阵，红方先行，
            可选择合法落点、吃子、悔棋、认输并自动恢复本地存档。七类角色均已重构为可编辑、
            带骨骼与七套动作的秦兵马俑；烧土陶色为主体，以风化朱砂和铜绿军印区分双方，
            黑漆与旧铜细节收住界面层级。
          </p>
          <p className="interaction-hint">拖动旋转 · 滚轮缩放 · 右键平移</p>
        </div>
      </section>

      <section className="board-stage" aria-labelledby="board-stage-title">
        <h2 className="sr-only" id="board-stage-title">Q 版秦俑沙盘 3D 中国象棋棋盘</h2>
        <XiangqiGame />
      </section>

      <dl className="board-specs" aria-label="棋盘规格">
        {boardSpecs.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <section className="board-notes" aria-labelledby="design-notes-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DIORAMA DESIGN · 沙盘设计</p>
            <h2 id="design-notes-title">棋盘是一方土，<br />也是两军阵前。</h2>
          </div>
          <p>QIN DIORAMA · V1</p>
        </div>
        <div className="note-grid">
          {designNotes.map((note) => (
            <article key={note.index}>
              <span>{note.index}</span>
              <h3>{note.title}</h3>
              <p>{note.copy}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
