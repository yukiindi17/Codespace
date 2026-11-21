import {createPublicClient,http,parseAbi,parseAbiParameters,decodeAbiParameters,getAddress} from "viem";
const RPC=process.env.RELAY_RPC_URL||"https://rpc.chain.relay.link";
const client=createPublicClient({transport:http(RPC,{timeout:60_000})});
const chainId=await client.getChainId();if(chainId!==537713)throw new Error("wrong chain "+chainId);
const latest=await client.getBlockNumber(),from=latest>50_000n?latest-50_000n:0n;
const allocators=[
 {name:"legacy",address:getAddress("0x613D3c588F6B8f89302b463F8F19f7241B2857E2")},
 {name:"current",address:getAddress("0xa68dcb6ca9a7bc8cac147688f1cbfe68524b38c8")}
];
const event=parseAbi(["event PayloadBuilt(bytes32 indexed withdrawRequestHash,bytes payload,bytes32[] hashesToSign)"])[0];
const usdParams=parseAbiParameters("uint8 txType,string hyperliquidChain,string destination,string amount,uint64 time");
const usdNestedParams=parseAbiParameters("uint8 txType,(string hyperliquidChain,string destination,string amount,uint64 time) request");
const assetParams=parseAbiParameters("uint8 txType,string hyperliquidChain,string destination,string sourceDex,string destinationDex,string token,string amount,string fromSubAccount,uint64 nonce");
const assetNestedParams=parseAbiParameters("uint8 txType,(string hyperliquidChain,string destination,string sourceDex,string destinationDex,string token,string amount,string fromSubAccount,uint64 nonce) request");
const bytesWrappedParams=parseAbiParameters("uint8 txType,bytes request");
async function scan(address){
 let cursor=from,span=10_000n,out=[];
 while(cursor<=latest){const end=cursor+span-1n>latest?latest:cursor+span-1n;try{out.push(...await client.getLogs({address,event,fromBlock:cursor,toBlock:end}));cursor=end+1n}catch(e){if(span<=1n)throw new Error("PayloadBuilt scan "+cursor+"-"+end+": "+(e.shortMessage||e.message));span/=2n}}
 return out;
}
const raw=await Promise.all(allocators.map(async a=>({allocator:a,logs:await scan(a.address)})));
const blockNums=[...new Set(raw.flatMap(x=>x.logs.map(l=>l.blockNumber.toString())))].map(BigInt);
const blockMap=new Map();
for(let i=0;i<blockNums.length;i+=50){const batch=await Promise.all(blockNums.slice(i,i+50).map(async b=>[b.toString(),await client.getBlock({blockNumber:b})]));for(const [k,v] of batch)blockMap.set(k,v.timestamp);}
const entries=[],ignored={legacy:0,current:0};
for(const group of raw){
 for(const log of group.logs){
  const payload=log.args.payload;
  let item=null;
  try{
   const d=decodeAbiParameters(usdParams,payload);
   if(d[0]===0&&d[1]==="Mainnet")item={kind:"usdSend",destination:d[2],amount:d[3],nonce:d[4]};
  }catch{}
  if(!item){
   try{const d=decodeAbiParameters(assetParams,payload);if(d[0]===1&&d[1]==="Mainnet")item={kind:"sendAsset",destination:d[2],token:d[5],amount:d[6],nonce:d[8]}}catch{}
  }
  if(!item){
   try{const d=decodeAbiParameters(usdNestedParams,payload);if(d[0]===0&&d[1].hyperliquidChain==="Mainnet")item={kind:"usdSendNested",destination:d[1].destination,amount:d[1].amount,nonce:d[1].time}}catch{}
  }
  if(!item){
   try{const d=decodeAbiParameters(assetNestedParams,payload);if(d[0]===1&&d[1].hyperliquidChain==="Mainnet")item={kind:"sendAssetNested",destination:d[1].destination,token:d[1].token,amount:d[1].amount,nonce:d[1].nonce}}catch{}
  }
  if(!item){
   try{const d=decodeAbiParameters(bytesWrappedParams,payload);const raw=d[1];try{const x=decodeAbiParameters(usdParams,raw);if(d[0]===0&&x[1]==="Mainnet")item={kind:"usdSendBytes",destination:x[2],amount:x[3],nonce:x[4]}}catch{}if(!item){const x=decodeAbiParameters(assetParams,raw);if(d[0]===1&&x[1]==="Mainnet")item={kind:"sendAssetBytes",destination:x[2],token:x[5],amount:x[6],nonce:x[8]}}}catch{}
  }
  if(!item){ignored[group.allocator.name]++;continue}
  const ts=blockMap.get(log.blockNumber.toString());
  const base=ts*1000n;
  entries.push({
   allocator:group.allocator.name,block:log.blockNumber.toString(),timestamp:ts.toString(),
   tx:log.transactionHash,requestHash:log.args.withdrawRequestHash,
   ...item,nonce:item.nonce.toString(),millisecondOffset:(item.nonce-base).toString()
  });
 }
}
const byNonce=new Map();
for(const e of entries){const a=byNonce.get(e.nonce)||[];a.push(e);byNonce.set(e.nonce,a)}
const duplicates=[...byNonce.values()].filter(a=>a.length>1);
const byAllocator={legacy:entries.filter(e=>e.allocator==="legacy"),current:entries.filter(e=>e.allocator==="current")};
console.log(JSON.stringify({
 chainId,fromBlock:from.toString(),latestBlock:latest.toString(),
 counts:{legacy:byAllocator.legacy.length,current:byAllocator.current.length,ignoredPayloads:ignored},
 duplicateNonceCount:duplicates.length,
 duplicateNonces:duplicates.map(a=>({nonce:a[0].nonce,entries:a.map(e=>({allocator:e.allocator,block:e.block,tx:e.tx,requestHash:e.requestHash,destination:e.destination,amount:e.amount,kind:e.kind,millisecondOffset:e.millisecondOffset}))})),
 samples:{legacy:byAllocator.legacy.slice(0,12),current:byAllocator.current.slice(0,12)},
 note:"Only PayloadBuilt payloads that decode as Hyperliquid Mainnet usdSend/sendAsset are counted. Duplicate nonce across allocators is a collision candidate requiring destination confirmation."
},null,2));
