import { createPublicClient, http, parseAbi, decodeFunctionData, getAddress } from "viem";

const client = createPublicClient({ transport: http(process.env.RELAY_RPC_URL || "https://rpc.chain.relay.link", { timeout: 60000, retryCount: 4 }) });
const expectedChain = 537713;
if (await client.getChainId() !== expectedChain) throw new Error("Wrong chain");

const inbox = getAddress("0x30e6cd00d0f6553884b151c1b1b74fd59369ff41");
const limiter = getAddress("0x23afd9e0348c058eba84c434d9c6b508cea764e6");
const legacyOracle = getAddress("0xd180dc3b8cb71b185c563b6e4857592ca93dAcAf".toLowerCase());
const candidates = [
  inbox,
  legacyOracle,
  getAddress("0x613d3c588f6b8f89302b463f8f19f7241b2857e2"),
  getAddress("0xa68dcb6ca9a7bc8cac147688f1cbfe68524b38c8"),
  getAddress("0x946773048565893b6b6051a485c52e32e43cc2fe")
];
const abi = parseAbi([
  "event FastMint(bytes32 indexed idempotencyKey,address hubToAddress,uint256 hubTokenId,uint256 amount,uint256 feeCurrency,uint256 feeAmount,address feeRecipient,address feePayer)",
  "event TokensConsumed(string indexed chainId,uint256 usdAmount,uint256 remaining)",
  "event RoleGranted(bytes32 indexed role,address indexed account,address indexed sender)",
  "event RoleRevoked(bytes32 indexed role,address indexed account,address indexed sender)",
  "function CONSUMER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)"
]);
const aggregate3Abi = parseAbi(["function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)"]);
const aggregateAbi = parseAbi(["function aggregate((address target,bytes callData)[] calls) payable returns (bytes[] returnData)"]);
const aggregate3ValueAbi = parseAbi(["function aggregate3Value((address target,bool allowFailure,uint256 value,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)"]);

const latest = await client.getBlockNumber();
const from = latest > 50000n ? latest - 50000n : 0n;
const [fast, consumed, roleId] = await Promise.all([
  client.getLogs({ address: inbox, event: abi[0], fromBlock: from, toBlock: latest }),
  client.getLogs({ address: limiter, event: abi[1], fromBlock: from, toBlock: latest }),
  client.readContract({ address: limiter, abi: [abi[4]], functionName: "CONSUMER_ROLE" })
]);
const fastTx = new Set(fast.map(x => x.transactionHash.toLowerCase()));
const extras = consumed.filter(x => !fastTx.has(x.transactionHash.toLowerCase()));
const uniqueTxs = [...new Set(extras.map(x => x.transactionHash))];

const roleChanges = [];
for (let start = from; start <= latest; start += 5000n) {
  const end = start + 4999n > latest ? latest : start + 4999n;
  const [grants, revokes] = await Promise.all([
    client.getLogs({ address: limiter, event: abi[2], args: { role: roleId }, fromBlock: start, toBlock: end }),
    client.getLogs({ address: limiter, event: abi[3], args: { role: roleId }, fromBlock: start, toBlock: end })
  ]);
  for (const x of grants) roleChanges.push({ kind: "grant", account: x.args.account, sender: x.args.sender, block: x.blockNumber.toString(), tx: x.transactionHash });
  for (const x of revokes) roleChanges.push({ kind: "revoke", account: x.args.account, sender: x.args.sender, block: x.blockNumber.toString(), tx: x.transactionHash });
}
const candidateRoles = {};
for (const a of candidates) candidateRoles[a] = await client.readContract({ address: limiter, abi: [abi[5]], functionName: "hasRole", args: [roleId, a] });

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i]); }
      catch (e) { out[i] = { error: String(e?.shortMessage || e?.message || e) }; }
    }
  }));
  return out;
}
const txDetails = await mapLimit(uniqueTxs, 8, async hash => {
  const tx = await client.getTransaction({ hash });
  const input = tx.input;
  let nested = [];
  let outerKind = "direct-or-unknown";
  for (const [kind, a] of [["aggregate3", aggregate3Abi], ["aggregate", aggregateAbi], ["aggregate3Value", aggregate3ValueAbi]]) {
    try {
      const d = decodeFunctionData({ abi: a, data: input });
      outerKind = kind;
      const calls = d.args[0];
      nested = calls.map(c => ({
        target: getAddress(c.target),
        selector: (c.callData || "").slice(0, 10),
        calldataBytes: Math.max(0, ((c.callData || "").length - 2) / 2)
      }));
      break;
    } catch {}
  }
  if (!nested.length) nested = [{ target: tx.to ? getAddress(tx.to) : null, selector: input.slice(0, 10), calldataBytes: Math.max(0, (input.length - 2) / 2) }];
  return { hash, block: tx.blockNumber?.toString(), from: tx.from, to: tx.to, outerKind, nested };
});
const targetCounts = {}, selectorCounts = {}, outerCounts = {};
for (const tx of txDetails) {
  if (tx.error) continue;
  outerCounts[tx.outerKind] = (outerCounts[tx.outerKind] || 0) + 1;
  for (const c of tx.nested) {
    const k = c.target || "null";
    targetCounts[k] = (targetCounts[k] || 0) + 1;
    selectorCounts[c.selector] = (selectorCounts[c.selector] || 0) + 1;
  }
}
const perTxEvents = new Map();
for (const e of extras) {
  const k = e.transactionHash.toLowerCase();
  if (!perTxEvents.has(k)) perTxEvents.set(k, []);
  perTxEvents.get(k).push({ block: e.blockNumber.toString(), chainIdHash: e.topics[1], usdAmount: e.args.usdAmount.toString(), remaining: e.args.remaining.toString() });
}
console.log(JSON.stringify({
  chainId: expectedChain, fromBlock: from.toString(), toBlock: latest.toString(),
  fastMintEvents: fast.length, limiterConsumeEvents: consumed.length, unmatchedLimiterEvents: extras.length,
  uniqueUnmatchedTransactions: uniqueTxs.length, consumerRole: roleId,
  consumerRoleHistoryInWindow: roleChanges, currentCandidateRoles: candidateRoles,
  outerCallTypes: outerCounts, nestedTargetCounts: targetCounts, nestedSelectorCounts: selectorCounts,
  txDecodeFailures: txDetails.filter(x => x.error).length,
  unmatchedTransactionDetails: txDetails,
  unmatchedEventsByTransaction: Object.fromEntries(perTxEvents)
}, null, 2));
