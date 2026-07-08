import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { getPool } from "../src/config/pairs.js";
import { getToken } from "../src/config/tokens.js";
import { SPOTPOOL_ABI } from "../src/dex/abi/spotpool.js";
import { buildExpireNs } from "../src/utils/gotchas.js";
import { ORDER_TYPE, SELF_MATCH, MS_PER_HOUR } from "../src/config/constants.js";
import { logger } from "../src/utils/logger.js";

const ORDER_FILLED_TOPIC = ethers.id("OrderFilled(uint128,uint128,uint256,uint256,uint256)");

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const p = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, p);
  const pool = getPool(net.name, "WETH:USDso");
  const quote = getToken(net.name, pool.quote);
  const base = getToken(net.name, pool.base);
  const c = new ethers.Contract(pool.poolAddress, SPOTPOOL_ABI, wallet);
  const params = await c.getPoolParams();
  const tick = params[4] as bigint, lot = params[5] as bigint;
  const qty = lot * 5n; // 0.005

  const depAmt = ethers.parseUnits("10", quote.decimals);
  logger.info({ depAmt: ethers.formatUnits(depAmt, quote.decimals) }, "STEP1 deposit USDso to vault");
  let tx = await c.deposit(quote.address, depAmt);
  await tx.wait();
  let vU = await c.getWithdrawableBalance(wallet.address, quote.address);
  logger.info({ usdsoVault: ethers.formatUnits(vU, quote.decimals) }, "vault after deposit");

  const expireNs1 = buildExpireNs(MS_PER_HOUR);
  const buyPrice = (ethers.parseUnits("1810", quote.decimals) / tick) * tick;
  const buyArgs = [true, 0n, buyPrice, qty, expireNs1, ORDER_TYPE.ImmediateOrCancel, SELF_MATCH.CancelTaker, ethers.ZeroAddress, 0n] as const;
  logger.info("STEP2 placeOrder BUY IOC (vault)");
  const [bok] = await c.placeOrder.staticCall(...buyArgs);
  logger.info({ simOk: bok }, "buy sim");
  tx = await c.placeOrder(...buyArgs);
  let r = await tx.wait();
  let fills = r!.logs.filter((l: ethers.Log) => l.topics[0] === ORDER_FILLED_TOPIC).length;
  const vW = await c.getWithdrawableBalance(wallet.address, base.address);
  logger.info({ tx: r!.hash, fills, wethVault: ethers.formatUnits(vW, base.decimals) }, "after BUY");

  // SELL the vaulted WETH back
  const expireNs2 = buildExpireNs(MS_PER_HOUR);
  const sellPrice = (ethers.parseUnits("1", quote.decimals) / tick) * tick > 0n ? ethers.parseUnits("1", quote.decimals) : tick;
  const sellArgs = [false, 0n, sellPrice, qty, expireNs2, ORDER_TYPE.ImmediateOrCancel, SELF_MATCH.CancelTaker, ethers.ZeroAddress, 0n] as const;
  logger.info("STEP3 placeOrder SELL IOC (vault)");
  tx = await c.placeOrder(...sellArgs);
  r = await tx.wait();
  fills = r!.logs.filter((l: ethers.Log) => l.topics[0] === ORDER_FILLED_TOPIC).length;
  vU = await c.getWithdrawableBalance(wallet.address, quote.address);
  const vW2 = await c.getWithdrawableBalance(wallet.address, base.address);
  logger.info({ tx: r!.hash, fills, usdsoVault: ethers.formatUnits(vU, quote.decimals), wethVault: ethers.formatUnits(vW2, base.decimals) }, "after SELL");

  // withdraw USDso back to wallet
  logger.info("STEP4 withdraw USDso from vault");
  tx = await c.withdraw(quote.address, vU);
  await tx.wait();
  logger.info("withdraw done — VAULT ROUND-TRIP WORKS");
}
main().catch((e) => { logger.fatal({ e: (e as Error).message ?? e }); process.exit(1); });
