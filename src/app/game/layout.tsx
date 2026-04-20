// Game routes hide the bottom tabs and cap to a phone-shaped frame so it doesn't
// look stretched on desktop / tablet.
export default function GameLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col -mb-20 bg-black/5">
      <div className="flex-1 flex flex-col w-full max-w-md mx-auto bg-bg shadow-[0_0_40px_rgba(0,0,0,0.08)] relative overflow-hidden">
        {children}
      </div>
    </div>
  );
}
