import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { getPool } from "../src/config/pairs.js";
import { getToken } from "../src/config/tokens.js";
import { SPOTPOOL_ABI } from "../src/dex/abi/spotpool.js";
import { buildExpireNs } from "../src/utils/gotchas.js";
import { ORDER_TYPE, SELF_MATCH, MS_PER_HOUR } from "../src/config/constants.js";
import { logger } from "../src/utils/logger.js";

const POOL_SYMBOL = "WETH:USDso";

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const provider = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const pool = getPool(net.name, POOL_SYMBOL);
  const baseTok = getToken(net.name, pool.base);
  const quoteTok = getToken(net.name, pool.quote);
  const c = new ethers.Contract(pool.poolAddress, SPOTPOOL_ABI, wallet);

  const ERC20 = ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"];
  const usdso = new ethers.Contract(quoteTok.address, ERC20, provider);
  const weth = new ethers.Contract(baseTok.address, ERC20, provider);

  const usdsoBal = await usdso.balanceOf(wallet.address);
  const wethBal = await weth.balanceOf(wallet.address);
  const usdsoAllow = await usdso.allowance(wallet.address, pool.poolAddress);
  logger.info({
    usdso: ethers.formatUnits(usdsoBal, quoteTok.decimals),
    weth: ethers.formatUnits(wethBal, baseTok.decimals),
    usdsoAllow: usdsoAllow > 10n ** 30n ? "MAX" : ethers.formatUnits(usdsoAllow, quoteTok.decimals),
  }, "balances/allowance");

  // withdrawable (vault) balances
  try {
    const wbU = await c.getWithdrawableBalance(wallet.address, quoteTok.address);
    const wbW = await c.getWithdrawableBalance(wallet.address, baseTok.address);
    logger.info({ usdsoVault: ethers.formatUnits(wbU, quoteTok.decimals), wethVault: ethers.formatUnits(wbW, baseTok.decimals) }, "withdrawable (vault) balances");
  } catch (e) { logger.warn({ e: (e as Error).message.slice(0, 120) }, "getWithdrawableBalance revert"); }

  // open orders
  try {
    const oo = await c.getOwnOpenOrders(wallet.address);
    logger.info({ count: oo.length, ids: oo.slice(0, 10).map((x: bigint) => x.toString()) }, "own open orders");
  } catch (e) { logger.warn({ e: (e as Error).message.slice(0, 120) }, "getOwnOpenOrders revert"); }

  // Ladder of buyLimits near ask — isolate price-band. Fetch ask from REST first (caller passes via env not needed).
  const expireNs = buildExpireNs(MS_PER_HOUR);
  const tick = 10n ** 16n; // 0.01
  const qtyRaw = ethers.parseUnits("0.005", baseTok.decimals);
  const mkArgs = (isBid: boolean, priceRaw: bigint) => [
    isBid, 0n, priceRaw, qtyRaw, expireNs, ORDER_TYPE.ImmediateOrCancel, SELF_MATCH.CancelTaker, ethers.ZeroAddress, 0n,
  ] as const;

  const tryBuy = async (priceHuman: string) => {
    const priceRaw = ethers.parseUnits(priceHuman, quoteTok.decimals);
    try {
      const [ok, id] = await c.placeTakerOrderWithoutVault.staticCall(...mkArgs(true, priceRaw), { value: 0n });
      logger.info({ priceHuman, simOk: ok, id: id.toString() }, "BUY sim OK (no revert)");
    } catch (e) {
      const msg = (e as Error).message;
      logger.warn({ priceHuman, revert: msg.slice(0, 80) }, "BUY sim REVERT");
    }
  };

  // test a ladder: just above ask up to far
  for (const p of ["1790", "1795", "1800", "1810", "1850", "1900"]) {
    await tryBuy(p);
  }

  // Also try raw provider.call to fetch revert data (4-byte selector / panic code)
  const priceRaw = ethers.parseUnits("1795", quoteTok.decimals);
  const data = c.interface.encodeFunctionData("placeTakerOrderWithoutVault", mkArgs(true, priceRaw) as unknown as unknown[]);
  try {
    const raw = await provider.call({ to: pool.poolAddress, from: wallet.address, data, value: 0n });
    logger.info({ raw }, "raw provider.call returned (decoded next)");
    try {
      const dec = c.interface.decodeFunctionResult("placeTakerOrderWithoutVault", raw);
      logger.info({ dec: dec.map((x) => x.toString()) }, "decoded result");
    } catch { /* ignore */ }
  } catch (e) {
    const err = e as { data?: string; message?: string };
    logger.warn({ data: err.data ?? "none", msg: (err.message ?? "").slice(0, 120) }, "raw call revert data");
  }
}

main().catch((e) => { logger.fatal({ e: (e as Error).message ?? e }); process.exit(1); });
