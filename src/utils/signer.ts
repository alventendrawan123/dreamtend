import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork, type NetworkConfig } from "../config/network.js";
import { logger } from "./logger.js";

export interface ChainContext {
  network: NetworkConfig;
  provider: ethers.JsonRpcProvider;
  wallet?: ethers.Wallet;
  address?: string;
}

let cached: ChainContext | undefined;

export async function getChainContext(opts: { requireSigner?: boolean } = {}): Promise<ChainContext> {
  if (cached) return cached;

  const network = getActiveNetwork();
  const provider = new ethers.JsonRpcProvider(network.rpc, {
    chainId: network.chainId,
    name: network.name,
  });

  const observed = await provider.getNetwork();
  if (Number(observed.chainId) !== network.chainId) {
    throw new Error(
      `RPC chainId mismatch: expected ${network.chainId}, got ${observed.chainId}`,
    );
  }

  const privKey = process.env.PRIVATE_KEY?.trim();
  if (!privKey) {
    if (opts.requireSigner) {
      throw new Error(
        "PRIVATE_KEY is empty — cannot create signer. Set it in .env to perform write operations.",
      );
    }
    logger.warn(
      "PRIVATE_KEY not set — read-only context (no signer attached)",
    );
    cached = { network, provider };
    return cached;
  }

  const wallet = new ethers.Wallet(privKey, provider);
  const expected = process.env.WALLET_ADDRESS?.toLowerCase();
  if (expected && wallet.address.toLowerCase() !== expected) {
    throw new Error(
      `Wallet address mismatch: derived ${wallet.address} but WALLET_ADDRESS=${expected}`,
    );
  }

  logger.info(
    { address: wallet.address, chainId: network.chainId },
    "Signer initialized",
  );

  cached = { network, provider, wallet, address: wallet.address };
  return cached;
}

export function resetChainContext(): void {
  cached = undefined;
}
