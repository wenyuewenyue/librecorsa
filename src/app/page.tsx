import { TrackGate } from "@/components/TrackGate";
import { SITE_DESCRIPTION } from "@/lib/site";

export default function HomePage() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-[#07070c]">
      {/* Read by screen readers and search engines; the game itself draws to a canvas */}
      <h1 className="sr-only">WY赛车：浏览器里的免费开源赛车模拟器</h1>
      <p className="sr-only">{SITE_DESCRIPTION}</p>
      <TrackGate />
    </main>
  );
}
