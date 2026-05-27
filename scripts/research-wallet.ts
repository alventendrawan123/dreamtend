import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { POOLS } from "../src/config/pairs.js";
import { logger } from "../src/utils/logger.js";

const TARGET = (process.argv[2] ?? "").toLowerCase();
if (!TARGET || !ethers.isAddress(TARGET)) {
  throw new Error("Usage: tsx scripts/research-wallet.ts <address> [blockLookback=200000]");
}
const BLOCK_LOOKBACK = Number(process.argv[3] ?? "200000");
const CHUNK = 999;

const ORDER_PLACED_TOPIC = "0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d";
const ORDER_FILLED_TOPIC = ethers.id("OrderFilled(uint128,uint128,uint256,uint256,uint256)");

const ORDER_TYPE_LABELS = ["GTC", "POST_ONLY", "IOC", "FOK"] as const;

interface OrderPlacedDecoded {
  pool: string;
  poolAddr: string;
  blockNumber: number;
  txHash: string;
  orderId: bigint;
  isBid: boolean;
  orderType: number;
  price: bigint;
  quantity: bigint;
}

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const provider = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });

  const target = ethers.getAddress(TARGET);
  const balance = await provider.getBalance(target);
  const txCount = await provider.getTransactionCount(target);
  const latest = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latest - BLOCK_LOOKBACK);

  console.log("=".repeat(100));
  console.log(`Wallet research: ${target}`);
  console.log("=".repeat(100));
  console.log(`Native SOMI balance: ${ethers.formatEther(balance)}`);
  console.log(`Total tx count (nonce): ${txCount}`);
  console.log(`Scanning blocks ${fromBlock} → ${latest} (${BLOCK_LOOKBACK} block lookback)`);
  console.log();

  const ownerTopic = ethers.zeroPadValue(target, 32);
  const iface = new ethers.Interface([
    "event OrderPlaced(uint128 indexed orderId, address indexed owner, bool isBid, uint8 orderType, uint256 price, uint256 quantity, uint64 expireTimestampNs)",
  ]);

  const allEvents: OrderPlacedDecoded[] = [];

  for (const sym of Object.keys(POOLS[net.name])) {
    const pool = POOLS[net.name][sym]!;
    let scanned = 0;
    let chunkEvents = 0;
    for (let start = fromBlock; start <= latest; start += CHUNK) {
      const end = Math.min(start + CHUNK - 1, latest);
      try {
        const logs = await provider.getLogs({
          address: pool.poolAddress,
          fromBlock: start,
          toBlock: end,
          topics: [ORDER_PLACED_TOPIC, null, ownerTopic],
        });
        for (const log of logs) {
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (!parsed) continue;
          allEvents.push({
            pool: sym,
            poolAddr: pool.poolAddress,
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
            orderId: parsed.args[0] as bigint,
            isBid: parsed.args[2] as boolean,
            orderType: Number(parsed.args[3]),
            price: parsed.args[4] as bigint,
            quantity: parsed.args[5] as bigint,
          });
          chunkEvents++;
        }
      } catch (err) {
        console.error(`  [${sym}] getLogs ${start}-${end} failed:`, (err as Error).message);
      }
      scanned += end - start + 1;
    }
    process.stderr.write(`  [${sym}] scanned ${scanned} blocks, found ${chunkEvents} OrderPlaced events\n`);
  }

  console.log();
  console.log(`Total OrderPlaced events: ${allEvents.length}`);

  if (allEvents.length === 0) {
    console.log("\nNo on-chain DreamDEX orders found from this wallet in lookback window.");
    return;
  }

  // Per-pool breakdown
  const perPool = new Map<string, OrderPlacedDecoded[]>();
  for (const e of allEvents) {
    if (!perPool.has(e.pool)) perPool.set(e.pool, []);
    perPool.get(e.pool)!.push(e);
  }

  console.log("\n" + "=".repeat(100));
  console.log("PER-POOL BREAKDOWN");
  console.log("=".repeat(100));
  for (const [sym, events] of perPool) {
    const bids = events.filter((e) => e.isBid).length;
    const asks = events.length - bids;
    const typeCounts: Record<string, number> = {};
    for (const e of events) {
      const lbl = ORDER_TYPE_LABELS[e.orderType] ?? `t${e.orderType}`;
      typeCounts[lbl] = (typeCounts[lbl] ?? 0) + 1;
    }
    console.log(`\n[${sym}] ${events.length} orders  (${bids} bid / ${asks} ask)`);
    console.log(`  By type: ${Object.entries(typeCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`);

    // Qty stats
    const qtyHuman = events.map((e) => Number(ethers.formatUnits(e.quantity, 18)));
    qtyHuman.sort((a, b) => a - b);
    const median = qtyHuman[Math.floor(qtyHuman.length / 2)];
    const avg = qtyHuman.reduce((s, v) => s + v, 0) / qtyHuman.length;
    const min = qtyHuman[0];
    const max = qtyHuman[qtyHuman.length - 1];
    console.log(`  Quantity (formatted /1e18): min=${min} median=${median} avg=${avg.toFixed(4)} max=${max}`);

    // Price stats
    const pricesHuman = events.map((e) => Number(ethers.formatUnits(e.price, 18)));
    pricesHuman.sort((a, b) => a - b);
    console.log(`  Price (formatted /1e18): min=${pricesHuman[0]} median=${pricesHuman[Math.floor(pricesHuman.length / 2)]} max=${pricesHuman[pricesHuman.length - 1]}`);
  }

  // Time distribution: events per hour
  console.log("\n" + "=".repeat(100));
  console.log("TIME DISTRIBUTION (last 50 events by block)");
  console.log("=".repeat(100));
  const sortedByBlock = [...allEvents].sort((a, b) => a.blockNumber - b.blockNumber);
  const blockTimestamps = new Map<number, number>();
  const sampleBlocks = Array.from(new Set(sortedByBlock.slice(-50).map((e) => e.blockNumber)));
  for (const b of sampleBlocks) {
    const blk = await provider.getBlock(b);
    if (blk) blockTimestamps.set(b, Number(blk.timestamp));
  }

  const recent = sortedByBlock.slice(-50);
  for (const e of recent) {
    const ts = blockTimestamps.get(e.blockNumber);
    const isoTs = ts ? new Date(ts * 1000).toISOString() : "?";
    const t = ORDER_TYPE_LABELS[e.orderType] ?? `t${e.orderType}`;
    const side = e.isBid ? "BUY " : "SELL";
    const qty = ethers.formatUnits(e.quantity, 18);
    const price = ethers.formatUnits(e.price, 18);
    console.log(`  ${isoTs} blk=${e.blockNumber} ${e.pool.padEnd(13)} ${side} ${t.padEnd(9)} qty=${qty} px=${price}`);
  }

  // Time burst analysis — events per minute (rolling)
  if (sortedByBlock.length > 50) {
    console.log("\n" + "=".repeat(100));
    console.log("BURST ANALYSIS — orders per minute across full window (top 20)");
    console.log("=".repeat(100));
    const fullSampleBlocks = Array.from(new Set(sortedByBlock.map((e) => e.blockNumber)));
    // Avoid spamming provider — sample every 10th block timestamp and interpolate roughly
    const sampleEvery = Math.max(1, Math.floor(fullSampleBlocks.length / 100));
    const sampledTs = new Map<number, number>();
    for (let i = 0; i < fullSampleBlocks.length; i += sampleEvery) {
      const b = fullSampleBlocks[i];
      const blk = await provider.getBlock(b);
      if (blk) sampledTs.set(b, Number(blk.timestamp));
    }
    // Approximate timestamps by nearest sampled block
    const sampledBlocks = Array.from(sampledTs.keys()).sort((a, b) => a - b);
    function approxTs(bn: number): number {
      // Find nearest sampled
      let nearest = sampledBlocks[0];
      let best = Math.abs(bn - nearest);
      for (const sb of sampledBlocks) {
        const d = Math.abs(bn - sb);
        if (d < best) { best = d; nearest = sb; }
      }
      return sampledTs.get(nearest)!;
    }
    const perMinute = new Map<string, number>();
    for (const e of sortedByBlock) {
      const ts = approxTs(e.blockNumber);
      const key = new Date(Math.floor(ts / 60) * 60 * 1000).toISOString();
      perMinute.set(key, (perMinute.get(key) ?? 0) + 1);
    }
    const sortedBuckets = [...perMinute.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    for (const [bucket, count] of sortedBuckets) {
      console.log(`  ${bucket}  ${"█".repeat(Math.min(count, 50))} (${count})`);
    }
  }

  console.log("\n" + "=".repeat(100));
  console.log("DONE");
}

main().catch((err) => { logger.fatal({ err: err.message ?? err }); process.exit(1); });
