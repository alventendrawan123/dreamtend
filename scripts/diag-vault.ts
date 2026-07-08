import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { getPool } from "../src/config/pairs.js";
import { getToken } from "../src/config/tokens.js";
import { SPOTPOOL_ABI } from "../src/dex/abi/spotpool.js";
import { buildExpireNs } from "../src/utils/gotchas.js";
import { ORDER_TYPE, SELF_MATCH, MS_PER_HOUR } from "../src/config/constants.js";

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
  const expireNs = buildExpireNs(MS_PER_HOUR);
  const priceRaw = (ethers.parseUnits("1800", quote.decimals) / tick) * tick;
  const qty = lot * 5n; // 0.005
  const argsBuy = [true, 0n, priceRaw, qty, expireNs, ORDER_TYPE.ImmediateOrCancel, SELF_MATCH.CancelTaker, ethers.ZeroAddress, 0n] as const;

  // 1) placeOrder (VAULT path) BUY sim
  try {
    const [ok, id] = await c.placeOrder.staticCall(...argsBuy);
    console.log(`placeOrder (VAULT) BUY sim OK simOk=${ok} id=${id}`);
  } catch (e) { console.log(`placeOrder (VAULT) BUY REVERT -> ${(e as Error).message.slice(0, 90)}`); }

  // 2) placeTakerOrderWithoutVault BUY sim (baseline)
  try {
    const [ok, id] = await c.placeTakerOrderWithoutVault.staticCall(...argsBuy, { value: 0n });
    console.log(`placeTakerWithoutVault BUY sim OK simOk=${ok} id=${id}`);
  } catch (e) { console.log(`placeTakerWithoutVault BUY REVERT -> ${(e as Error).message.slice(0, 90)}`); }

  // 3) deposit sim (would vault path even accept a deposit?)
  try {
    await c.deposit.staticCall(quote.address, ethers.parseUnits("1", quote.decimals));
    console.log(`deposit(USDso,1) sim OK`);
  } catch (e) { console.log(`deposit(USDso,1) REVERT -> ${(e as Error).message.slice(0, 90)}`); }

  // 4) cancelOrder sim with a dummy id (does account-write path revert too?)
  try {
    await c.cancelOrder.staticCall(1n);
    console.log(`cancelOrder(1) sim OK`);
  } catch (e) { console.log(`cancelOrder(1) REVERT -> ${(e as Error).message.slice(0, 90)}`); }
}
main().catch((e) => { console.error((e as Error).message ?? e); process.exit(1); });
