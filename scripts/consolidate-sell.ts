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
  const pool = getPool(net.name, process.argv[2] ?? "WETH:USDso");
  const quote = getToken(net.name, pool.quote);
  const base = getToken(net.name, pool.base);
  const c = new ethers.Contract(pool.poolAddress, SPOTPOOL_ABI, wallet);
  const ERC = ["function balanceOf(address) view returns (uint256)"];
  const usdso = new ethers.Contract(quote.address, ERC, p);
  const weth = new ethers.Contract(base.address, ERC, p);
  const params = await c.getPoolParams();
  const lot = params[6] as bigint; // idx6 = lotSize (idx5 = minQuantity); finer lot = less dust on liquidation

  const wbal = await weth.balanceOf(wallet.address);
  const qty = (wbal / lot) * lot; // floor to lot
  logger.info({ wethWallet: ethers.formatUnits(wbal, base.decimals), sellQty: ethers.formatUnits(qty, base.decimals) }, "consolidate SELL");
  if (qty <= 0n) { logger.info("nothing to sell"); return; }

  const u0 = await usdso.balanceOf(wallet.address);
  const sellArgs = [false, 0n, ethers.parseUnits("1", quote.decimals), qty, buildExpireNs(MS_PER_HOUR), ORDER_TYPE.ImmediateOrCancel, SELF_MATCH.CancelTaker, ethers.ZeroAddress, 0n] as const;
  try {
    await (await c.placeOrder(...sellArgs, { value: 0n })).wait();
    logger.info("SELL sent");
  } catch (e) { logger.error({ e: (e as Error).message.slice(0, 120) }, "SELL revert"); }

  const u1 = await usdso.balanceOf(wallet.address);
  const w1 = await weth.balanceOf(wallet.address);
  logger.info({
    usdsoNow: ethers.formatUnits(u1, quote.decimals),
    usdsoGain: ethers.formatUnits(u1 - u0, quote.decimals),
    wethNow: ethers.formatUnits(w1, base.decimals),
  }, "after SELL");
}
main().catch((e) => { logger.fatal({ e: (e as Error).message ?? e }); process.exit(1); });
