import "dotenv/config";
import { ethers } from "ethers";
import { readFile } from "node:fs/promises";
import { getActiveNetwork } from "../src/config/network.js";
import { getPool } from "../src/config/pairs.js";
import { getToken } from "../src/config/tokens.js";
import { SPOTPOOL_ABI } from "../src/dex/abi/spotpool.js";
import type { SpotPoolContract } from "../src/dex/abi/types.js";
import { buildExpireNs } from "../src/utils/gotchas.js";
import { ORDER_TYPE, SELF_MATCH, MS_PER_HOUR } from "../src/config/constants.js";
import { logger } from "../src/utils/logger.js";

interface BotWallet {
  id: number;
  address: string;
  privateKey: string;
  role: string;
}

interface SelfCrossOptions {
  poolSymbol: string;
  qtyBase: string;
  priceQuote: string;
  cycleIntervalMs: number;
  maxCycles: number;
}

const POOL_SYMBOL = process.argv[2] ?? "SOMI:USDso";
const QTY_BASE = process.argv[3] ?? "8";
const PRICE_QUOTE = process.argv[4] ?? "0.17";
const CYCLE_INTERVAL_MS = Number(process.argv[5] ?? "30000");
const MAX_CYCLES = Number(process.argv[6] ?? "20");
const MAKER_WALLET_INDEX = Number(process.argv[7] ?? "3");

const ORDER_PLACED_TOPIC =
  "0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d";

async function main(): Promise<void> {
  const network = getActiveNetwork();
  const provider = new ethers.JsonRpcProvider(network.rpc, {
    chainId: network.chainId,
    name: network.name,
  });

  const fleet = JSON.parse(await readFile("data/bot-wallets.json", "utf-8")) as {
    wallets: BotWallet[];
  };

  const makerEntry = fleet.wallets[MAKER_WALLET_INDEX];
  if (!makerEntry) {
    throw new Error(`MAKER_WALLET_INDEX=${MAKER_WALLET_INDEX} out of range`);
  }

  const takerPriv = process.env.PRIVATE_KEY;
  if (!takerPriv) {
    throw new Error("Set PRIVATE_KEY in .env for taker (registered wallet)");
  }

  const makerWallet = new ethers.Wallet(makerEntry.privateKey, provider);
  const takerWallet = new ethers.Wallet(takerPriv, provider);

  const pool = getPool(network.name, POOL_SYMBOL);
  const baseTok = getToken(network.name, pool.base);
  const quoteTok = getToken(network.name, pool.quote);

  const makerPool = new ethers.Contract(
    pool.poolAddress,
    SPOTPOOL_ABI,
    makerWallet,
  ) as SpotPoolContract;
  const takerPool = new ethers.Contract(
    pool.poolAddress,
    SPOTPOOL_ABI,
    takerWallet,
  ) as SpotPoolContract;

  const qtyRaw = ethers.parseUnits(QTY_BASE, baseTok.decimals);
  const priceRaw = ethers.parseUnits(PRICE_QUOTE, quoteTok.decimals);

  logger.info(
    {
      pool: POOL_SYMBOL,
      maker: makerWallet.address,
      taker: takerWallet.address,
      qty: QTY_BASE,
      price: PRICE_QUOTE,
      cycleMs: CYCLE_INTERVAL_MS,
      maxCycles: MAX_CYCLES,
      baseSymbol: baseTok.symbol,
      baseIsNative: baseTok.isNative,
    },
    "Self-cross orchestrator starting",
  );

  let totalVolume = 0;
  let cycle = 0;
  let stopped = false;

  process.on("SIGINT", () => {
    logger.warn("SIGINT received — stopping after current cycle");
    stopped = true;
  });
  process.on("SIGTERM", () => {
    logger.warn("SIGTERM received — stopping after current cycle");
    stopped = true;
  });

  for (cycle = 1; cycle <= MAX_CYCLES; cycle += 1) {
    if (stopped) break;
    logger.info({ cycle, totalVolume: totalVolume.toFixed(4) }, "=== CYCLE START ===");
    try {
      const result = await runOneCycle({
        makerPool,
        takerPool,
        makerAddress: makerWallet.address,
        takerAddress: takerWallet.address,
        priceRaw,
        qtyRaw,
        baseIsNative: baseTok.isNative ?? false,
      });
      if (result.filledQty > 0n) {
        const filledQtyDecimal = Number(
          ethers.formatUnits(result.filledQty, baseTok.decimals),
        );
        const cycleVolume = filledQtyDecimal * Number(PRICE_QUOTE);
        totalVolume += cycleVolume;
        logger.info(
          {
            cycle,
            filledQty: filledQtyDecimal.toFixed(4),
            cycleVolume: cycleVolume.toFixed(4),
            totalVolume: totalVolume.toFixed(4),
          },
          "✓ Cycle filled successfully",
        );
      } else {
        logger.warn({ cycle }, "✗ Cycle did NOT fill — taker IOC may have crossed wrong");
      }
    } catch (err) {
      logger.error({ cycle, err: (err as Error).message }, "Cycle failed");
    }

    if (cycle < MAX_CYCLES && !stopped) {
      await sleep(CYCLE_INTERVAL_MS);
    }
  }

  logger.info(
    {
      cyclesRun: cycle - (stopped ? 1 : 0),
      maxCycles: MAX_CYCLES,
      totalVolume: totalVolume.toFixed(4),
    },
    "Self-cross orchestrator finished",
  );
}

interface CycleParams {
  makerPool: SpotPoolContract;
  takerPool: SpotPoolContract;
  makerAddress: string;
  takerAddress: string;
  priceRaw: bigint;
  qtyRaw: bigint;
  baseIsNative: boolean;
}

interface CycleResult {
  filledQty: bigint;
  bidOrderId: bigint;
  bidTxHash: string;
  takerTxHash: string;
}

async function runOneCycle(p: CycleParams): Promise<CycleResult> {
  const expireNs = buildExpireNs(MS_PER_HOUR);

  // Step 1: MAKER places BID (PostOnly) via vault
  logger.info({ price: p.priceRaw.toString(), qty: p.qtyRaw.toString() }, "Step 1: maker BID");
  const bidArgs: [boolean, bigint, bigint, bigint, bigint, number, number, string, bigint] = [
    true,
    0n,
    p.priceRaw,
    p.qtyRaw,
    expireNs,
    ORDER_TYPE.PostOnly,
    SELF_MATCH.CancelTaker,
    ethers.ZeroAddress,
    0n,
  ];

  const [simBidOk, simBidId] = await p.makerPool.placeOrder.staticCall(...bidArgs);
  if (!simBidOk) {
    throw new Error(`BID sim failed: success=false orderId=${simBidId}`);
  }

  const bidTx = await p.makerPool.placeOrder(...bidArgs);
  const bidReceipt = await bidTx.wait();
  if (!bidReceipt) throw new Error("BID receipt null");

  let bidOrderId = simBidId;
  for (const log of bidReceipt.logs) {
    if (log.topics[0] === ORDER_PLACED_TOPIC && log.topics[1]) {
      bidOrderId = BigInt(log.topics[1]);
      break;
    }
  }
  logger.info({ orderId: bidOrderId.toString(), tx: bidReceipt.hash }, "BID placed");

  // Step 2: TAKER places IOC SELL (wallet-funded path) — crosses BID
  logger.info("Step 2: taker IOC SELL");
  const askArgs: [boolean, bigint, bigint, bigint, bigint, number, number, string, bigint] = [
    false,
    0n,
    p.priceRaw,
    p.qtyRaw,
    expireNs,
    ORDER_TYPE.ImmediateOrCancel,
    SELF_MATCH.CancelTaker,
    ethers.ZeroAddress,
    0n,
  ];
  const value = p.baseIsNative ? p.qtyRaw : 0n;

  const [simAskOk, simAskId] = await p.takerPool.placeTakerOrderWithoutVault.staticCall(
    ...askArgs,
    { value },
  );
  if (!simAskOk) {
    logger.warn({ simAskId: simAskId.toString() }, "Taker SELL sim returned success=false — cancelling BID");
    await cancelBid(p, bidOrderId);
    return { filledQty: 0n, bidOrderId, bidTxHash: bidReceipt.hash, takerTxHash: "" };
  }

  const takerTx = await p.takerPool.placeTakerOrderWithoutVault(...askArgs, { value });
  const takerReceipt = await takerTx.wait();
  if (!takerReceipt) throw new Error("Taker receipt null");
  logger.info({ tx: takerReceipt.hash }, "Taker SELL broadcast");

  // Verify fill happened by reading OrderFilled events
  const ORDER_FILLED_TOPIC = ethers.id(
    "OrderFilled(uint128,uint128,uint256,uint256,uint256)",
  );
  let filledQty = 0n;
  for (const log of takerReceipt.logs) {
    if (log.topics[0] === ORDER_FILLED_TOPIC) {
      // data has filledQty as first uint256 (32 bytes)
      const dataHex = log.data.replace(/^0x/, "");
      const qtyHex = dataHex.slice(0, 64);
      filledQty += BigInt("0x" + qtyHex);
    }
  }

  return { filledQty, bidOrderId, bidTxHash: bidReceipt.hash, takerTxHash: takerReceipt.hash };
}

async function cancelBid(p: CycleParams, orderId: bigint): Promise<void> {
  try {
    const tx = await p.makerPool.cancelOrder(orderId);
    await tx.wait();
    logger.info({ orderId: orderId.toString() }, "BID cancelled (cleanup)");
  } catch (err) {
    logger.warn({ orderId: orderId.toString(), err: (err as Error).message }, "Cancel cleanup failed");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  logger.fatal({ err: err.message ?? err });
  process.exit(1);
});
