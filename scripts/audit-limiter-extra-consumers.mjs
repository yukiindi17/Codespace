import { createPublicClient,http,parseAbi,parseAbiParameters,decodeAbiParameters,getAddress,decodeFunctionData } from "viem";
const client=createPublicClient({transport:http(process.env.RELAY_RPC_URL||"https://rpc.chain.relay.link",{timeout:60000})});
if(await client.getChainId()!==537713) throw new Error("Wrong chain");
const inbox=getAddress("0x30e6Cd00D0F6553884B151c1B1B74FD59369ff41");
const legacyOracle=getAddress("0xd180Dc3b8Cb71b185c563B6e4857592cA93dACAf");
const limiter=getAddress("0x23AFd9E0348C058EBA84C434d9C6B508CEA764E6");
const abi=parseAbi([
 "event FastMint(bytes32 indexed idempotencyKey,address hubToAddress,uint256 hubTokenId,uint256 amount,uint256 feeCurrency,uint256 feeAmount,address feeRecipient,address feePayer)",
 "event TokensConsumed(string indexed chainId,uint256 usdAmount,uint256 remaining)",
 "event RoleGranted(bytes32 indexed role,address indexed account,address indexed sender)",
 "event RoleRevoked(bytes32 indexed role,address indexed account,address indexed sender)",
 "function CONSUMER_ROLE() view returns (bytes32)",
 "function hasRole(bytes32 role,address account) view returns (bool)"
]);
const wrapperAbi=parseAbi(["function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)"]);
const executeAbi=parseAbi([
 "function execute((bytes32 idempotencyKey,bytes[] actions,uint256 expiration) execution,address oracle,bytes signature)",
 "function executeMultiple((bytes32 idempotencyKey,bytes[] actions,uint256 expiration)[] executions,address oracle,bytes[] signatures)"
]);
const latest=await client.getBlockNumber(),from=latest>50000n?latest-50000n:0n;
const [fast,consumed,role]=await Promise.all([
 client.getLogs({address:inbox,event:abi[0],fromBlock:from,toBlock:latest}),
 client.getLogs({address:limiter,event:abi[1],fromBlock:from,toBlock:latest}),
 client.getLogs({address:limiter,event:abi[2],fromBlock:0n,toBlock:latest})
]);
const fastTx=new Set(fast.map(x=>x.transactionHash.toLowerCase()));
const extras=consumed.filter(x=>!fastTx.has(x.transactionHash.toLowerCase()));
const holderChanges=new Map();
for(const l of role){const k=l.args.account.toLowerCase();holderChanges.set(k,{account:l.args.account,granted:l.args.role.toLowerCase()=== "0x9d56108290ea0bc9c5c59c3ad357dca9d1b29ed7f3ae1443bef2fa2159bdf5e8",lastEvent:l.eventName,block:l.blockNumber.toString()});}
const roleId=await client.readContract({address:limiter,abi:[abi[4]],functionName:"CONSUMER_ROLE"});
const candidates=[inbox,legacyOracle,getAddress("0x613D3c588F6B8f89302b463F8F19f7241B2857E2"),getAddress("0xa68dcB6ca9A7bC8cAC147688F1Cbfe68524b38C8"),getAddress("0x946773048565893b6B6051A485c52e32e43cC2Fe")];
const candidateRoles={};
for(const a of candidates){candidateRoles[a]=await client.readContract({address:limiter,abi:[abi[5]],functionName:"hasRole",args:[roleId,a]});}
const targetCounts={},selectorCounts={},sample=[];
for(const l of extras.slice(0,100)){
 const h=l.transactionHash.toLowerCase();
 if(sample.some(x=>x.tx===h)) continue;
 const tx=await client.getTransaction({hash:l.transactionHash});
 let targets=[],selectors=[],decoded=[];
 try{
  const outer=decodeFunctionData({abi:wrapperAbi,data:tx.input});
  for(const c of outer.args[0]){
   const target=getAddress(c.target);targets.push(target);
   selectors.push(c.callData.slice(0,10));
   try{const d=decodeFunctionData({abi:executeAbi,data:c.callData});decoded.push({target,functionName:d.functionName,executionCount:d.functionName==="execute"?1:d.args[0].length});}catch{}
  }
 }catch{targets=[tx.to||""];selectors=[tx.input.slice(0,10)];}
 for(const t of targets)targetCounts[t]=(targetCounts[t]||0)+1;
 for(const s of selectors)selectorCounts[s]=(selectorCounts[s]||0)+1;
 sample.push({tx:l.transactionHash,block:l.blockNumber.toString(),indexedChainHash:l.topics[1],usdAmount:l.args.usdAmount.toString(),remaining:l.args.remaining.toString(),txTo:tx.to,txFrom:tx.from,nestedTargets:[...new Set(targets)],decoded});
}
console.log(JSON.stringify({
 chainId:537713,fromBlock:from.toString(),toBlock:latest.toString(),
 fastMintEvents:fast.length,limiterConsumeEvents:consumed.length,extraLimiterEvents:extras.length,
 consumerRole:roleId,consumerRoleChanges:role.length,candidateRoles,
 nestedTargetCounts:targetCounts,selectorCounts,extraSamples:sample.slice(0,35)
},null,2));
