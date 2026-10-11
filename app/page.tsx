import { XiangqiGameClient } from "./XiangqiGameClient";

export default function Home() {
  return (
    <main className="board-page" id="top">
      <section className="board-stage board-stage--fullscreen" aria-labelledby="board-stage-title">
        <h1 className="sr-only" id="board-stage-title">
          兵临九宫 · 秦俑主题 3D 中国象棋
        </h1>
        <XiangqiGameClient />
      </section>
    </main>
  );
}
