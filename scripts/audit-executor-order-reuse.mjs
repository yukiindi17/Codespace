import { createPublicClient, http, parseAbi, getAddress } from "viem";

const RPC = process.env.RELAY_RPC_URL || "https://rpc.chain.relay.link";
const client = createPublicClient({ transport: http(RPC, { timeout: 30_000 }) });
const expected = 537713;
const chainId = await client.getChainId();
if (chainId !== expected) throw new Error(`Wrong chain id ${chainId}`);

const executor = getAddress("0x946773048565893b6B6051A485c52e32e43cC2Fe");
const abi = parseAbi([
  "event Executed(address indexed orderAddress,uint256 indexed tokenInId,uint256 indexed tokenOutId,uint256 orderBalance,uint256 withdrawAmount,bytes32 withdrawRequestHash)",
  "event OrderFeeCharged(address indexed orderAddress,address indexed recipient,uint256 indexed tokenId,uint256 amount)"
]);
const latest = await client.getBlockNumber();
const from = latest > 50000n ? latest - 50000n : 0n;
const [execLogs, feeLogs] = await Promise.all([
  client.getLogs({ address: executor, event: abi[0], fromBlock: from, toBlock: latest }),
  client.getLogs({ address: executor, event: abi[1], fromBlock: from, toBlock: latest })
]);
const byOrder = new Map();
for (const l of execLogs) {
  const a = l.args.orderAddress.toLowerCase();
  if (!byOrder.has(a)) byOrder.set(a, { orderAddress: l.args.orderAddress, executions: 0, tokenInIds: new Set(), tokenOutIds: new Set(), txs: [], totalInput: 0n, totalOutput: 0n });
  const x = byOrder.get(a);
  x.executions++;
  x.tokenInIds.add(l.args.tokenInId.toString());
  x.tokenOutIds.add(l.args.tokenOutId.toString());
  x.totalInput += l.args.orderBalance;
  x.totalOutput += l.args.withdrawAmount;
  if (x.txs.length < 8) x.txs.push({ tx: l.transactionHash, block: l.blockNumber.toString(), tokenInId: l.args.tokenInId.toString(), tokenOutId: l.args.tokenOutId.toString(), input: l.args.orderBalance.toString(), output: l.args.withdrawAmount.toString() });
}
const feesByOrder = new Map();
for (const l of feeLogs) {
  const a = l.args.orderAddress.toLowerCase();
  if (!feesByOrder.has(a)) feesByOrder.set(a, []);
  feesByOrder.get(a).push({ tokenId: l.args.tokenId.toString(), amount: l.args.amount.toString(), tx: l.transactionHash, block: l.blockNumber.toString() });
}
const repeated = [...byOrder.values()].filter(x => x.executions > 1).map(x => ({
  orderAddress: x.orderAddress, executions: x.executions,
  distinctInputTokens: [...x.tokenInIds], distinctOutputTokens: [...x.tokenOutIds],
  feeEvents: feesByOrder.get(x.orderAddress.toLowerCase()) || [],
  sampleTransactions: x.txs, totalInput: x.totalInput.toString(), totalOutput: x.totalOutput.toString()
}));
const crossTokenReuse = repeated.filter(x => x.distinctInputTokens.length > 1);
const report = {
  chainId, executor, fromBlock: from.toString(), toBlock: latest.toString(),
  executedEventCount: execLogs.length, feeEventCount: feeLogs.length,
  uniqueOrderAddresses: byOrder.size, repeatedOrderAddressCount: repeated.length,
  repeatedAcrossInputTokens: crossTokenReuse.length,
  repeatedAcrossInputTokensSamples: crossTokenReuse.slice(0, 30),
  repeatedSameTokenSamples: repeated.filter(x => x.distinctInputTokens.length === 1).slice(0, 15)
};
console.log(JSON.stringify(report, (_,v) => typeof v === "bigint" ? v.toString() : v, 2));
