import { ImageResponse } from "next/og";
import { isAddressEqual, zeroAddress } from "viem";
import { POT_ADDRESS } from "@/lib/wagmi";
import { celoClient, FREAKING_POT_ABI } from "@/lib/onchain";

export const alt = "Freaking Grammar — daily grammar pot";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Regenerate once a minute so the shown pot stays fresh without hammering
// the RPC for every share-card request.
export const revalidate = 60;

async function readPots(): Promise<{ en: number; es: number }> {
  if (isAddressEqual(POT_ADDRESS, zeroAddress)) return { en: 0, es: 0 };
  try {
    const days = (await Promise.all([
      celoClient.readContract({
        address: POT_ADDRESS,
        abi: FREAKING_POT_ABI,
        functionName: "currentDay",
        args: [1n],
      }),
      celoClient.readContract({
        address: POT_ADDRESS,
        abi: FREAKING_POT_ABI,
        functionName: "currentDay",
        args: [2n],
      }),
    ])) as [bigint, bigint];
    const pots = (await Promise.all([
      celoClient.readContract({
        address: POT_ADDRESS,
        abi: FREAKING_POT_ABI,
        functionName: "viewPot",
        args: [1n, days[0]],
      }),
      celoClient.readContract({
        address: POT_ADDRESS,
        abi: FREAKING_POT_ABI,
        functionName: "viewPot",
        args: [2n, days[1]],
      }),
    ])) as [bigint, bigint];
    return {
      en: Number(pots[0]) / 1_000_000,
      es: Number(pots[1]) / 1_000_000,
    };
  } catch {
    return { en: 0, es: 0 };
  }
}

export default async function OpenGraphImage() {
  const pots = await readPots();
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#68c3a0",
          color: "white",
          padding: "60px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 44,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          Freaking Grammar
        </div>

        <div
          style={{
            fontSize: 28,
            marginTop: 8,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            opacity: 0.85,
          }}
        >
          Today's pots
        </div>

        <div
          style={{
            display: "flex",
            gap: 40,
            marginTop: 60,
          }}
        >
          <PotCard code="EN" label="English" amount={fmt(pots.en)} />
          <PotCard code="ES" label="Español" amount={fmt(pots.es)} />
        </div>

        <div style={{ flex: 1 }} />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div
            style={{
              fontSize: 36,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            One winner per game
          </div>
          <div
            style={{
              fontSize: 22,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              opacity: 0.75,
            }}
          >
            Tap fast. Resets 00:00 UTC.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

function PotCard({
  code,
  label,
  amount,
}: {
  code: string;
  label: string;
  amount: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "rgba(255,255,255,0.18)",
        borderRadius: 32,
        padding: "36px 48px",
        minWidth: 440,
      }}
    >
      <div
        style={{
          fontSize: 32,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          opacity: 0.85,
          display: "flex",
        }}
      >
        {`${code} Pot`}
      </div>
      <div
        style={{
          fontSize: 168,
          lineHeight: 1,
          color: "#f8e45a",
          fontWeight: 700,
          marginTop: 8,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {amount}
      </div>
      <div
        style={{
          fontSize: 28,
          marginTop: 8,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          opacity: 0.75,
        }}
      >
        {label}
      </div>
    </div>
  );
}
