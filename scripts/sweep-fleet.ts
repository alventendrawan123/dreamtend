import "dotenv/config";
import { ethers } from "ethers";
import { readFile } from "node:fs/promises";
import { getActiveNetwork } from "../src/config/network.js";
import { getToken } from "../src/config/tokens.js";
import { POOLS } from "../src/config/pairs.js";
import { SPOTPOOL_ABI } from "../src/dex/abi/spotpool.js";
import { logger } from "../src/utils/logger.js";

interface BotWallet {
  id: number;
  address: string;
  privateKey: string;
  role: string;
}

const FLEET_FILE = process.argv[2] ?? "data/bot-wallets.json";
const REGISTERED_WALLET = process.env.WALLET_ADDRESS ??
  "0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86";

const TRANSFER_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
];

async function main(): Promise<void> {
  const network = getActiveNetwork();
  const provider = new ethers.JsonRpcProvider(network.rpc, {
    chainId: network.chainId,
    name: network.name,
  });

  const fleet = JSON.parse(await readFile(FLEET_FILE, "utf-8")) as { wallets: BotWallet[] };
  const usdso = getToken(network.name, "USDso");

  const tokensToSweep = ["USDso", "USDC.e"]
    .map((sym) => {
      try {
        return getToken(network.name, sym);
      } catch {
        return undefined;
      }
    })
    .filter((t): t is NonNullable<typeof t> => t !== undefined);

  for (const w of fleet.wallets) {
    const wallet = new ethers.Wallet(w.privateKey, provider);
    logger.info({ id: w.id, address: w.address, role: w.role }, "Sweeping wallet");

    for (const pool of Object.values(POOLS[network.name])) {
      try {
        const c = new ethers.Contract(pool.poolAddress, SPOTPOOL_ABI, wallet);
        for (const tok of tokensToSweep) {
          const bal: bigint = await (c.getWithdrawableBalance as ethers.BaseContractMethod<
            [string, string],
            bigint,
            bigint
          >)(w.address, tok.address);
          if (bal > 0n) {
            logger.info(
              { id: w.id, pool: pool.symbol, token: tok.symbol, raw: bal.toString() },
              "Withdrawing from vault",
            );
            const tx = await (c.withdraw as ethers.BaseContractMethod<
              [string, bigint],
              void,
              ethers.ContractTransactionResponse
            >)(tok.address, bal);
            await tx.wait();
          }
        }
      } catch (err) {
        logger.warn(
          { id: w.id, pool: pool.symbol, err: (err as Error).message },
          "Skipping pool",
        );
      }
    }

    for (const tok of tokensToSweep) {
      try {
        const erc = new ethers.Contract(tok.address, TRANSFER_ABI, wallet);
        const bal: bigint = await (erc.balanceOf as ethers.BaseContractMethod<
          [string],
          bigint,
          bigint
        >)(w.address);
        if (bal > 0n) {
          logger.info(
            { id: w.id, token: tok.symbol, amount: ethers.formatUnits(bal, tok.decimals) },
            "Transferring ERC20 to registered wallet",
          );
          const tx = await (erc.transfer as ethers.BaseContractMethod<
            [string, bigint],
            boolean,
            ethers.ContractTransactionResponse
          >)(REGISTERED_WALLET, bal);
          await tx.wait();
        }
      } catch (err) {
        logger.warn(
          { id: w.id, token: tok.symbol, err: (err as Error).message },
          "ERC20 sweep failed",
        );
      }
    }

    try {
      const nativeBal = await provider.getBalance(w.address);
      const reserve = ethers.parseEther("0.01");
      if (nativeBal > reserve) {
        const amount = nativeBal - reserve;
        logger.info(
          { id: w.id, amount: ethers.formatEther(amount) },
          "Returning native SOMI to registered wallet",
        );
        const tx = await wallet.sendTransaction({
          to: REGISTERED_WALLET,
          value: amount,
        });
        await tx.wait();
      }
    } catch (err) {
      logger.warn({ id: w.id, err: (err as Error).message }, "Native sweep failed");
    }
  }

  logger.info({ usdsoAddress: usdso.address }, "Fleet sweep complete");
}

main().catch((err) => {
  logger.fatal({ err: err.message ?? err });
  process.exit(1);
});
