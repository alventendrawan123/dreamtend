import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { getPool } from "../src/config/pairs.js";

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const p = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  const pool = getPool(net.name, "WETH:USDso");
  const FILLED = ethers.id("OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)");
  const PLACED = "0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d"; // OrderPlaced(uint128 indexed, Order tuple)
  const head = await p.getBlockNumber();
  console.log("head block:", head);
  const span = Number(process.argv[2] ?? "500");
  for (const [name, topic] of [["OrderFilled", FILLED], ["OrderPlaced", PLACED]] as const) {
    try {
      const logs = await p.getLogs({ address: pool.poolAddress, fromBlock: head - span, toBlock: head, topics: [topic] });
      const latest = logs.length ? logs[logs.length - 1].blockNumber : 0;
      console.log(`${name}: ${logs.length} in last ${span} blks; latest@${latest} (${latest ? head - latest : "-"} ago)`);
    } catch (e) { console.log(`${name}: ERR ${(e as Error).message.slice(0, 90)}`); }
  }
  const b = await p.getBlock(head);
  console.log("head ts:", b?.timestamp?.toString(), b ? new Date(Number(b.timestamp) * 1000).toISOString() : "-");
}
main().catch((e) => { console.error((e as Error).message ?? e); process.exit(1); });
