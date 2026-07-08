import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { TOKENS } from "../src/config/tokens.js";

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const p = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  const REG = process.env.WALLET_ADDRESS ?? new ethers.Wallet(process.env.PRIVATE_KEY!).address;
  const erc20 = ["function balanceOf(address) view returns (uint256)"];

  console.log(`Registered wallet ${REG} — all token balances (mainnet)`);
  console.log("-".repeat(60));

  for (const sym of ["WETH", "WBTC", "USDC.e", "USDso"]) {
    const t = TOKENS[net.name][sym];
    if (!t) continue;
    const c = new ethers.Contract(t.address, erc20, p);
    const bal = (await c.balanceOf!(REG)) as bigint;
    console.log(`${sym.padEnd(8)}: ${ethers.formatUnits(bal, t.decimals)}`);
  }
  const native = await p.getBalance(REG);
  console.log(`SOMI    : ${ethers.formatEther(native)}  (native)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
