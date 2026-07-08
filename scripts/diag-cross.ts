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
  const expireNs = buildExpireNs(MS_PER_HOUR);

  for (const sym of ["SOMI:USDso", "WBTC:USDso", "WETH:USDso"]) {
    try {
      const pool = getPool(net.name, sym);
      const base = getToken(net.name, pool.base);
      const quote = getToken(net.name, pool.quote);
      const c = new ethers.Contract(pool.poolAddress, SPOTPOOL_ABI, wallet);
      const params = await c.getPoolParams();
      const lot = params[5] as bigint;
      const minQ = params[6] as bigint;
      const qty = lot > minQ ? lot : minQ; // smallest valid
      // BUY far above market so it would match if any ask exists; price = a high number tick-aligned
      const tick = params[4] as bigint;
      // pick price = 10x min tick steps high — just to test accept/revert, use a big aligned price
      const priceRaw = (ethers.parseUnits("100000", quote.decimals) / tick) * tick;
      const args = [true, 0n, priceRaw, qty, expireNs, ORDER_TYPE.ImmediateOrCancel, SELF_MATCH.CancelTaker, ethers.ZeroAddress, 0n] as const;
      try {
        const [ok, id] = await c.placeTakerOrderWithoutVault.staticCall(...args, { value: 0n });
        console.log(`${sym}: BUY sim OK simOk=${ok} id=${id}`);
      } catch (e) {
        console.log(`${sym}: BUY sim REVERT -> ${(e as Error).message.slice(0, 70)}`);
      }
    } catch (e) {
      console.log(`${sym}: setup err ${(e as Error).message.slice(0, 70)}`);
    }
  }
}
main().catch((e) => { console.error((e as Error).message ?? e); process.exit(1); });
