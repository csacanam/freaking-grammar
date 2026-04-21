// Game routes hide the bottom tabs and cap to a phone-shaped frame so it doesn't
// look stretched on desktop / tablet. Anchored to the viewport with `fixed
// inset-0` so the absolute-positioned gameplay elements (phrase card at 23%,
// mascot at 50%, timer/score in the corners) always resolve against the full
// viewport height — the flex-1 chain from body→main→layout was collapsing in
// Chrome DevTools mobile emulation, leaving everything stuck at the top.
export default function GameLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 flex flex-col bg-black/5 z-30">
      <div className="flex-1 flex flex-col w-full max-w-md mx-auto bg-bg shadow-[0_0_40px_rgba(0,0,0,0.08)] relative overflow-hidden">
        {children}
      </div>
    </div>
  );
}
