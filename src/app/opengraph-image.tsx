import { ImageResponse } from "next/og";

export const alt =
  "Freaking Grammar — tap the right word, win the daily pot";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Static share-card: the puzzle doesn't change between renders so we can
// cache aggressively.
export const revalidate = 3600;

// Mirrors the in-game layout (two colored halves with the options on each side
// and the phrase floating on top) so people who've never played can see what
// the game *is* at a glance instead of a generic pot number.
export default function OpenGraphImage() {
  const optionStyle = {
    fontSize: 170,
    fontWeight: 800 as const,
    color: "white",
    letterSpacing: "0.02em",
    display: "flex",
    opacity: 0.92,
  };

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "row",
          fontFamily: "sans-serif",
        }}
      >
        {/* Canonical palette 1 from the game: teal + purple. Matches what the
            player actually sees in a round. */}
        <div style={{ flex: 1, background: "#68c3a0" }} />
        <div style={{ flex: 1, background: "#a772b0" }} />

        <div
          style={{
            position: "absolute",
            top: 40,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontSize: 28,
              letterSpacing: "0.35em",
              textTransform: "uppercase",
              fontWeight: 800,
              color: "white",
              display: "flex",
            }}
          >
            Freaking Grammar
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            top: 110,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "white",
              color: "#1f2937",
              borderRadius: 36,
              padding: "32px 64px",
              boxShadow: "0 10px 0 rgba(0,0,0,0.18)",
              // flex-end aligns the blank line to the text baseline the same
              // way the in-game phrase card does, instead of centering a
              // floating bar.
              display: "flex",
              alignItems: "flex-end",
              gap: 22,
              fontSize: 72,
              fontWeight: 800,
              whiteSpace: "nowrap",
              lineHeight: 1,
            }}
          >
            <span style={{ display: "flex" }}>Winner</span>
            <div
              style={{
                width: 180,
                height: 6,
                background: "#2e2e34",
                borderRadius: 2,
                marginBottom: 10,
                display: "flex",
              }}
            />
            <span style={{ display: "flex" }}>all.</span>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            top: 300,
            left: 0,
            width: "50%",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <span style={optionStyle}>TAKE</span>
        </div>
        <div
          style={{
            position: "absolute",
            top: 300,
            right: 0,
            width: "50%",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <span style={optionStyle}>TAKES</span>
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 44,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 22,
              fontSize: 28,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              fontWeight: 800,
              color: "white",
            }}
          >
            <span style={{ display: "flex" }}>Daily pot</span>
            <span style={{ display: "flex", opacity: 0.55 }}>·</span>
            <span style={{ display: "flex" }}>Play free</span>
            <span style={{ display: "flex", opacity: 0.55 }}>·</span>
            <span style={{ display: "flex" }}>Winner takes all</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
