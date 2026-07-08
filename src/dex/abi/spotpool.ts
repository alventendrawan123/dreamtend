export const SPOTPOOL_ABI = [
  "function placeOrder(bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) returns (bool success, uint128 orderId)",
  "function placeTakerOrderWithoutVault(bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) payable returns (bool success, uint128 orderId)",
  "function cancelOrder(uint128 orderId)",
  "function reduceOrder(uint128 orderId, uint256 newQuantityRemaining)",

  "function deposit(address token, uint256 amount)",
  "function depositNative() payable",
  "function withdraw(address token, uint256 amount)",
  "function approve(address spender, uint256 amount)",

  // NOTE: confirmed on-chain 2026-06-24 — tail order is (tickSize, MINQUANTITY, LOTSIZE);
  // earlier ABI had lotSize/minQuantity swapped. getBookLevels is (bool,uint64)->struct[];
  // getOwnOpenOrders is NO-ARG (the (address) form bare-reverts).
  "function getPoolParams() view returns (address baseToken, address quoteToken, uint256 makerFeeBpsTimes1k, uint256 takerFeeBpsTimes1k, uint256 tickSize, uint256 minQuantity, uint256 lotSize)",
  "function getBookLevels(bool isBid, uint64 depth) view returns (tuple(uint256 price, uint256 quantity)[] levels)",
  "function getOwnOpenOrders() view returns (uint128[])",
  "function getWithdrawableBalance(address account, address token) view returns (uint256)",
  "function getOrder(uint128 orderId) view returns (tuple(address owner, bool isBid, uint8 orderType, uint256 price, uint256 quantity, uint256 remaining, uint64 expireTimestampNs, uint64 userData))",

  "event OrderPlaced(uint128 indexed orderId, tuple(uint128 orderId, bool isBid, address owner, uint64 userData, uint256 price, uint256 fullQuantity, uint256 quantityRemaining, uint64 expireTimestampNs) order)",
  "event OrderRested(uint128 indexed orderId)",
  "event OrderFilled(uint128 indexed takerOrderId, uint128 indexed makerOrderId, uint256 quantityFilled, uint256 takerRemaining, uint256 makerRemaining, uint256 fillPrice)",
  "event OrderCancelled(uint128 indexed orderId)",
  "event OrderExpired(uint128 indexed orderId)",
  "event OrderReduced(uint128 indexed orderId, uint256 newQuantity)",
  "event MarkPriceUpdated(address indexed asset, uint256 markPrice, uint256 rawMidpoint)",
] as const;
