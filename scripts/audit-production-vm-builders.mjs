import {createPublicClient,http,parseAbi,getAddress,keccak256,parseAbiParameters} from "viem";
const RPC=process.env.RELAY_RPC_URL||"https://rpc.chain.relay.link";
const client=createPublicClient({transport:http(RPC,{timeout:60_000})});
const expected=537713,chainId=await client.getChainId();if(chainId!==expected)throw new Error("wrong chain "+chainId);
const block=await client.getBlockNumber();
const A={
 oldAllocator:getAddress("0x613d3c588f6b8f89302b463f8f19f7241b2857e2"),
 currentAllocator:getAddress("0xa68dcb6ca9a7bc8cac147688f1cbfe68524b38c8"),
 oldTonBuilder:getAddress("0x309ccc6ff134b1a572d12dfcc9f393229dda0069"),
 currentTonBuilder:getAddress("0x4250e7e094ee62f38c86528e01799a052b2fdd03"),
 currentHyperliquidBuilder:getAddress("0xc5f8df1448091ceeca0fb3699125d9e8b171a8df")
};
const allocatorAbi=parseAbi(["function payloadBuilders(string chainId,bytes depository) view returns (address)","function withdrawalsThisSecond(string chainId) view returns (uint256)","function HUB() view returns (address)"]);
const builderAbi=parseAbi([
 "function ALLOCATOR() view returns (address)","function CHAIN_ID_HASH() view returns (bytes32)",
 "function SUBWALLET_ID() view returns (uint32)","function TIMEOUT() view returns (uint32)",
 "function QUERY_ID_PERIOD() view returns (uint256)","function QUERY_IDS_PER_SECOND() view returns (uint256)",
 "function hyperliquidChain() view returns (string)"
]);
const tonDepository="0xab746b034ea036b7ac5147837a57827bd3917bc3f5506d47479e87ec87ef2554";
const hyperliquidDepository="0x66cf0aace1b4e562593bec10ec7868fba9932224";
async function safeRead(address,abi,functionName,args=[]){try{const v=await client.readContract({address,abi,functionName,args});return typeof v==="bigint"?v.toString():v}catch(e){return "unavailable: "+(e.shortMessage||e.message)}}
async function builderInfo(address){
 const code=await client.getCode({address});
 const out={address,hasCode:!!code&&code!=="0x",runtimeBytes:code&&code!=="0x"?(code.length-2)/2:0};
 for(const [key,fn] of [["allocator","ALLOCATOR"],["chainIdHash","CHAIN_ID_HASH"],["subwalletId","SUBWALLET_ID"],["timeout","TIMEOUT"],["queryIdPeriod","QUERY_ID_PERIOD"],["queryIdsPerSecond","QUERY_IDS_PER_SECOND"],["hyperliquidChain","hyperliquidChain"]]){
  try{const v=await client.readContract({address,abi:builderAbi,functionName:fn});out[key]=typeof v==="bigint"?v.toString():v}catch{}
 }
 return out;
}
const result={chainId,block:block.toString(),ton:{depository:tonDepository,depositoryHash:keccak256(tonDepository),oldAllocatorRegistration:await client.readContract({address:A.oldAllocator,abi:allocatorAbi,functionName:"payloadBuilders",args:["ton",tonDepository]}),currentAllocatorRegistration:await client.readContract({address:A.currentAllocator,abi:allocatorAbi,functionName:"payloadBuilders",args:["ton",tonDepository]}),oldAllocatorCounter:await safeRead(A.oldAllocator,allocatorAbi,"withdrawalsThisSecond",["ton"]),currentAllocatorCounter:await safeRead(A.currentAllocator,allocatorAbi,"withdrawalsThisSecond",["ton"]),oldBuilder:await builderInfo(A.oldTonBuilder),currentBuilder:await builderInfo(A.currentTonBuilder)},hyperliquid:{depository:hyperliquidDepository,oldAllocatorRegistration:await client.readContract({address:A.oldAllocator,abi:allocatorAbi,functionName:"payloadBuilders",args:["hyperliquid",hyperliquidDepository]}),currentAllocatorRegistration:await client.readContract({address:A.currentAllocator,abi:allocatorAbi,functionName:"payloadBuilders",args:["hyperliquid",hyperliquidDepository]}),oldAllocatorCounter:await safeRead(A.oldAllocator,allocatorAbi,"withdrawalsThisSecond",["hyperliquid"]),currentAllocatorCounter:await safeRead(A.currentAllocator,allocatorAbi,"withdrawalsThisSecond",["hyperliquid"]),currentBuilder:await builderInfo(A.currentHyperliquidBuilder)}};
console.log(JSON.stringify(result,null,2));
