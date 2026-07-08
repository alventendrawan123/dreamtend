import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { getPool } from "../src/config/pairs.js";
import { getToken } from "../src/config/tokens.js";
import { SPOTPOOL_ABI } from "../src/dex/abi/spotpool.js";
import { logger } from "../src/utils/logger.js";

const ORDER_PLACED_TOPIC = ethers.id("OrderPlaced(uint128,address,bool,uint8,uint256,uint256,uint64)");

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const p = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, p);
  const pool = getPool(net.name, "WETH:USDso");
  const quote = getToken(net.name, pool.quote);
  const base = getToken(net.name, pool.base);
  const c = new ethers.Contract(pool.poolAddress, SPOTPOOL_ABI, wallet);

  // BUY and SELL tx hashes from the test
  const txHashes = [
    "0x5c237b2ef3c1d1535bda2ccd48cd9b440222c1af67766395031a19f085a80016",
    "0xe6138756e04bf20c69eb06cae0a7b3f913481c9db9c8cbc6378d5d0f60bea17d",
  ];
  const ids: bigint[] = [];
  for (const h of txHashes) {
    const r = await p.getTransactionReceipt(h);
    if (!r) { logger.warn({ h }, "no receipt"); continue; }
    for (const log of r.logs) {
      if (log.topics[0] === ORDER_PLACED_TOPIC && log.topics[1]) {
        const id = BigInt(log.topics[1]);
        ids.push(id);
        logger.info({ tx: h.slice(0, 12), orderId: id.toString() }, "found OrderPlaced");
      }
    }
  }

  for (const id of ids) {
    try {
      const tx = await c.cancelOrder(id);
      await tx.wait();
      logger.info({ orderId: id.toString() }, "cancelled");
    } catch (e) { logger.warn({ orderId: id.toString(), e: (e as Error).message.slice(0, 80) }, "cancel failed (maybe already gone)"); }
  }

  const vU = await c.getWithdrawableBalance(wallet.address, quote.address);
  const vW = await c.getWithdrawableBalance(wallet.address, base.address);
  logger.info({ usdsoVault: ethers.formatUnits(vU, quote.decimals), wethVault: ethers.formatUnits(vW, base.decimals) }, "vault after cancels");
  if (vU > 0n) {
    const tx = await c.withdraw(quote.address, vU);
    await tx.wait();
    logger.info({ amt: ethers.formatUnits(vU, quote.decimals) }, "withdrew USDso");
  }
  if (vW > 0n) {
    const tx = await c.withdraw(base.address, vW);
    await tx.wait();
    logger.info({ amt: ethers.formatUnits(vW, base.decimals) }, "withdrew WETH");
  }
  logger.info("recover done");
}
main().catch((e) => { logger.fatal({ e: (e as Error).message ?? e }); process.exit(1); });
