// Display helpers for Math equations, shared by the game screen and the
// game-over answer reveal. Client-safe on purpose: math-questions.ts pulls in
// node:crypto for the generator, so it can't be imported from a component.

// The server sends "x" / "/" because those are stable in JSON; both screens
// render them as proper math symbols. Takes a plain string (not the MathOp
// union) because the game-over screen reads the operator back out of a URL
// param, where it's unvalidated — an unknown value renders as-is.
export function opGlyph(op: string): string {
  switch (op) {
    case "-": return "−";
    case "x": return "×";
    case "/": return "÷";
    default: return op;
  }
}
