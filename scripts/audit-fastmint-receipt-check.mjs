import { createPublicClient, http, parseAbi, getAddress, decodeFunctionData } from "viem";
const client=createPublicClient({transport:http(process.env.RELAY_RPC_URL||"https://rpc.chain.relay.link",{timeout:30000})});
const inbox=getAddress("0x30e6Cd00D0F6553884B151c1B1B74FD59369ff41");
const limiter=getAddress("0x23AFd9E0348C058EBA84C434d9C6B508CEA764E6");
const txHash="0x98f21e896bfc518cf10b1e6ec8d4ae2e94038aa2800ca3c5641a7b43e520f987";
const [receipt,tx,limiterCode,inboxCode,block]=await Promise.all([
 client.getTransactionReceipt({hash:txHash}),client.getTransaction({hash:txHash}),
 client.getCode({address:limiter}),client.getCode({address:inbox}),client.getBlockNumber()
]);
const logs=receipt.logs.map((l,i)=>({i,address:l.address,topics:l.topics,dataBytes:(l.data.length-2)/2,topic0:l.topics[0]}));
const limiterAbi=parseAbi([
 "function getBucket(uint256 tokenId) view returns ((uint128 tokens,uint48 lastUpdated,bool isEnabled,uint128 capacity,uint128 rate) bucket)",
 "function hasRole(bytes32 role,address account) view returns (bool)",
 "function CONSUMER_ROLE() view returns (bytes32)",
 "event TokensConsumed(uint256 indexed tokenId,uint256 amount,uint256 remaining)"
]);
const tokenIds=[
 86512134522270721992957910457991533944458899231992780260485192288294071515448n,
 78958303388605348771641451063807261817410851063668695007283209365309620547462n
];
const buckets=[];
for(const tokenId of tokenIds){try{const b=await client.readContract({address:limiter,abi:limiterAbi,functionName:"getBucket",args:[tokenId]});buckets.push({tokenId:tokenId.toString(),tokens:b.tokens.toString(),lastUpdated:b.lastUpdated.toString(),isEnabled:b.isEnabled,capacity:b.capacity.toString(),rate:b.rate.toString()});}catch(e){buckets.push({tokenId:tokenId.toString(),error:e.shortMessage||e.message});}}
let consumerRole,consumerHasRole;
try{consumerRole=await client.readContract({address:limiter,abi:limiterAbi,functionName:"CONSUMER_ROLE"});consumerHasRole=await client.readContract({address:limiter,abi:limiterAbi,functionName:"hasRole",args:[consumerRole,inbox]});}catch(e){consumerHasRole=e.shortMessage||e.message;}
console.log(JSON.stringify({
 chainId:await client.getChainId(),latestBlock:block,txHash,txTo:tx.to,txFrom:tx.from,receiptStatus:receipt.status,
 inbox,limiter,inboxCodeBytes:(inboxCode?.length-2)/2,limiterCodeBytes:(limiterCode?.length-2)/2,
 receiptLogCount:logs.length,logs,buckets,consumerRole,consumerHasRole
},null,2));
