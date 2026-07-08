import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { getPool } from "../src/config/pairs.js";

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const p = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  const pool = getPool(net.name, "WETH:USDso");
  const PLACED = ethers.id("OrderPlaced(uint128,address,bool,uint8,uint256,uint256,uint64)");
  const head = await p.getBlockNumber();
  const hb = await p.getBlock(head);
  // block time: compare head vs head-1000
  const b2 = await p.getBlock(head - 1000);
  const dt = hb && b2 ? (Number(hb.timestamp) - Number(b2.timestamp)) / 1000 : 0;
  console.log(`head ${head} ts ${hb ? new Date(Number(hb.timestamp) * 1000).toISOString() : "-"}; ~${dt.toFixed(3)}s/block`);

  const chunk = 900;
  let from = head;
  let found = false;
  for (let i = 0; i < 60 && !found; i++) {
    const lo = from - chunk;
    try {
      const logs = await p.getLogs({ address: pool.poolAddress, fromBlock: lo, toBlock: from, topics: [PLACED] });
      if (logs.length) {
        const last = logs[logs.length - 1];
        const blk = await p.getBlock(last.blockNumber);
        const ago = (Number(hb!.timestamp) - Number(blk!.timestamp));
        console.log(`LAST OrderPlaced @block ${last.blockNumber}, ts ${new Date(Number(blk!.timestamp) * 1000).toISOString()}, ${(ago / 3600).toFixed(1)}h ago (${head - last.blockNumber} blks back)`);
        found = true;
        break;
      }
    } catch { /* skip */ }
    from = lo - 1;
  }
  if (!found) console.log(`No OrderPlaced in last ${60 * chunk} blocks (~${(60 * chunk * dt / 3600).toFixed(1)}h)`);
}
main().catch((e) => { console.error((e as Error).message ?? e); process.exit(1); });
