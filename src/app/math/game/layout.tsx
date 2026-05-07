// Same fixed-viewport frame as the Grammar game route — gameplay
// elements absolutely positioned, no scroll, capped to a phone width
// on desktop. See src/app/grammar/game/layout.tsx for the rationale
// behind the `fixed inset-0` outer wrapper.
export default function MathGameLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 flex flex-col bg-black/5 z-30">
      <div className="flex-1 flex flex-col w-full max-w-md mx-auto bg-bg shadow-[0_0_40px_rgba(0,0,0,0.08)] relative overflow-hidden">
        {children}
      </div>
    </div>
  );
}
