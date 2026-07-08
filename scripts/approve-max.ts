import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { getPool } from "../src/config/pairs.js";
import { getToken } from "../src/config/tokens.js";
import { logger } from "../src/utils/logger.js";

// Approve uint256.max for BASE + QUOTE tokens to the given pool.
// One-shot fix so the IOC engine never hits "ERC20: insufficient allowance"
// mid-run again. Use sparingly — max approval is a security trade-off, only
// for trusted pool contracts.
//
// Usage: NETWORK=mainnet npx tsx scripts/approve-max.ts <POOL_SYMBOL>
//   e.g. NETWORK=mainnet npx tsx scripts/approve-max.ts WETH:USDso

const POOL_SYMBOL = process.argv[2] ?? "WETH:USDso";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function symbol() view returns (string)",
];

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const provider = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const pool = getPool(net.name, POOL_SYMBOL);
  const baseTok = getToken(net.name, pool.base);
  const quoteTok = getToken(net.name, pool.quote);

  const MAX = ethers.MaxUint256;

  logger.info({ pool: POOL_SYMBOL, addr: pool.poolAddress, wallet: wallet.address }, "Approving max to pool");

  // QUOTE token (USDso) — always needed for BUY leg
  const quoteErc = new ethers.Contract(quoteTok.address, ERC20_ABI, wallet) as ethers.Contract & {
    allowance: (owner: string, spender: string) => Promise<bigint>;
    approve: (spender: string, amount: bigint) => Promise<ethers.ContractTransactionResponse>;
  };
  const quoteAllowance = await quoteErc.allowance(wallet.address, pool.poolAddress);
  logger.info({ token: quoteTok.symbol, current: ethers.formatUnits(quoteAllowance, quoteTok.decimals) }, "current allowance");
  if (quoteAllowance < MAX / 2n) {
    const tx = await quoteErc.approve(pool.poolAddress, MAX);
    logger.info({ tx: tx.hash }, "approve quote broadcast");
    const r = await tx.wait();
    logger.info({ status: r?.status, block: r?.blockNumber }, "approve quote confirmed");
  } else {
    logger.info("quote already at max — skipping");
  }

  // BASE token (skip if native — no ERC20 to approve)
  if (!baseTok.isNative) {
    const baseErc = new ethers.Contract(baseTok.address, ERC20_ABI, wallet) as ethers.Contract & {
      allowance: (owner: string, spender: string) => Promise<bigint>;
      approve: (spender: string, amount: bigint) => Promise<ethers.ContractTransactionResponse>;
    };
    const baseAllowance = await baseErc.allowance(wallet.address, pool.poolAddress);
    logger.info({ token: baseTok.symbol, current: ethers.formatUnits(baseAllowance, baseTok.decimals) }, "current allowance");
    if (baseAllowance < MAX / 2n) {
      const tx = await baseErc.approve(pool.poolAddress, MAX);
      logger.info({ tx: tx.hash }, "approve base broadcast");
      const r = await tx.wait();
      logger.info({ status: r?.status, block: r?.blockNumber }, "approve base confirmed");
    } else {
      logger.info("base already at max — skipping");
    }
  } else {
    logger.info({ token: baseTok.symbol }, "base is native — no ERC20 approval needed (uses msg.value)");
  }

  logger.info("approve-max done");
}

main().catch((err) => {
  logger.fatal({ err: err.message ?? err });
  process.exit(1);
});
