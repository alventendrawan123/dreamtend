import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { getPool } from "../src/config/pairs.js";
import { getToken } from "../src/config/tokens.js";
import { SPOTPOOL_ABI } from "../src/dex/abi/spotpool.js";
import type { SpotPoolContract } from "../src/dex/abi/types.js";
import { buildExpireNs } from "../src/utils/gotchas.js";
import { ORDER_TYPE, SELF_MATCH, MS_PER_HOUR } from "../src/config/constants.js";
import { logger } from "../src/utils/logger.js";

// CLEAN maker probe — post two-sided PostOnly resting orders, wait for an
// EXTERNAL taker to hit us, and detect whether the fill credits OUR maker
// wallet. No self-cross, no taker leg. Pure "is there organic flow + does
// maker volume count" test.
//
// Usage: NETWORK=mainnet npx tsx scripts/maker-probe.ts <pool> <qty> <midFallback> <waitSec>
//   e.g. NETWORK=mainnet npx tsx scripts/maker-probe.ts WBTC:USDso 0.0001 63300 600

const POOL_SYMBOL = process.argv[2] ?? "WBTC:USDso";
const QTY = process.argv[3] ?? "0.0001";
const MID_FALLBACK = process.argv[4] ?? "63300";
const WAIT_SEC = Number(process.argv[5] ?? "600");

const ORDER_PLACED_TOPIC = "0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d";
const ORDER_FILLED_TOPIC = ethers.id("OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)");

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const provider = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const pool = getPool(net.name, POOL_SYMBOL);
  const baseTok = getToken(net.name, pool.base);
  const quoteTok = getToken(net.name, pool.quote);
  const c = new ethers.Contract(pool.poolAddress, SPOTPOOL_ABI, wallet) as SpotPoolContract;

  const params = await (c.getPoolParams as ethers.BaseContractMethod<[], unknown[], unknown[]>)();
  const tickRaw = params[4] as bigint;
  const lotRaw = params[6] as bigint; // idx6 = lotSize (idx5 = minQuantity)

  const qtyRaw = ethers.parseUnits(QTY, baseTok.decimals);
  // align qty to lot
  const qtyAligned = (qtyRaw / lotRaw) * lotRaw;

  // read book
  let bestBid = 0n;
  let bestAsk = 0n;
  for (const isBid of [true, false]) {
    try {
      const levels = await (c.getBookLevels as ethers.BaseContractMethod<[boolean, bigint], Array<[bigint, bigint]>, Array<[bigint, bigint]>>)(isBid, 1n);
      if (levels.length > 0 && levels[0]) {
        if (isBid) bestBid = levels[0][0];
        else bestAsk = levels[0][0];
      }
    } catch { /* empty */ }
  }

  const midRaw = ethers.parseUnits(MID_FALLBACK, quoteTok.decimals);
  // align price to tick
  const align = (p: bigint): bigint => (p / tickRaw) * tickRaw;

  // BID: improve best bid by 1 tick, but stay below ask. ASK: improve best ask down 1 tick, stay above bid.
  let bidPrice = bestBid > 0n ? bestBid + tickRaw : align(midRaw - tickRaw);
  let askPrice = bestAsk > 0n ? bestAsk - tickRaw : align(midRaw + tickRaw);
  // safety: ensure bid < ask, at least 1 tick apart
  if (bidPrice >= askPrice) {
    bidPrice = align(midRaw - tickRaw);
    askPrice = align(midRaw + tickRaw);
  }
  bidPrice = align(bidPrice);
  askPrice = align(askPrice);

  logger.info({
    pool: POOL_SYMBOL,
    wallet: wallet.address,
    qty: ethers.formatUnits(qtyAligned, baseTok.decimals),
    bestBid: Number(ethers.formatUnits(bestBid, quoteTok.decimals)),
    bestAsk: Number(ethers.formatUnits(bestAsk, quoteTok.decimals)),
    bidPrice: Number(ethers.formatUnits(bidPrice, quoteTok.decimals)),
    askPrice: Number(ethers.formatUnits(askPrice, quoteTok.decimals)),
    waitSec: WAIT_SEC,
  }, "Maker probe — placing two-sided PostOnly");

  const placeMaker = async (isBid: boolean, priceRaw: bigint): Promise<bigint | null> => {
    const args: [boolean, bigint, bigint, bigint, bigint, number, number, string, bigint] = [
      isBid, 0n, priceRaw, qtyAligned, buildExpireNs(MS_PER_HOUR),
      ORDER_TYPE.PostOnly, SELF_MATCH.CancelTaker, ethers.ZeroAddress, 0n,
    ];
    try {
      const placeStatic = c.placeOrder as unknown as ethers.BaseContractMethod<typeof args, [boolean, bigint], [boolean, bigint]>;
      const [simOk, simId] = await placeStatic.staticCall(...args);
      if (!simOk) { logger.warn({ isBid, simId: simId.toString() }, "maker sim false"); return null; }
      const tx = await (c.placeOrder as ethers.BaseContractMethod<typeof args, unknown, ethers.ContractTransactionResponse>)(...args);
      const r = await tx.wait();
      let oid = simId;
      for (const log of r!.logs) {
        if (log.topics[0] === ORDER_PLACED_TOPIC && log.topics[1]) { oid = BigInt(log.topics[1]); break; }
      }
      logger.info({ side: isBid ? "BID" : "ASK", orderId: oid.toString(), tx: tx.hash, price: Number(ethers.formatUnits(priceRaw, quoteTok.decimals)) }, "maker order placed");
      return oid;
    } catch (err) {
      logger.error({ isBid, err: (err as Error).message }, "maker place failed");
      return null;
    }
  };

  const bidId = await placeMaker(true, bidPrice);
  const askId = await placeMaker(false, askPrice);
  const myIds = new Set<string>();
  if (bidId !== null) myIds.add(ethers.zeroPadValue(ethers.toBeHex(bidId), 32).toLowerCase());
  if (askId !== null) myIds.add(ethers.zeroPadValue(ethers.toBeHex(askId), 32).toLowerCase());

  if (myIds.size === 0) { logger.fatal("no maker orders placed — abort"); process.exit(1); }

  const startBlock = await provider.getBlockNumber();
  logger.info({ startBlock, watching: [...myIds] }, "watching OrderFilled for maker credit");

  const deadline = Date.now() + WAIT_SEC * 1000;
  let totalFilled = 0n;
  let lastScanned = startBlock;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15000));
    let head: number;
    try { head = await provider.getBlockNumber(); } catch { continue; }
    if (head <= lastScanned) { logger.info({ head }, "♥ probe alive, no new blocks"); continue; }
    try {
      const logs = await provider.getLogs({
        address: pool.poolAddress,
        fromBlock: lastScanned + 1,
        toBlock: head,
        topics: [ORDER_FILLED_TOPIC],
      });
      for (const log of logs) {
        const takerId = (log.topics[1] ?? "").toLowerCase();
        const makerId = (log.topics[2] ?? "").toLowerCase();
        if (myIds.has(makerId) || myIds.has(takerId)) {
          const qtyHex = log.data.replace(/^0x/, "").slice(0, 64);
          const fq = BigInt("0x" + qtyHex);
          totalFilled += fq;
          logger.info({
            role: myIds.has(makerId) ? "MAKER" : "TAKER",
            filledQty: ethers.formatUnits(fq, baseTok.decimals),
            tx: log.transactionHash, block: log.blockNumber,
          }, "🎯 OUR ORDER FILLED");
        }
      }
      lastScanned = head;
      logger.info({ head, totalFilled: ethers.formatUnits(totalFilled, baseTok.decimals) }, "♥ probe scan");
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "scan failed");
    }
  }

  // cleanup: cancel leftovers
  for (const oidHex of myIds) {
    try {
      const oid = BigInt(oidHex);
      const tx = await (c.cancelOrder as ethers.BaseContractMethod<[bigint], unknown, ethers.ContractTransactionResponse>)(oid);
      await tx.wait();
      logger.info({ orderId: oid.toString() }, "cancelled leftover");
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "cancel failed (maybe fully filled)");
    }
  }

  logger.info({ totalFilledBase: ethers.formatUnits(totalFilled, baseTok.decimals), verdict: totalFilled > 0n ? "FILLED — check leaderboard for maker volume credit" : "NO FILL — no external flow (inconclusive)" }, "PROBE DONE");
}

main().catch((err) => { logger.fatal({ err: err.message ?? err }); process.exit(1); });
