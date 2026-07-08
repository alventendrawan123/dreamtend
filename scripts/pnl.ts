import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { getToken } from "../src/config/tokens.js";

// Full status: true total portfolio value + real PnL (USDso + base×mid), and
// the leaderboard view. Use this — NOT the raw leaderboard usdsoBalance — to
// judge the maker bot: leaderboard balance excludes base inventory AND funds
// locked in resting orders, so it looks catastrophic mid-cycle when it isn't.
// Usage: NETWORK=mainnet npx tsx scripts/pnl.ts [BASE]   (default WETH)

const BASE = process.argv[2] ?? "WETH";
const ALLOC = 150;

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const p = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  const w = new ethers.Wallet(process.env.PRIVATE_KEY!, p);
  const q = getToken(net.name, "USDso");
  const b = getToken(net.name, BASE);
  const qe = new ethers.Contract(q.address, ["function balanceOf(address) view returns (uint256)"], p);
  const be = new ethers.Contract(b.address, ["function balanceOf(address) view returns (uint256)"], p);

  const u = Number(ethers.formatUnits(await qe.balanceOf(w.address), q.decimals));
  const bv = Number(ethers.formatUnits(await be.balanceOf(w.address), b.decimals));
  const somi = Number(ethers.formatUnits(await p.getBalance(w.address), 18));

  let mid = 0;
  try {
    const j = (await (await fetch(`https://api.dreamdex.io/v0/orderbooks?symbols=${BASE}:USDso`)).json()) as { orderbooks?: Array<{ bids: Array<{ price: string }>; asks: Array<{ price: string }> }> };
    const ob = j.orderbooks?.[0];
    if (ob?.bids?.[0] && ob?.asks?.[0]) mid = (Number(ob.bids[0].price) + Number(ob.asks[0].price)) / 2;
  } catch { /* ignore */ }

  const total = u + bv * mid;
  console.log(`WALLET (available, excl. resting-order locks):`);
  console.log(`  USDso ${u.toFixed(2)} | ${BASE} ${bv} (~$${(bv * mid).toFixed(2)} @ ${mid.toFixed(2)}) | SOMI ${somi.toFixed(3)}`);
  console.log(`  TOTAL value ~$${total.toFixed(2)}  |  real PnL ~$${(total - ALLOC).toFixed(2)} (${((total / ALLOC - 1) * 100).toFixed(2)}%)`);

  try {
    const lb = (await (await fetch("https://dreamdex-leaderboard-new.vercel.app/api/leaderboard")).json()) as { traders: Array<{ address: string; handle: string; volumeUsdso: number; volumeEffective: number; usdsoBalance: number; pnl: number; txCount: number }> };
    const me = lb.traders.find((t) => t.address.toLowerCase() === w.address.toLowerCase());
    console.log(`LEADERBOARD (${me?.handle ?? "?"}):  rawVol $${me?.volumeUsdso?.toFixed(0)} | effVol $${me?.volumeEffective?.toFixed(0)} | lbBalance $${me?.usdsoBalance?.toFixed(2)} | tx ${me?.txCount}`);
    const sorted = [...lb.traders].sort((a, b2) => b2.volumeEffective - a.volumeEffective);
    const rank = sorted.findIndex((t) => t.address.toLowerCase() === w.address.toLowerCase()) + 1;
    console.log(`  RANK by effVol: #${rank} of ${lb.traders.length}  |  top: ${sorted.slice(0, 3).map((t) => `${t.handle} $${t.volumeEffective.toFixed(0)}`).join(", ")}`);
  } catch { console.log("LEADERBOARD: fetch failed"); }
}
main().catch((e) => { console.error((e as Error).message ?? e); process.exit(1); });
