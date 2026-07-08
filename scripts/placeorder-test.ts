import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { getPool } from "../src/config/pairs.js";
import { getToken } from "../src/config/tokens.js";
import { SPOTPOOL_ABI } from "../src/dex/abi/spotpool.js";
import { buildExpireNs } from "../src/utils/gotchas.js";
import { ORDER_TYPE, SELF_MATCH, MS_PER_HOUR } from "../src/config/constants.js";
import { logger } from "../src/utils/logger.js";

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const p = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, p);
  const pool = getPool(net.name, "WETH:USDso");
  const quote = getToken(net.name, pool.quote);
  const base = getToken(net.name, pool.base);
  const c = new ethers.Contract(pool.poolAddress, SPOTPOOL_ABI, wallet);
  const ERC = ["function balanceOf(address) view returns (uint256)"];
  const usdso = new ethers.Contract(quote.address, ERC, p);
  const weth = new ethers.Contract(base.address, ERC, p);
  const params = await c.getPoolParams();
  const tick = params[4] as bigint, lot = params[5] as bigint;
  const qty = lot; // 0.001

  const snap = async (tag: string) => {
    const u = await usdso.balanceOf(wallet.address);
    const w = await weth.balanceOf(wallet.address);
    logger.info({ tag, walletUSDso: ethers.formatUnits(u, quote.decimals), walletWETH: ethers.formatUnits(w, base.decimals) }, "snap");
    return { u, w };
  };

  const s0 = await snap("before");

  // BUY IOC on WALLET balance (no deposit), crossing price
  const buyPrice = (ethers.parseUnits("1850", quote.decimals) / tick) * tick;
  const buyArgs = [true, 0n, buyPrice, qty, buildExpireNs(MS_PER_HOUR), ORDER_TYPE.ImmediateOrCancel, SELF_MATCH.CancelTaker, ethers.ZeroAddress, 0n] as const;
  try {
    await (await c.placeOrder(...buyArgs, { value: 0n })).wait();
    logger.info("BUY placeOrder sent");
  } catch (e) { logger.error({ e: (e as Error).message.slice(0, 120) }, "BUY revert"); }
  const s1 = await snap("after BUY");
  logger.info({ dUSDso: ethers.formatUnits(s1.u - s0.u, quote.decimals), dWETH: ethers.formatUnits(s1.w - s0.w, base.decimals) }, "BUY delta");

  // SELL IOC on WALLET balance, below bid to cross
  const sellPrice = ethers.parseUnits("1", quote.decimals);
  const sellArgs = [false, 0n, sellPrice, qty, buildExpireNs(MS_PER_HOUR), ORDER_TYPE.ImmediateOrCancel, SELF_MATCH.CancelTaker, ethers.ZeroAddress, 0n] as const;
  try {
    await (await c.placeOrder(...sellArgs, { value: 0n })).wait();
    logger.info("SELL placeOrder sent");
  } catch (e) { logger.error({ e: (e as Error).message.slice(0, 120) }, "SELL revert"); }
  const s2 = await snap("after SELL");
  logger.info({ dUSDso: ethers.formatUnits(s2.u - s1.u, quote.decimals), dWETH: ethers.formatUnits(s2.w - s1.w, base.decimals) }, "SELL delta");

  logger.info({
    netUSDso: ethers.formatUnits(s2.u - s0.u, quote.decimals),
    netWETH: ethers.formatUnits(s2.w - s0.w, base.decimals),
  }, "ROUND-TRIP net (wallet)");
}
main().catch((e) => { logger.fatal({ e: (e as Error).message ?? e }); process.exit(1); });
