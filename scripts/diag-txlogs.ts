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
  const iface = new ethers.Interface(SPOTPOOL_ABI);

  // wallet USDso now
  const erc = new ethers.Contract(quote.address, ["function balanceOf(address) view returns (uint256)"], p);
  console.log("wallet USDso now:", ethers.formatUnits(await erc.balanceOf(wallet.address), quote.decimals));

  for (const h of [
    "0x5c237b2ef3c1d1535bda2ccd48cd9b440222c1af67766395031a19f085a80016",
    "0xe6138756e04bf20c69eb06cae0a7b3f913481c9db9c8cbc6378d5d0f60bea17d",
  ]) {
    const r = await p.getTransactionReceipt(h);
    console.log(`\n=== tx ${h.slice(0, 14)} status=${r?.status} logs=${r?.logs.length} ===`);
    for (const log of r!.logs) {
      let parsed = "";
      try { const pl = iface.parseLog({ topics: [...log.topics], data: log.data }); if (pl) parsed = `${pl.name}(${pl.args.map((a) => a.toString()).join(",")})`; } catch { parsed = `unknown topic0=${log.topics[0]?.slice(0, 10)}`; }
      console.log(" ", parsed);
    }
  }
}
main().catch((e) => { console.error((e as Error).message ?? e); process.exit(1); });
