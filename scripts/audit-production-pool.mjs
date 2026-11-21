import {
  createPublicClient,
  http,
  parseAbi,
  getAddress,
  formatUnits,
} from "viem";

const RPC = process.env.RELAY_RPC_URL || "https://rpc.chain.relay.link";
const CHAIN_ID = 537713;
const RESOLVER = getAddress("0xbc8aa4624a503d5c85bbf0e969f141da60216af9");

const poolEvents = parseAbi([
  "event DrawResolverSet(address indexed account,address indexed resolver,bool allowed)",
  "event DrawConfigSet(address indexed account,address indexed token,address authorizer,uint256 perOrderCap,uint256 budget,uint64 expiry)",
  "event Drawn(address indexed orderAddress,address indexed account,address indexed token,bytes32 requestHash,address resolver,uint8 kind,uint256 legIndex,uint256 amount)",
  "event Credited(address indexed orderAddress,address indexed account,address indexed token,bytes32 requestHash,address resolver,uint8 kind,uint256 legIndex,uint256 amount,uint256 restored,uint256 budgetRestored)",
]);
const resolverEvents = parseAbi([
  "event DrawLegExecuted(address indexed orderAddress,address indexed pool,address indexed account,bytes32 requestHash,uint8 kind,address tokenIn,address tokenOut,uint256 amountDrawn,uint256 amountCredited)",
]);
const readAbi = parseAbi([
  "function drawConfig(address account,address token) view returns (uint256 perOrderCap,uint256 budget,address authorizer,uint64 expiry)",
  "function drawResolvers(address account,address resolver) view returns (bool)",
  "function drawNonces(address account) view returns (uint256)",
  "function balances(address account,address token) view returns (uint256)",
  "function RESOLVER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
]);
const client = createPublicClient({ transport: http(RPC, { timeout: 60_000 }) });

async function scan(event, { address, args, fromBlock = 0n, toBlock, label }) {
  let cursor = fromBlock;
  let span = 200_000n;
  const all = [];
  while (cursor <= toBlock) {
    const end = cursor + span - 1n > toBlock ? toBlock : cursor + span - 1n;
    try {
      const batch = await client.getLogs({ event, address, args, fromBlock: cursor, toBlock: end });
      all.push(...batch);
      cursor = end + 1n;
    } catch (err) {
      if (span <= 2_000n) throw new Error(`${label} log scan failed at ${cursor}-${end}: ${err.shortMessage || err.message}`);
      span = span / 4n;
      console.log(`Reducing ${label} scan window to ${span} blocks after RPC limit`);
    }
  }
  return all;
}

const chainId = await client.getChainId();
if (chainId !== CHAIN_ID) throw new Error(`Wrong RPC chain: expected ${CHAIN_ID}, got ${chainId}`);
const latest = await client.getBlockNumber();
const resolverCode = await client.getCode({ address: RESOLVER });
if (!resolverCode || resolverCode === "0x") throw new Error("Production PoolDrawResolver has no runtime code at configured address");

console.log("PRODUCTION READ-ONLY AUDIT");
console.log(JSON.stringify({ chainId, latestBlock: latest.toString(), resolver: RESOLVER, resolverCodeBytes: (resolverCode.length - 2) / 2 }, null, 2));

const [allowLogs, legLogs] = await Promise.all([
  scan(poolEvents[0], { args: { resolver: RESOLVER }, toBlock: latest, label: "global DrawResolverSet" }),
  scan(resolverEvents[0], { address: RESOLVER, toBlock: latest, label: "resolver DrawLegExecuted" }),
]);
console.log(`Resolver allowlist events: ${allowLogs.length}; resolver leg events: ${legLogs.length}`);

const pools = [...new Set(allowLogs.map(x => getAddress(x.address)))];
const poolFirstBlock = new Map();
for (const log of allowLogs) {
  const p = getAddress(log.address);
  const b = log.blockNumber ?? 0n;
  if (!poolFirstBlock.has(p) || b < poolFirstBlock.get(p)) poolFirstBlock.set(p, b);
}
const legPools = [...new Set(legLogs.map(x => getAddress(x.args.pool)))];
for (const p of legPools) if (!pools.includes(p)) pools.push(p);
console.log("Pool candidates:", pools);

const allFindings = [];
for (const pool of pools) {
  const code = await client.getCode({ address: pool });
  if (!code || code === "0x") {
    console.log(`Skipping ${pool}: no code`);
    continue;
  }
  let resolverRole;
  try {
    resolverRole = await client.readContract({ address: pool, abi: readAbi, functionName: "RESOLVER_ROLE" });
    const holdsRole = await client.readContract({ address: pool, abi: readAbi, functionName: "hasRole", args: [resolverRole, RESOLVER] });
    if (!holdsRole) {
      console.log(`Candidate ${pool} does not currently grant RESOLVER_ROLE to production resolver`);
      continue;
    }
  } catch {
    console.log(`Skipping ${pool}: does not expose expected FundingPool role interface`);
    continue;
  }

  const fromBlock = poolFirstBlock.get(pool) ?? 0n;
  const [configs, draws, credits] = await Promise.all([
    scan(poolEvents[1], { address: pool, fromBlock, toBlock: latest, label: `DrawConfigSet ${pool}` }),
    scan(poolEvents[2], { address: pool, fromBlock, toBlock: latest, label: `Drawn ${pool}` }),
    scan(poolEvents[3], { address: pool, fromBlock, toBlock: latest, label: `Credited ${pool}` }),
  ]);

  const accountTokenPairs = new Map();
  for (const x of configs) accountTokenPairs.set(`${x.args.account.toLowerCase()}:${x.args.token.toLowerCase()}`, [x.args.account, x.args.token]);
  for (const x of legLogs.filter(x => getAddress(x.args.pool) === pool)) {
    for (const token of [x.args.tokenIn, x.args.tokenOut]) {
      accountTokenPairs.set(`${x.args.account.toLowerCase()}:${token.toLowerCase()}`, [x.args.account, token]);
    }
  }

  const activeConfigs = [];
  for (const [account, token] of accountTokenPairs.values()) {
    try {
      const [cfg, allowed, nonce, balance] = await Promise.all([
        client.readContract({ address: pool, abi: readAbi, functionName: "drawConfig", args: [account, token] }),
        client.readContract({ address: pool, abi: readAbi, functionName: "drawResolvers", args: [account, RESOLVER] }),
        client.readContract({ address: pool, abi: readAbi, functionName: "drawNonces", args: [account] }),
        client.readContract({ address: pool, abi: readAbi, functionName: "balances", args: [account, token] }),
      ]);
      if (allowed || cfg.authorizer !== "0x0000000000000000000000000000000000000000") {
        activeConfigs.push({
          account, token, resolverAllowed: allowed, authorizer: cfg.authorizer,
          perOrderCap: cfg.perOrderCap.toString(), budget: cfg.budget.toString(),
          expiry: cfg.expiry.toString(), drawNonce: nonce.toString(), accountPoolBalance: balance.toString(),
        });
      }
    } catch (err) {
      console.log(`State read failed for ${pool} ${account} ${token}: ${err.shortMessage || err.message}`);
    }
  }

  const drawnKeys = new Set(draws.filter(x => getAddress(x.args.resolver) === RESOLVER).map(x =>
    [x.args.orderAddress, x.args.account, x.args.token, x.args.legIndex.toString()].map(v => String(v).toLowerCase()).join(":")
  ));
  const unpairedCredits = credits.filter(x => {
    if (getAddress(x.args.resolver) !== RESOLVER) return false;
    if (x.args.orderAddress === "0x0000000000000000000000000000000000000000") return false;
    const key = [x.args.orderAddress, x.args.account, x.args.token, x.args.legIndex.toString()].map(v => String(v).toLowerCase()).join(":");
    return !drawnKeys.has(key);
  }).map(x => ({
    block: x.blockNumber?.toString(), tx: x.transactionHash,
    order: x.args.orderAddress, account: x.args.account, token: x.args.token,
    legIndex: x.args.legIndex.toString(), kind: x.args.kind,
    amount: x.args.amount.toString(), requestHash: x.args.requestHash,
  }));

  allFindings.push({ pool, fromBlock: fromBlock.toString(), resolverRole, configEvents: configs.length,
    drawsByResolver: draws.filter(x => getAddress(x.args.resolver) === RESOLVER).length,
    creditsByResolver: credits.filter(x => getAddress(x.args.resolver) === RESOLVER).length,
    activeConfigs, unpairedCredits });
}

const tokenSet = new Set();
for (const x of legLogs) {
  tokenSet.add(getAddress(x.args.tokenIn));
  tokenSet.add(getAddress(x.args.tokenOut));
}
const resolverTokenBalances = [];
for (const token of tokenSet) {
  try {
    const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"]);
    const [balance, decimals] = await Promise.all([
      client.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [RESOLVER] }),
      client.readContract({ address: token, abi: tokenAbi, functionName: "decimals" }),
    ]);
    if (balance > 0n) resolverTokenBalances.push({ token, balance: balance.toString(), formatted: formatUnits(balance, decimals), decimals });
  } catch (err) {
    resolverTokenBalances.push({ token, readError: err.shortMessage || err.message });
  }
}

console.log("POOL AUDIT RESULTS");
console.log(JSON.stringify(allFindings, null, 2));
console.log("CURRENT RESOLVER BALANCES FOR TOKENS SEEN IN DRAW LEGS");
console.log(JSON.stringify(resolverTokenBalances, null, 2));
console.log("Interpretation: unpaired nonzero-order Credited events are candidates for credits without a same-order/account/token/leg Drawn event. Inspect transaction traces and full event context before classifying them as cross-order residue attribution.");
