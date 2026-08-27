import { XiangqiGame } from "../components/xiangqi/XiangqiGame";

export default function Home() {
  return (
    <main className="board-page" id="top">
      <section className="board-stage board-stage--fullscreen" aria-labelledby="board-stage-title">
        <h1 className="sr-only" id="board-stage-title">兵临九宫 · 3D 中国象棋本机双人对局</h1>
        <XiangqiGame />
      </section>
    </main>
  );
}
