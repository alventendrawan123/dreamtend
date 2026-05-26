import { ethers } from "ethers";

export function toRaw(amount: number | string, decimals: number): bigint {
  return ethers.parseUnits(amount.toString(), decimals);
}

export function fromRaw(raw: bigint, decimals: number): string {
  return ethers.formatUnits(raw, decimals);
}

export function fromRawAsNumber(raw: bigint, decimals: number): number {
  return Number(fromRaw(raw, decimals));
}

export function bpsToFraction(bps: number): number {
  return bps / 10_000;
}

export function fractionToBps(frac: number): number {
  return Math.round(frac * 10_000);
}
