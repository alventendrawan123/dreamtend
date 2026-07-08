import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { getPool } from "../src/config/pairs.js";
import { getToken } from "../src/config/tokens.js";
import { SPOTPOOL_ABI } from "../src/dex/abi/spotpool.js";

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const p = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, p);
  const pool = getPool(net.name, "WETH:USDso");
  const quote = getToken(net.name, pool.quote);
  const base = getToken(net.name, pool.base);
  const c = new ethers.Contract(pool.poolAddress, SPOTPOOL_ABI, p);
  const ERC = ["function balanceOf(address) view returns (uint256)"];
  const usdso = new ethers.Contract(quote.address, ERC, p);
  const weth = new ethers.Contract(base.address, ERC, p);

  console.log("wallet USDso:", ethers.formatUnits(await usdso.balanceOf(wallet.address), quote.decimals));
  console.log("wallet WETH :", ethers.formatUnits(await weth.balanceOf(wallet.address), base.decimals));
  try { console.log("vault USDso :", ethers.formatUnits(await c.getWithdrawableBalance(wallet.address, quote.address), quote.decimals)); } catch (e) { console.log("vault USDso ERR", (e as Error).message.slice(0, 50)); }
  try { console.log("vault WETH  :", ethers.formatUnits(await c.getWithdrawableBalance(wallet.address, base.address), base.decimals)); } catch (e) { console.log("vault WETH ERR", (e as Error).message.slice(0, 50)); }
  try {
    const oo = await c.getOwnOpenOrders(wallet.address);
    console.log("OPEN ORDERS:", oo.length, oo.map((x: bigint) => x.toString()).join(","));
  } catch (e) { console.log("getOwnOpenOrders ERR:", (e as Error).message.slice(0, 60)); }

  // dump raw topic0 of most recent tx from our wallet to identify real OrderPlaced/Filled signatures
  const head = await p.getBlockNumber();
  const logs = await p.getLogs({ address: pool.poolAddress, fromBlock: head - 800, toBlock: head });
  const topicCount: Record<string, number> = {};
  for (const l of logs) { const t = l.topics[0] ?? "none"; topicCount[t] = (topicCount[t] ?? 0) + 1; }
  console.log("recent pool event topic0 histogram (last 800 blks):");
  for (const [t, n] of Object.entries(topicCount)) console.log(`  ${t}  x${n}`);
}
main().catch((e) => { console.error((e as Error).message ?? e); process.exit(1); });
