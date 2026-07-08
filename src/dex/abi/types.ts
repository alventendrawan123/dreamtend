import type { ethers } from "ethers";

export interface SpotPoolMethods {
  placeOrder: ethers.BaseContractMethod<
    [
      boolean,
      bigint,
      bigint,
      bigint,
      bigint,
      number,
      number,
      string,
      bigint,
    ],
    [boolean, bigint],
    ethers.ContractTransactionResponse
  >;
  placeTakerOrderWithoutVault: ethers.BaseContractMethod<
    [
      boolean,
      bigint,
      bigint,
      bigint,
      bigint,
      number,
      number,
      string,
      bigint,
    ],
    [boolean, bigint],
    ethers.ContractTransactionResponse
  >;
  cancelOrder: ethers.BaseContractMethod<
    [bigint],
    void,
    ethers.ContractTransactionResponse
  >;
  reduceOrder: ethers.BaseContractMethod<
    [bigint, bigint],
    void,
    ethers.ContractTransactionResponse
  >;
  deposit: ethers.BaseContractMethod<
    [string, bigint],
    void,
    ethers.ContractTransactionResponse
  >;
  depositNative: ethers.BaseContractMethod<
    [],
    void,
    ethers.ContractTransactionResponse
  >;
  withdraw: ethers.BaseContractMethod<
    [string, bigint],
    void,
    ethers.ContractTransactionResponse
  >;
  approve: ethers.BaseContractMethod<
    [string, bigint],
    void,
    ethers.ContractTransactionResponse
  >;
  // tuple order is (baseToken, quoteToken, makerFeeBpsTimes1k, takerFeeBpsTimes1k, tickSize, minQuantity, lotSize)
  getPoolParams: ethers.BaseContractMethod<
    [],
    [string, string, bigint, bigint, bigint, bigint, bigint],
    [string, string, bigint, bigint, bigint, bigint, bigint]
  >;
  getBookLevels: ethers.BaseContractMethod<
    [boolean, bigint],
    Array<[bigint, bigint]>,
    Array<[bigint, bigint]>
  >;
  getOwnOpenOrders: ethers.BaseContractMethod<[], bigint[], bigint[]>;
  getWithdrawableBalance: ethers.BaseContractMethod<
    [string, string],
    bigint,
    bigint
  >;
}

export type SpotPoolContract = ethers.Contract & SpotPoolMethods;

export interface Erc20Methods {
  name: ethers.BaseContractMethod<[], string, string>;
  symbol: ethers.BaseContractMethod<[], string, string>;
  decimals: ethers.BaseContractMethod<[], bigint, bigint>;
  balanceOf: ethers.BaseContractMethod<[string], bigint, bigint>;
  allowance: ethers.BaseContractMethod<[string, string], bigint, bigint>;
  approve: ethers.BaseContractMethod<
    [string, bigint],
    boolean,
    ethers.ContractTransactionResponse
  >;
  transfer: ethers.BaseContractMethod<
    [string, bigint],
    boolean,
    ethers.ContractTransactionResponse
  >;
}

export type Erc20Contract = ethers.Contract & Erc20Methods;
