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
const hubAbi=parseAbi(["function OPERATOR_ROLE() view returns (bytes32)","function hasRole(bytes32,address) view returns (bool)"]);
const allocatorAbi=parseAbi(["function owner() view returns (address)","function HUB() view returns (address)"]);
const oracleAbi=parseAbi(["function HUB() view returns (address)","function IDEMPOTENCY_STORE() view returns (address)","function ORACLE_ROLE() view returns (bytes32)","function hasRole(bytes32,address) view returns (bool)"]);
const executorAbi=parseAbi(["function HUB() view returns (address)","function ALLOCATOR() view returns (address)","function ORACLE_ROLE() view returns (bytes32)","function hasRole(bytes32,address) view returns (bool)"]);
const multisigAbi=parseAbi(["function owner() view returns (address)","function getSigners() view returns (address[])","function threshold() view returns (uint256)"]);
const opRole=await client.readContract({address:A.hub,abi:hubAbi,functionName:"OPERATOR_ROLE"});
const [oldAllocatorOwner,oldAllocatorHub,oldExecutorHub,oldExecutorAllocator,oldOracleHub,oldStore,currentStore,oldOracleRole,oldExecutorRole,currentOracleRole,currentExecutorRole]=await Promise.all([
 client.readContract({address:A.legacyAllocator,abi:allocatorAbi,functionName:"owner"}),
 client.readContract({address:A.legacyAllocator,abi:allocatorAbi,functionName:"HUB"}),
 client.readContract({address:A.legacyExecutor,abi:executorAbi,functionName:"HUB"}),
 client.readContract({address:A.legacyExecutor,abi:executorAbi,functionName:"ALLOCATOR"}),
 client.readContract({address:A.legacyOracle,abi:oracleAbi,functionName:"HUB"}),
 client.readContract({address:A.legacyOracle,abi:oracleAbi,functionName:"IDEMPOTENCY_STORE"}),
 client.readContract({address:A.currentInbox,abi:oracleAbi,functionName:"IDEMPOTENCY_STORE"}),
 client.readContract({address:A.legacyOracle,abi:oracleAbi,functionName:"ORACLE_ROLE"}),
 client.readContract({address:A.legacyExecutor,abi:executorAbi,functionName:"ORACLE_ROLE"}),
 client.readContract({address:A.currentInbox,abi:oracleAbi,functionName:"ORACLE_ROLE"}),
 client.readContract({address:A.currentExecutor,abi:executorAbi,functionName:"ORACLE_ROLE"})
]);
const [oldOracleSignerActive,oldExecutorSignerActive,currentOracleOldSigner,currentExecutorOldSigner,currentOracleSigner,currentExecutorSigner,multiOwner,signers,threshold]=await Promise.all([
 client.readContract({address:A.legacyOracle,abi:oracleAbi,functionName:"hasRole",args:[oldOracleRole,A.oldSigner]}),
 client.readContract({address:A.legacyExecutor,abi:executorAbi,functionName:"hasRole",args:[oldExecutorRole,A.oldSigner]}),
 client.readContract({address:A.currentInbox,abi:oracleAbi,functionName:"hasRole",args:[currentOracleRole,A.oldSigner]}),
 client.readContract({address:A.currentExecutor,abi:executorAbi,functionName:"hasRole",args:[currentExecutorRole,A.oldSigner]}),
 client.readContract({address:A.currentInbox,abi:oracleAbi,functionName:"hasRole",args:[currentOracleRole,A.currentMultisig]}),
 client.readContract({address:A.currentExecutor,abi:executorAbi,functionName:"hasRole",args:[currentExecutorRole,A.currentMultisig]}),
 client.readContract({address:A.oldSigner,abi:multisigAbi,functionName:"owner"}),
 client.readContract({address:A.oldSigner,abi:multisigAbi,functionName:"getSigners"}),
 client.readContract({address:A.oldSigner,abi:multisigAbi,functionName:"threshold"})
]);
const contracts={legacyAllocator:A.legacyAllocator,legacyOracle:A.legacyOracle,legacyExecutor:A.legacyExecutor,currentInbox:A.currentInbox,currentExecutor:A.currentExecutor,currentAllocator:A.currentAllocator};
const code={};
const hubOperator={};
for(const [name,address] of Object.entries(contracts)){
 const c=await client.getCode({address});
 code[name]={address,hasCode:!!c&&c!=="0x",runtimeBytes:c&&c!=="0x"?(c.length-2)/2:0};
 hubOperator[name]=await client.readContract({address:A.hub,abi:hubAbi,functionName:"hasRole",args:[opRole,address]});
}
async function scan(address,event,from,to,label){
 let cursor=from,span=10_000n,total=0,first=null,last=null;
 while(cursor<=to){
  const end=cursor+span-1n>to?to:cursor+span-1n;
  try{const logs=await client.getLogs({address,event,fromBlock:cursor,toBlock:end});total+=logs.length;if(logs.length){first??=logs[0].blockNumber?.toString();last=logs[logs.length-1].blockNumber?.toString()}cursor=end+1n}
  catch(e){if(span<=1n)throw new Error(label+" "+cursor+"-"+end+": "+(e.shortMessage||e.message));span/=2n}
 }
 return {count:total,firstBlock:first,lastBlock:last};
}
const last10k=latest>10_000n?latest-10_000n:0n;
const last50k=latest>50_000n?latest-50_000n:0n;
const oldEvents=parseAbi(["event Executed(bytes32 indexed idempotencyKey,bytes[] actions)","event FastMint(bytes32 indexed idempotencyKey,address hubToAddress,uint256 hubTokenId,uint256 amount,uint256 feeCurrency,uint256 feeAmount,address feeRecipient,address feePayer)"]);
const executorEvent=parseAbi(["event Executed(address indexed orderAddress,uint256 indexed tokenIn,uint256 indexed tokenOut,uint256 amountIn,uint256 amountOut,bytes32 withdrawRequestHash)"])[0];
const [oracleExecuted50k,oracleExecuted10k,fastMint50k,fastMint10k,executorExecuted50k,executorExecuted10k]=await Promise.all([
 scan(A.legacyOracle,oldEvents[0],last50k,latest,"legacy oracle Executed"),
 scan(A.legacyOracle,oldEvents[0],last10k,latest,"legacy oracle Executed recent"),
 scan(A.legacyOracle,oldEvents[1],last50k,latest,"legacy oracle FastMint"),
 scan(A.legacyOracle,oldEvents[1],last10k,latest,"legacy oracle FastMint recent"),
 scan(A.legacyExecutor,executorEvent,last50k,latest,"legacy executor Executed"),
 scan(A.legacyExecutor,executorEvent,last10k,latest,"legacy executor Executed recent")
]);
console.log(JSON.stringify({
 chainId,block:latest.toString(),last50kBlocksFrom:last50k.toString(),last10kBlocksFrom:last10k.toString(),
 code,hubOperator,
 legacyStack:{
  allocator:{address:A.legacyAllocator,owner:oldAllocatorOwner,hub:oldAllocatorHub},
  executor:{address:A.legacyExecutor,hub:oldExecutorHub,allocator:oldExecutorAllocator,linksToLegacyAllocator:oldExecutorAllocator.toLowerCase()===A.legacyAllocator.toLowerCase()},
  oracle:{address:A.legacyOracle,hub:oldOracleHub,idempotencyStore:oldStore,sharesIdempotencyStoreWithCurrent:oldStore.toLowerCase()===currentStore.toLowerCase()},
  oldSigner:{address:A.oldSigner,owner:multiOwner,threshold:threshold.toString(),signers,activeOnLegacyOracle:oldOracleSignerActive,activeOnLegacyExecutor:oldExecutorSignerActive,activeOnCurrentInbox:currentOracleOldSigner,activeOnCurrentExecutor:currentExecutorOldSigner},
  currentSigner:{address:A.currentMultisig,activeOnCurrentInbox:currentOracleSigner,activeOnCurrentExecutor:currentExecutorSigner},
  recentActivity:{oracleExecutedLast50k:oracleExecuted50k,oracleExecutedLast10k:oracleExecuted10k,oracleFastMintLast50k:fastMint50k,oracleFastMintLast10k:fastMint10k,executorExecutedLast50k:executorExecuted50k,executorExecutedLast10k:executorExecuted10k}
 }
},null,2));
