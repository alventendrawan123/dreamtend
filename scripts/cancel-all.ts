import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { getPool } from "../src/config/pairs.js";
import { getToken } from "../src/config/tokens.js";
import { SPOTPOOL_ABI } from "../src/dex/abi/spotpool.js";
import { logger } from "../src/utils/logger.js";

// Cancel all of OUR resting orders on a pool by scanning recent OrderPlaced
// events (getOwnOpenOrders reverts on this deployment). Decodes the Order
// tuple in each event's data to filter by owner == us, then cancels each id.
// Usage: NETWORK=mainnet npx tsx scripts/cancel-all.ts WETH:USDso

const POOL_SYMBOL = process.argv[2] ?? "WETH:USDso";
const ORDER_PLACED_TOPIC = "0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d";

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const p = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  const w = new ethers.Wallet(process.env.PRIVATE_KEY!, p);
  const pool = getPool(net.name, POOL_SYMBOL);
  const c = new ethers.Contract(pool.poolAddress, SPOTPOOL_ABI, w);
  const me = w.address.toLowerCase();

  const orderTuple = "tuple(uint128 orderId,bool isBid,address owner,uint64 userData,uint256 price,uint256 fullQuantity,uint256 quantityRemaining,uint64 expireTimestampNs)";
  const coder = ethers.AbiCoder.defaultAbiCoder();

  // PRIMARY: getOwnOpenOrders() is the COMPLETE current open set (authoritative,
  // not window-limited). The old event-scan only saw the last ~12*900 blocks and
  // MISSED older/orphaned orders — so it must stay only as a fallback.
  const ids = new Set<string>();
  try {
    const open = await (c.getOwnOpenOrders as unknown as (o: { from: string }) => Promise<bigint[]>)({ from: me });
    for (const id of open) ids.add(id.toString());
    logger.info({ found: ids.size }, "open orders via getOwnOpenOrders() (complete set)");
  } catch (e) {
    logger.warn({ e: (e as Error).message.slice(0, 80) }, "getOwnOpenOrders failed — falling back to OrderPlaced event scan (window-limited)");
    const head = await p.getBlockNumber();
    const chunk = 900;
    for (let i = 0; i < 12; i++) {
      const to = head - i * chunk, from = to - chunk + 1;
      try {
        const logs = await p.getLogs({ address: pool.poolAddress, fromBlock: from, toBlock: to, topics: [ORDER_PLACED_TOPIC] });
        for (const log of logs) {
          try { const [ord] = coder.decode([orderTuple], log.data) as unknown as [{ orderId: bigint; owner: string }]; if (ord.owner.toLowerCase() === me) ids.add(ord.orderId.toString()); } catch { /* skip */ }
        }
      } catch { /* skip chunk */ }
    }
    logger.info({ found: ids.size }, "fallback event-scan ids (window-limited)");
  }

  let cancelled = 0;
  for (const idStr of ids) {
    try {
      const tx = await (c.cancelOrder as ethers.BaseContractMethod<[bigint], unknown, ethers.ContractTransactionResponse>)(BigInt(idStr));
      await tx.wait();
      cancelled += 1;
    } catch { /* already filled/expired */ }
  }
  logger.info({ cancelled, of: ids.size }, "cancel pass done");

  const q = getToken(net.name, pool.quote); const b = getToken(net.name, pool.base);
  const qe = new ethers.Contract(q.address, ["function balanceOf(address) view returns (uint256)"], p);
  const be = new ethers.Contract(b.address, ["function balanceOf(address) view returns (uint256)"], p);
  logger.info({ usdso: ethers.formatUnits(await qe.balanceOf(w.address), q.decimals), base: ethers.formatUnits(await be.balanceOf(w.address), b.decimals) }, "available after cancels");
}
main().catch((e) => { logger.fatal({ e: (e as Error).message ?? e }); process.exit(1); });
