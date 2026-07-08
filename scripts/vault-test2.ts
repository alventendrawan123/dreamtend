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
  const iface = new ethers.Interface(SPOTPOOL_ABI);
  const params = await c.getPoolParams();
  const tick = params[4] as bigint, lot = params[5] as bigint, minQ = params[6] as bigint;
  logger.info({ tick: tick.toString(), lot: lot.toString(), minQ: minQ.toString() }, "params");

  const dumpLogs = (r: ethers.TransactionReceipt | null, label: string) => {
    logger.info({ label, status: r?.status, n: r?.logs.length }, "tx logs:");
    for (const log of r!.logs) {
      try { const pl = iface.parseLog({ topics: [...log.topics], data: log.data }); if (pl) console.log(`   ${pl.name}(${pl.args.map((a) => a.toString()).join(", ")})`); }
      catch { console.log(`   unknown ${log.topics[0]?.slice(0, 10)}`); }
    }
  };
  const vbal = async () => ({
    u: ethers.formatUnits(await c.getWithdrawableBalance(wallet.address, quote.address), quote.decimals),
    w: ethers.formatUnits(await c.getWithdrawableBalance(wallet.address, base.address), base.decimals),
  });

  const qty = lot; // 0.001 smallest
  const dep = ethers.parseUnits("5", quote.decimals);
  logger.info("STEP1 deposit 5 USDso");
  await (await c.deposit(quote.address, dep)).wait();
  logger.info(await vbal(), "vault post-deposit");

  // BUY IOC crossing far above ask to guarantee match if any ask exists
  const buyPrice = (ethers.parseUnits("1850", quote.decimals) / tick) * tick;
  const buyArgs = [true, 0n, buyPrice, qty, buildExpireNs(MS_PER_HOUR), ORDER_TYPE.ImmediateOrCancel, SELF_MATCH.CancelTaker, ethers.ZeroAddress, 0n] as const;
  logger.info({ buyPrice: ethers.formatUnits(buyPrice, quote.decimals), qty: ethers.formatUnits(qty, base.decimals) }, "STEP2 placeOrder BUY IOC");
  const rb = await (await c.placeOrder(...buyArgs)).wait();
  dumpLogs(rb, "BUY");
  logger.info(await vbal(), "vault post-BUY");

  logger.info("STEP3 withdraw all back");
  const vb = await vbal();
  if (Number(vb.u) > 0) await (await c.withdraw(quote.address, await c.getWithdrawableBalance(wallet.address, quote.address))).wait();
  if (Number(vb.w) > 0) await (await c.withdraw(base.address, await c.getWithdrawableBalance(wallet.address, base.address))).wait();
  logger.info(await vbal(), "vault post-withdraw (should be 0/0)");
}
main().catch((e) => { logger.fatal({ e: (e as Error).message ?? e }); process.exit(1); });
