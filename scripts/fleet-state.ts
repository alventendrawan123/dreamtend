import "dotenv/config";
import { ethers } from "ethers";
import { readFile } from "node:fs/promises";
import { getActiveNetwork } from "../src/config/network.js";
import { getToken } from "../src/config/tokens.js";
import { POOLS } from "../src/config/pairs.js";
import { logger } from "../src/utils/logger.js";

interface BotWallet {
  id: number;
  address: string;
  privateKey: string;
  role: string;
}

const FLEET_FILE = process.argv[2] ?? "data/bot-wallets.json";

const ROLE_POOL: Record<string, string> = {
  "mm-usdce-tight": "USDC.e:USDso",
  "mm-usdce-mid": "USDC.e:USDso",
  "mm-somi": "SOMI:USDso",
  "momentum-somi": "SOMI:USDso",
  reserve: "USDC.e:USDso",
};

const POOL_ABI = [
  "function getWithdrawableBalance(address account, address token) view returns (uint256)",
];

async function main(): Promise<void> {
  const network = getActiveNetwork();
  const provider = new ethers.JsonRpcProvider(network.rpc, {
    chainId: network.chainId,
    name: network.name,
  });

  const fleet = JSON.parse(await readFile(FLEET_FILE, "utf-8")) as { wallets: BotWallet[] };
  const usdso = getToken(network.name, "USDso");
  const usdsoErc = new ethers.Contract(
    usdso.address,
    ["function balanceOf(address) view returns (uint256)"],
    provider,
  );

  console.log("=".repeat(80));
  console.log(`Fleet state @ ${new Date().toISOString()}`);
  console.log("=".repeat(80));
  console.log(
    `ID | Role             | Native    | USDso wallet | USDso vault | Nonce | Pool`,
  );
  console.log("-".repeat(80));

  for (const w of fleet.wallets) {
    const native = await provider.getBalance(w.address);
    const walletUsdso: bigint = await (usdsoErc.balanceOf as ethers.BaseContractMethod<
      [string],
      bigint,
      bigint
    >)(w.address);
    const nonce = await provider.getTransactionCount(w.address);
    const poolSymbol = ROLE_POOL[w.role] ?? "USDC.e:USDso";
    const pool = POOLS[network.name][poolSymbol];
    let vaultUsdso = 0n;
    if (pool) {
      const c = new ethers.Contract(pool.poolAddress, POOL_ABI, provider);
      try {
        vaultUsdso = await (c.getWithdrawableBalance as ethers.BaseContractMethod<
          [string, string],
          bigint,
          bigint
        >)(w.address, usdso.address);
      } catch {
        /* ignore */
      }
    }

    console.log(
      `W${w.id} | ${w.role.padEnd(16)} | ${ethers.formatEther(native).padStart(8)} SOMI | ${ethers
        .formatUnits(walletUsdso, 18)
        .padStart(12)} | ${ethers.formatUnits(vaultUsdso, 18).padStart(11)} | ${String(
        nonce,
      ).padStart(5)} | ${poolSymbol}`,
    );
  }
  console.log("=".repeat(80));
}

main().catch((err) => {
  logger.fatal({ err: err.message ?? err });
  process.exit(1);
});
