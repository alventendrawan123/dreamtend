import "dotenv/config";
import { ethers } from "ethers";

// Standalone race-pacing probe: attribute WETH:USDso pool volume to trader-2 and us
// over recent on-chain windows, then extrapolate to a daily rate.

const RPC = process.env.MAINNET_RPC ?? "https://api.infra.mainnet.somnia.network";
const POOL = "0xa936da11B57b50A344e1293AAaE5232885ea2bDE";
const TRADER2 = "0xD84fE2a2220f0269e3d88dab908ADceb2d691E76".toLowerCase();
const US = "0xba4E595D6C2e655592c86ce29BbAec202d9175E1".toLowerCase();

// decimals: WETH base 18, USDso quote 18 (confirmed in src/config/tokens.ts)
const BASE_DEC = 18;
const QUOTE_DEC = 18;

const provider = new ethers.JsonRpcProvider(RPC, { chainId: 5031, name: "mainnet" });

const iface = new ethers.Interface([
  "event OrderPlaced(uint128 indexed orderId, tuple(uint128 orderId, bool isBid, address owner, uint64 userData, uint256 price, uint256 fullQuantity, uint256 quantityRemaining, uint64 expireTimestampNs) order)",
  "event OrderFilled(uint128 indexed takerOrderId, uint128 indexed makerOrderId, uint256 quantityFilled, uint256 takerRemaining, uint256 makerRemaining, uint256 fillPrice)",
]);
const FILLED = ethers.id("OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)");
const PLACED = ethers.id(
  "OrderPlaced(uint128,(uint128,bool,address,uint64,uint256,uint256,uint256,uint256))",
);

// Fallback known topic (from diag-fills.ts) in case struct-sig hashing differs
const PLACED_KNOWN = "0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d";

interface WindowResult {
  fromBlock: number;
  toBlock: number;
  fromTs: number;
  toTs: number;
  spanSec: number;
  totalVolUsd: number;
  trader2Vol: number;
  usVol: number;
  fillCount: number;
  attributedFills: number;
}

async function scanWindow(head: number, offsetBlocks: number, span = 999): Promise<WindowResult> {
  const toBlock = head - offsetBlocks;
  const fromBlock = toBlock - span;

  const placedTopic = PLACED; // computed
  // Fetch OrderPlaced to build orderId -> owner map (owners of resting/placed orders)
  const placedLogs = await provider.getLogs({
    address: POOL,
    fromBlock,
    toBlock,
    topics: [placedTopic],
  });
  let placedUsed = placedLogs;
  if (placedLogs.length === 0) {
    // try known topic
    const alt = await provider.getLogs({ address: POOL, fromBlock, toBlock, topics: [PLACED_KNOWN] });
    if (alt.length > 0) placedUsed = alt;
  }

  const ownerById = new Map<string, string>();
  for (const lg of placedUsed) {
    try {
      const dec = iface.parseLog({ topics: lg.topics as string[], data: lg.data });
      if (!dec) continue;
      const orderId = (dec.args[0] as bigint).toString();
      const order = dec.args[1] as unknown as { owner: string };
      ownerById.set(orderId, (order.owner as string).toLowerCase());
    } catch {
      /* skip undecodable */
    }
  }

  // Fetch OrderFilled (volume events)
  const filledLogs = await provider.getLogs({
    address: POOL,
    fromBlock,
    toBlock,
    topics: [FILLED],
  });

  let totalVolUsd = 0;
  let trader2Vol = 0;
  let usVol = 0;
  let attributedFills = 0;

  // Cache tx.from per txHash to attribute the TAKER side (taker = tx sender)
  const txFromCache = new Map<string, string>();

  for (const lg of filledLogs) {
    let dec;
    try {
      dec = iface.parseLog({ topics: lg.topics as string[], data: lg.data });
    } catch {
      continue;
    }
    if (!dec) continue;
    const takerOrderId = (dec.args[0] as bigint).toString();
    const makerOrderId = (dec.args[1] as bigint).toString();
    const qtyRaw = dec.args[2] as bigint;
    const priceRaw = dec.args[5] as bigint;

    const qty = Number(ethers.formatUnits(qtyRaw, BASE_DEC));
    const price = Number(ethers.formatUnits(priceRaw, QUOTE_DEC));
    const notional = qty * price; // USDso value of this fill

    totalVolUsd += notional;

    // Maker owner via OrderPlaced map
    const makerOwner = ownerById.get(makerOrderId);
    // Taker owner: prefer OrderPlaced map; else tx.from
    let takerOwner = ownerById.get(takerOrderId);
    if (!takerOwner) {
      let f = txFromCache.get(lg.transactionHash);
      if (f === undefined) {
        try {
          const tx = await provider.getTransaction(lg.transactionHash);
          f = tx?.from?.toLowerCase() ?? "";
        } catch {
          f = "";
        }
        txFromCache.set(lg.transactionHash, f);
      }
      takerOwner = f || undefined;
    }

    // Leaderboard counts BOTH maker and taker volume of a fill toward each party.
    // So a fill contributes `notional` to maker's tally AND `notional` to taker's tally.
    if (makerOwner === TRADER2) trader2Vol += notional;
    if (takerOwner === TRADER2) trader2Vol += notional;
    if (makerOwner === US) usVol += notional;
    if (takerOwner === US) usVol += notional;

    if (makerOwner || takerOwner) attributedFills++;
  }

  const fromBlk = await provider.getBlock(fromBlock);
  const toBlk = await provider.getBlock(toBlock);
  const fromTs = Number(fromBlk?.timestamp ?? 0);
  const toTs = Number(toBlk?.timestamp ?? 0);

  return {
    fromBlock,
    toBlock,
    fromTs,
    toTs,
    spanSec: toTs - fromTs,
    totalVolUsd,
    trader2Vol,
    usVol,
    fillCount: filledLogs.length,
    attributedFills,
  };
}

async function main(): Promise<void> {
  const head = await provider.getBlockNumber();
  console.log(JSON.stringify({ head, pool: POOL, trader2: TRADER2, us: US }));

  // Sample non-overlapping 1000-block windows SPREAD across recent history so
  // bursty bot phases average out. 1000 blocks ~ 100s. Spread probes across the
  // last ~6 hours: step ~ every 30 min (18000 blocks).
  const argMode = process.argv[2] ?? "spread";
  let offsets: number[];
  if (argMode === "dense") {
    offsets = [0, 1000, 2000, 3000, 4000, 5000];
  } else {
    // 12 windows, one every ~30 min back over ~6h
    offsets = Array.from({ length: 12 }, (_, i) => i * 18000);
  }
  const results: WindowResult[] = [];
  for (const off of offsets) {
    try {
      const r = await scanWindow(head, off);
      results.push(r);
      console.log(
        JSON.stringify({
          window: `${r.fromBlock}-${r.toBlock}`,
          spanSec: r.spanSec,
          fills: r.fillCount,
          attributed: r.attributedFills,
          totalVolUsd: Math.round(r.totalVolUsd),
          trader2Vol: Math.round(r.trader2Vol),
          usVol: Math.round(r.usVol),
        }),
      );
    } catch (e) {
      console.log(JSON.stringify({ offset: off, err: (e as Error).message.slice(0, 120) }));
    }
  }

  // Aggregate
  const totSpan = results.reduce((a, r) => a + r.spanSec, 0);
  const totVol = results.reduce((a, r) => a + r.totalVolUsd, 0);
  const totT2 = results.reduce((a, r) => a + r.trader2Vol, 0);
  const totUs = results.reduce((a, r) => a + r.usVol, 0);

  const secPerDay = 86400;
  const t2PerDay = totSpan > 0 ? (totT2 / totSpan) * secPerDay : 0;
  const usPerDay = totSpan > 0 ? (totUs / totSpan) * secPerDay : 0;
  const totalPerDay = totSpan > 0 ? (totVol / totSpan) * secPerDay : 0;

  console.log(
    JSON.stringify(
      {
        SUMMARY: true,
        sampledSec: totSpan,
        sampledHours: +(totSpan / 3600).toFixed(3),
        totalVolSampled: Math.round(totVol),
        trader2VolSampled: Math.round(totT2),
        usVolSampled: Math.round(totUs),
        totalPoolVolPerDay: Math.round(totalPerDay),
        trader2VolPerDay: Math.round(t2PerDay),
        usVolPerDay: Math.round(usPerDay),
      },
      null,
      0,
    ),
  );
}

main().catch((e) => {
  console.error((e as Error).message ?? e);
  process.exit(1);
});
