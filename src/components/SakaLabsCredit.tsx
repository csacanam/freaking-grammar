// "A Saka Labs product" credit, used in the top-right of every page header.
export function SakaLabsCredit() {
  return (
    <span className="text-xs font-display tracking-widest uppercase text-muted whitespace-nowrap">
      A{" "}
      <a
        href="https://sakalabs.io"
        target="_blank"
        rel="noreferrer"
        className="text-teal underline underline-offset-2 hover:text-ink"
      >
        Saka Labs
      </a>{" "}
      product
    </span>
  );
}
