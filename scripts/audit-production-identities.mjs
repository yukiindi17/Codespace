import { createPublicClient, http, parseAbi, getAddress } from "viem";

const RPC = process.env.RELAY_RPC_URL || "https://rpc.chain.relay.link";
const CHAIN_ID = 537713;
const A = {
  hub: getAddress("0xddd361727c22a01eb137880678a20b0beae69318"),
  executor: getAddress("0x946773048565893b6b6051a485c52e32e43cc2fe"),
  oracle: getAddress("0x30e6cd00d0f6553884b151c1b1b74fd59369ff41"),
  oracleMultisig: getAddress("0x3036b2b6cc6172d0d306657855d4996f484a29f7"),
  poolDrawResolver: getAddress("0xbc8aa4624a503d5c85bbf0e969f141da60216af9"),
};
const client = createPublicClient({ transport: http(RPC, { timeout: 30_000 }) });
const chainId = await client.getChainId();
if (chainId !== CHAIN_ID) throw new Error(`Wrong chain id ${chainId}`);

const codeReport = {};
for (const [name, address] of Object.entries(A)) {
  const code = await client.getCode({ address });
  codeReport[name] = { address, hasCode: !!code && code !== "0x", runtimeBytes: code && code !== "0x" ? (code.length - 2) / 2 : 0 };
}

const resolverAbi = parseAbi([
  "function EXECUTOR() view returns (address)",
  "function HUB() view returns (address)",
  "function SANDBOX() view returns (address)",
]);
const [resolverExecutor, resolverHub, sandbox] = await Promise.all([
  client.readContract({ address: A.poolDrawResolver, abi: resolverAbi, functionName: "EXECUTOR" }),
  client.readContract({ address: A.poolDrawResolver, abi: resolverAbi, functionName: "HUB" }),
  client.readContract({ address: A.poolDrawResolver, abi: resolverAbi, functionName: "SANDBOX" }),
]);
const sandboxCode = await client.getCode({ address: sandbox });

const multisigAbi = parseAbi([
  "function owner() view returns (address)",
  "function getSigners() view returns (address[])",
  "function threshold() view returns (uint256)",
]);
const [multisigOwner, signers, threshold] = await Promise.all([
  client.readContract({ address: A.oracleMultisig, abi: multisigAbi, functionName: "owner" }),
  client.readContract({ address: A.oracleMultisig, abi: multisigAbi, functionName: "getSigners" }),
  client.readContract({ address: A.oracleMultisig, abi: multisigAbi, functionName: "threshold" }),
]);

const executorAbi = parseAbi([
  "function ORACLE_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
]);
const oracleRole = await client.readContract({ address: A.executor, abi: executorAbi, functionName: "ORACLE_ROLE" });
const [oracleHasRole, multisigHasRole] = await Promise.all([
  client.readContract({ address: A.executor, abi: executorAbi, functionName: "hasRole", args: [oracleRole, A.oracle] }),
  client.readContract({ address: A.executor, abi: executorAbi, functionName: "hasRole", args: [oracleRole, A.oracleMultisig] }),
]);

console.log(JSON.stringify({
  chainId,
  blockNumber: (await client.getBlockNumber()).toString(),
  codeReport,
  resolverWiring: {
    configuredExecutor: resolverExecutor,
    expectedExecutor: A.executor,
    executorMatches: resolverExecutor.toLowerCase() === A.executor.toLowerCase(),
    configuredHub: resolverHub,
    expectedHub: A.hub,
    hubMatches: resolverHub.toLowerCase() === A.hub.toLowerCase(),
    sandbox,
    sandboxHasCode: !!sandboxCode && sandboxCode !== "0x",
    sandboxRuntimeBytes: sandboxCode && sandboxCode !== "0x" ? (sandboxCode.length - 2) / 2 : 0,
  },
  oracleMultisig: {
    address: A.oracleMultisig,
    owner: multisigOwner,
    threshold: threshold.toString(),
    signerCount: signers.length,
    signers,
  },
  executorOracleRole: {
    role: oracleRole,
    relayInboxHasRole: oracleHasRole,
    oracleMultisigHasRoleDirectly: multisigHasRole,
  },
}, null, 2));
