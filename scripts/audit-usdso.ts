import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { getPool } from "../src/config/pairs.js";
import { getToken } from "../src/config/tokens.js";

// Full accounting of where the $150 USDso allocation currently sits: free in
// wallet + locked in resting orders (via getOwnOpenOrders + getOrder) + total.
// Usage: NETWORK=mainnet npx tsx scripts/audit-usdso.ts
const ALLOC = 150;
const ERC = ["function balanceOf(address) view returns (uint256)"];
const POOL_ABI = [
  "function getOwnOpenOrders() view returns (uint128[])",
  "function getOrder(uint128 orderId) view returns (tuple(address owner, bool isBid, uint8 orderType, uint256 price, uint256 quantity, uint256 remaining, uint64 expireTimestampNs, uint64 userData))",
];

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const p = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  const me = new ethers.Wallet(process.env.PRIVATE_KEY!).address;
  const usdsoDec = getToken(net.name, "USDso").decimals;

  const mids: Record<string, number> = {};
  for (const s of ["WETH", "WBTC", "SOMI"]) {
    try { const j = (await (await fetch(`https://api.dreamdex.io/v0/orderbooks?symbols=${s}:USDso&depth=1`)).json()) as { orderbooks?: Array<{ bids: Array<{ price: string }>; asks: Array<{ price: string }> }> }; const o = j.orderbooks?.[0]; if (o?.bids?.[0] && o?.asks?.[0]) mids[s] = (Number(o.bids[0].price) + Number(o.asks[0].price)) / 2; } catch { /* */ }
  }
  const read = async (sym: string): Promise<number> => { const t = getToken(net.name, sym); const c = new ethers.Contract(t.address, ERC, p); try { return Number(ethers.formatUnits(await (c.balanceOf as ethers.BaseContractMethod<[string], bigint, bigint>)(me), t.decimals)); } catch { return 0; } };

  console.log(`=== USDso position (wallet ${me.slice(0, 8)}) — start $${ALLOC} ===\nFREE in wallet:`);
  let freeTotal = 0; const freeUsdso = await read("USDso");
  for (const s of ["USDso", "WETH", "WBTC", "USDC.e"]) {
    const bal = await read(s); const val = s === "USDso" || s === "USDC.e" ? bal : bal * (mids[s] ?? 0);
    if (bal > 0) console.log(`  ${s.padEnd(6)} ${bal.toFixed(6)}  ~$${val.toFixed(2)}`);
    freeTotal += val;
  }
  console.log(`  freeSubtotal ~$${freeTotal.toFixed(2)}\n`);

  let lockedUsdso = 0, lockedBaseVal = 0; const lines: string[] = [];
  for (const sym of ["WETH", "WBTC", "SOMI"]) {
    const pool = getPool(net.name, `${sym}:USDso`); const c = new ethers.Contract(pool.poolAddress, POOL_ABI, p);
    let ids: bigint[] = [];
    try { ids = await (c.getOwnOpenOrders as unknown as (o: { from: string }) => Promise<bigint[]>)({ from: me }); } catch { /* */ }
    let pu = 0, pb = 0, nb = 0, na = 0;
    for (const id of ids) {
      try { const o = await (c.getOrder as ethers.BaseContractMethod<[bigint], unknown[], unknown[]>)(id) as unknown as { isBid: boolean; price: bigint; remaining: bigint };
        const price = Number(ethers.formatUnits(o.price, usdsoDec)); const rem = Number(ethers.formatUnits(o.remaining, getToken(net.name, sym).decimals));
        if (o.isBid) { pu += rem * price; nb++; } else { pb += rem * (mids[sym] ?? 0); na++; }
      } catch { /* */ }
    }
    if (ids.length) { lines.push(`  ${sym}: ${ids.length} open (bid ${nb}/ask ${na}) → locked USDso $${pu.toFixed(2)} + base $${pb.toFixed(2)}`); lockedUsdso += pu; lockedBaseVal += pb; }
  }
  console.log("LOCKED in resting orders (getOwnOpenOrders + getOrder):");
  if (lines.length) lines.forEach((l) => console.log(l)); else console.log("  (none)");
  const lockedTotal = lockedUsdso + lockedBaseVal;
  const total = freeTotal + lockedTotal;
  console.log(`  lockedSubtotal ~$${lockedTotal.toFixed(2)}\n=== SUMMARY ===`);
  console.log(`  liquid USDso             $${freeUsdso.toFixed(2)}`);
  console.log(`  as WETH/WBTC inventory   $${(freeTotal - freeUsdso).toFixed(2)}`);
  console.log(`  locked in resting orders $${lockedTotal.toFixed(2)} (USDso $${lockedUsdso.toFixed(2)} + base $${lockedBaseVal.toFixed(2)})`);
  console.log(`  --------------------------------`);
  console.log(`  TOTAL portfolio          $${total.toFixed(2)}  (PnL $${(total - ALLOC).toFixed(2)}, ${((total / ALLOC - 1) * 100).toFixed(2)}%)`);
  const somi = Number(ethers.formatUnits(await p.getBalance(me), 18));
  console.log(`  SOMI gas (separate)      ${somi.toFixed(3)} SOMI`);
}
main().catch((e) => { console.error((e as Error).message ?? e); process.exit(1); });
