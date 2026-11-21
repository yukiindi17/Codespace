import { createPublicClient, http, parseAbi, getAddress } from "viem";

const RPC=process.env.RELAY_RPC_URL||"https://rpc.chain.relay.link";
const CHAIN_ID=537713;
const A={
  hub:getAddress("0xddd361727c22a01eb137880678a20b0beae69318"),
  legacyAllocator:getAddress("0x613D3c588F6B8f89302b463F8F19f7241B2857E2"),
  legacyOracle:getAddress("0xd180Dc3b8Cb71b185c563B6e4857592cA93dACAf"),
  legacyExecutor:getAddress("0x6747c7e64B90DCcc0D54F865cBd9513156adBC0c"),
  oldSigner:getAddress("0x2A72EB8Cf0233A3DC6198683c83B1078DE6Fa2B0"),
  currentInbox:getAddress("0x30e6cd00d0f6553884b151c1b1b74fd59369ff41"),
  currentExecutor:getAddress("0x946773048565893b6b6051a485c52e32e43cc2fe"),
  currentAllocator:getAddress("0xa68dcb6ca9a7bc8cac147688f1cbfe68524b38c8"),
  currentMultisig:getAddress("0x3036b2b6cc6172d0d306657855d4996f484a29f7")
};
const client=createPublicClient({transport:http(RPC,{timeout:60_000})});
const chainId=await client.getChainId();if(chainId!==CHAIN_ID)throw new Error("Wrong chain "+chainId);
const latest=await client.getBlockNumber();
const allocatorAbi=parseAbi([
 "function owner() view returns (address)","function HUB() view returns (address)",
 "function pausedChains(string) view returns (bool)",
 "function payloadBuilderCounts(string) view returns (uint256)"
]);
const oracleAbi=parseAbi([
 "function HUB() view returns (address)","function IDEMPOTENCY_STORE() view returns (address)",
 "function ORACLE_ROLE() view returns (bytes32)","function hasRole(bytes32,address) view returns (bool)",
 "function isRateLimiter(address) view returns (bool)","function isFeeCalculator(address) view returns (bool)"
]);
const executorAbi=parseAbi([
 "function HUB() view returns (address)","function ALLOCATOR() view returns (address)",
 "function ORACLE_ROLE() view returns (bytes32)","function hasRole(bytes32,address) view returns (bool)"
]);
const multisigAbi=parseAbi(["function owner() view returns (address)","function getSigners() view returns (address[])","function threshold() view returns (uint256)"]);
const code={};
for(const [k,a] of Object.entries(A)){if(["oldSigner","currentMultisig"].includes(k))continue;const c=await client.getCode({address:a});code[k]={address:a,hasCode:!!c&&c!=="0x",bytes:c&&c!=="0x"?(c.length-2)/2:0}}
const [oldAllocatorOwner,oldAllocatorHub,oldExecHub,oldExecAllocator,oldOracleHub,oldStore,currentStore,oldOracleRole,oldExecutorRole,oldOracleSignerActive,oldExecSignerActive,currentOracleActive,currentExecOldSignerActive,multiOwner,signers,threshold]=await Promise.all([
 client.readContract({address:A.legacyAllocator,abi:allocatorAbi,functionName:"owner"}),
 client.readContract({address:A.legacyAllocator,abi:allocatorAbi,functionName:"HUB"}),
 client.readContract({address:A.legacyAllocator,abi:allocatorAbi,functionName:"paused"}),
 client.readContract({address:A.legacyExecutor,abi:executorAbi,functionName:"HUB"}),
 client.readContract({address:A.legacyExecutor,abi:executorAbi,functionName:"ALLOCATOR"}),
 client.readContract({address:A.legacyOracle,abi:oracleAbi,functionName:"HUB"}),
 client.readContract({address:A.legacyOracle,abi:oracleAbi,functionName:"IDEMPOTENCY_STORE"}),
 client.readContract({address:A.currentInbox,abi:oracleAbi,functionName:"IDEMPOTENCY_STORE"}),
 client.readContract({address:A.legacyOracle,abi:oracleAbi,functionName:"ORACLE_ROLE"}),
 client.readContract({address:A.legacyExecutor,abi:executorAbi,functionName:"ORACLE_ROLE"}),
 client.readContract({address:A.legacyOracle,abi:oracleAbi,functionName:"hasRole",args:[await client.readContract({address:A.legacyOracle,abi:oracleAbi,functionName:"ORACLE_ROLE"}),A.oldSigner]}),
 client.readContract({address:A.legacyExecutor,abi:executorAbi,functionName:"hasRole",args:[await client.readContract({address:A.legacyExecutor,abi:executorAbi,functionName:"ORACLE_ROLE"}),A.oldSigner]}),
 client.readContract({address:A.currentInbox,abi:oracleAbi,functionName:"hasRole",args:[await client.readContract({address:A.currentInbox,abi:oracleAbi,functionName:"ORACLE_ROLE"}),A.oldSigner]}),
 client.readContract({address:A.currentExecutor,abi:executorAbi,functionName:"hasRole",args:[await client.readContract({address:A.currentExecutor,abi:executorAbi,functionName:"ORACLE_ROLE"}),A.oldSigner]}),
 client.readContract({address:A.oldSigner,abi:multisigAbi,functionName:"owner"}),
 client.readContract({address:A.oldSigner,abi:multisigAbi,functionName:"getSigners"}),
 client.readContract({address:A.oldSigner,abi:multisigAbi,functionName:"threshold"})
]);
const currentOracleRole=await client.readContract({address:A.currentInbox,abi:oracleAbi,functionName:"ORACLE_ROLE"});
const currentSignerActive=await client.readContract({address:A.currentInbox,abi:oracleAbi,functionName:"hasRole",args:[currentOracleRole,A.currentMultisig]});
const last100k=latest>100_000n?latest-100_000n:0n;
const last500k=latest>500_000n?latest-500_000n:0n;
async function countLogs(address,event,from,to,label){
 let cursor=from,span=10_000n,total=0,first=null,last=null;
 while(cursor<=to){
  const end=cursor+span-1n>to?to:cursor+span-1n;
  try{const logs=await client.getLogs({address,event,fromBlock:cursor,toBlock:end});total+=logs.length;if(logs.length){first??=logs[0].blockNumber?.toString();last=logs[logs.length-1].blockNumber?.toString()}cursor=end+1n}
  catch(e){if(span<=1n)throw new Error(label+" "+cursor+"-"+end+": "+(e.shortMessage||e.message));span/=2n}
 }
 return {count:total,firstBlock:first,lastBlock:last};
}
const events=parseAbi([
 "event Executed(bytes32 indexed idempotencyKey,bytes[] actions)",
 "event FastMint(bytes32 indexed idempotencyKey,address hubToAddress,uint256 hubTokenId,uint256 amount,uint256 feeCurrency,uint256 feeAmount,address feeRecipient,address feePayer)"
]);
const [oldExecAll,oldExecRecent,oldFastAll,oldFastRecent]=await Promise.all([
 countLogs(A.legacyOracle,events[0],0n,latest,"old oracle Executed"),
 countLogs(A.legacyOracle,events[0],last100k,latest,"old oracle recent Executed"),
 countLogs(A.legacyOracle,events[1],0n,latest,"old oracle FastMint"),
 countLogs(A.legacyOracle,events[1],last100k,latest,"old oracle recent FastMint")
]);
const [oldExecutorEventsAll,oldExecutorEventsRecent]=await Promise.all([
 countLogs(A.legacyExecutor,parseAbi(["event Executed(address indexed orderAddress,uint256 indexed tokenIn,uint256 indexed tokenOut,uint256 amountIn,uint256 amountOut,bytes32 withdrawRequestHash)"])[0],0n,latest,"old executor Executed"),
 countLogs(A.legacyExecutor,parseAbi(["event Executed(address indexed orderAddress,uint256 indexed tokenIn,uint256 indexed tokenOut,uint256 amountIn,uint256 amountOut,bytes32 withdrawRequestHash)"])[0],last100k,latest,"old executor recent Executed")
]);
console.log(JSON.stringify({
 chainId,block:latest.toString(),last100kBlocksFrom:last100k.toString(),last500kBlocksFrom:last500k.toString(),code,
 legacyStack:{
  allocator:A.legacyAllocator,allocatorOwner:oldAllocatorOwner,allocatorHub:oldAllocatorHub,
  executor:A.legacyExecutor,executorHub:oldExecHub,executorAllocator:oldExecAllocator,executorLinksToLegacyAllocator:oldExecAllocator.toLowerCase()===A.legacyAllocator.toLowerCase(),
  oracle:A.legacyOracle,oracleHub:oldOracleHub,oldOracleIdempotencyStore:oldStore,currentInboxIdempotencyStore:currentStore,sharedIdempotencyStore:oldStore.toLowerCase()===currentStore.toLowerCase(),
  oldOracleSignerActive,oldExecutorSignerActive,
  oldSignerMultisig:{address:A.oldSigner,owner:multiOwner,threshold:threshold.toString(),signers},
  recentUsage:{oldOracleExecutedLast500k:oldExecAll,oldOracleExecutedLast100k:oldExecRecent,oldOracleFastMintLast500k:oldFastAll,oldOracleFastMintLast100k:oldFastRecent,oldExecutorExecutedLast500k:oldExecutorEventsAll,oldExecutorExecutedLast100k:oldExecutorEventsRecent}
 },
 currentStack:{inbox:A.currentInbox,currentOracleMultisig:A.currentMultisig,currentSignerActive,currentExecutor:A.currentExecutor,oldSignerStillAuthorizedOnCurrentExecutor:currentExecOldSignerActive},
 note:"100k/500k blocks are block-height windows, not calendar durations. Event counts are activity indicators, not proof that every action moved funds."
},null,2));
