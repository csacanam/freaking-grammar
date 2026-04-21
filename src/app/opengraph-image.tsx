import { ImageResponse } from "next/og";

export const alt =
  "Freaking Grammar — tap the right word, win the daily pot";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Static share-card: the puzzle doesn't change between renders so we can
// cache aggressively. Bumped to 1h since the previous live-pot readout is
// gone — no need to hit the chain for this asset anymore.
export const revalidate = 3600;

// Mirrors the in-game layout (two colored halves with the options on each side
// and the phrase floating on top) so people who've never played can see what
// the game *is* at a glance instead of a generic pot number.
export default function OpenGraphImage() {
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
          color: "white",
        }}
      >
        <div
          style={{
            flex: 1,
            background: "#68c3a0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontSize: 180,
              fontWeight: 800,
              letterSpacing: "0.02em",
              display: "flex",
              opacity: 0.9,
            }}
          >
            TAKE
          </div>
        </div>
        <div
          style={{
            flex: 1,
            background: "#4a9e7f",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontSize: 180,
              fontWeight: 800,
              letterSpacing: "0.02em",
              display: "flex",
              opacity: 0.9,
            }}
          >
            TAKES
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            top: 38,
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
              display: "flex",
            }}
          >
            Freaking Grammar
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            top: 140,
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
              padding: "38px 72px",
              boxShadow: "0 10px 0 rgba(0,0,0,0.18)",
              display: "flex",
              alignItems: "center",
              gap: 24,
              fontSize: 76,
              fontWeight: 800,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ display: "flex" }}>Winner</span>
            <div
              style={{
                width: 200,
                height: 10,
                background: "#f8e45a",
                borderRadius: 5,
                display: "flex",
              }}
            />
            <span style={{ display: "flex" }}>all.</span>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 50,
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
              fontSize: 30,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              fontWeight: 800,
            }}
          >
            <span style={{ display: "flex" }}>Daily pot</span>
            <span style={{ display: "flex", opacity: 0.6 }}>·</span>
            <span style={{ display: "flex" }}>Play free</span>
            <span style={{ display: "flex", opacity: 0.6 }}>·</span>
            <span style={{ display: "flex" }}>Winner takes all</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
