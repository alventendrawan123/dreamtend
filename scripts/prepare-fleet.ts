import "dotenv/config";
import { ethers } from "ethers";
import { readFile } from "node:fs/promises";
import { getActiveNetwork } from "../src/config/network.js";
import { getToken } from "../src/config/tokens.js";
import { getPool } from "../src/config/pairs.js";
import { logger } from "../src/utils/logger.js";

interface BotWallet {
  id: number;
  address: string;
  privateKey: string;
  role: string;
}

const ROLE_POOL: Record<string, string> = {
  "mm-usdce-tight": "USDC.e:USDso",
  "mm-usdce-mid": "USDC.e:USDso",
  "mm-somi": "SOMI:USDso",
  "momentum-somi": "SOMI:USDso",
  reserve: "USDC.e:USDso",
};

const FLEET_FILE = process.argv[2] ?? "data/bot-wallets.json";
const USDSO_TO_DEPOSIT = process.argv[3] ?? "1.5";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];
const POOL_DEPOSIT_ABI = ["function deposit(address token, uint256 amount)"];

async function main(): Promise<void> {
  const network = getActiveNetwork();
  const provider = new ethers.JsonRpcProvider(network.rpc, {
    chainId: network.chainId,
    name: network.name,
  });

  const fleet = JSON.parse(await readFile(FLEET_FILE, "utf-8")) as { wallets: BotWallet[] };
  const usdso = getToken(network.name, "USDso");
  const amount = ethers.parseUnits(USDSO_TO_DEPOSIT, usdso.decimals);

  for (const w of fleet.wallets) {
    if (w.role === "reserve") {
      logger.info({ id: w.id }, "Skipping reserve wallet (no auto-deposit)");
      continue;
    }

    const poolSymbol = ROLE_POOL[w.role] ?? "USDC.e:USDso";
    const pool = getPool(network.name, poolSymbol);
    const signer = new ethers.Wallet(w.privateKey, provider);

    logger.info(
      { id: w.id, role: w.role, poolSymbol, depositAmount: USDSO_TO_DEPOSIT },
      "Preparing wallet — approve + deposit",
    );

    try {
      const erc = new ethers.Contract(usdso.address, ERC20_ABI, signer);
      const allow = await (erc.allowance as ethers.BaseContractMethod<
        [string, string],
        bigint,
        bigint
      >)(w.address, pool.poolAddress);

      if (allow < amount) {
        const approveTx = await (erc.approve as ethers.BaseContractMethod<
          [string, bigint],
          boolean,
          ethers.ContractTransactionResponse
        >)(pool.poolAddress, amount);
        await approveTx.wait();
        logger.info({ id: w.id }, "Approved");
      }

      const poolC = new ethers.Contract(pool.poolAddress, POOL_DEPOSIT_ABI, signer);
      const depositTx = await (poolC.deposit as ethers.BaseContractMethod<
        [string, bigint],
        void,
        ethers.ContractTransactionResponse
      >)(usdso.address, amount);
      const receipt = await depositTx.wait();
      logger.info(
        { id: w.id, txHash: receipt?.hash },
        `Deposited ${USDSO_TO_DEPOSIT} USDso → ${poolSymbol} vault`,
      );
    } catch (err) {
      logger.error({ id: w.id, err: (err as Error).message }, "Prepare failed");
    }
  }

  logger.info("Fleet prepare complete");
}

main().catch((err) => {
  logger.fatal({ err: err.message ?? err });
  process.exit(1);
});
