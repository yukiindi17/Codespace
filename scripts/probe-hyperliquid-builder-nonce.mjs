import {createPublicClient,http,parseAbi,parseAbiParameters,encodeAbiParameters,decodeAbiParameters,getAddress} from "viem";
const RPC=process.env.RELAY_RPC_URL||"https://rpc.chain.relay.link";
const client=createPublicClient({transport:http(RPC,{timeout:60_000})});
const chainId=await client.getChainId();if(chainId!==537713)throw new Error("wrong chain "+chainId);
const blockNumber=await client.getBlockNumber(),block=await client.getBlock({blockNumber});
const base=block.timestamp*1000n;
const oldAllocator=getAddress("0x613d3c588f6b8f89302b463f8f19f7241b2857e2");
const currentAllocator=getAddress("0xa68dcb6ca9a7bc8cac147688f1cbfe68524b38c8");
const oldBuilder=getAddress("0x69719e3b08c6f12dd89a84a9b0f33defd762c94e");
const currentBuilder=getAddress("0xc5f8df1448091ceeca0fb3699125d9e8b171a8df");
const depository="0x66cf0aace1b4e562593bec10ec7868fba9932224";
const abi=parseAbi(["function buildPayload(string chainId,bytes depository,(string chainId,bytes depository,bytes currency,uint256 amount,string spenderChainId,bytes spender,bytes receiver,bytes data,bytes32 nonce) params) view returns (bytes payload,(bytes currency,uint256 amount) withdrawFee)"]);
const currency="0x00000000000000000000000000000000";
const receiver="0x1111111111111111111111111111111111111111";
const seedOffsets=[0n,1n,2n,999n];
const currentCounter=await client.readContract({address:currentAllocator,abi:parseAbi(["function withdrawalsThisSecond(string chainId) view returns (uint256)"]),functionName:"withdrawalsThisSecond",args:["hyperliquid"],blockNumber});
async function probe(builder,caller,offset,requestNonce){
 const data=encodeAbiParameters(parseAbiParameters("uint64"),[base+offset]);
 const params={chainId:"hyperliquid",depository,currency,amount:1000000n,spenderChainId:"relay",spender:caller,receiver,data,nonce:"0x"+BigInt(requestNonce).toString(16).padStart(64,"0")};
 try{
  const [payload,fee]=await client.readContract({address:builder,abi,functionName:"buildPayload",args:["hyperliquid",depository,params],account:caller,blockNumber});
  let decoded;
  if(builder===oldBuilder){
   const outer=decodeAbiParameters(parseAbiParameters("uint8 txType,bytes parameters"),payload);
   const inner=decodeAbiParameters(parseAbiParameters("string hyperliquidChain,string destination,string amount,uint64 time"),outer[1]);
   decoded={encoding:"nested",txType:outer[0],hyperliquidChain:inner[0],destination:inner[1],amount:inner[2],nonce:inner[3].toString()};
  }else{
   const d=decodeAbiParameters(parseAbiParameters("uint8 txType,string hyperliquidChain,string destination,string amount,uint64 time"),payload);
   decoded={encoding:"inline",txType:d[0],hyperliquidChain:d[1],destination:d[2],amount:d[3],nonce:d[4].toString()};
  }
  return {seedOffset:offset.toString(),requestNonce, ...decoded, feeCurrency:fee.currency,feeAmount:fee.amount.toString()};
 }catch(e){return {seedOffset:offset.toString(),requestNonce,error:e.shortMessage||e.message}}
}
const oldProbes=await Promise.all(seedOffsets.map((offset,i)=>probe(oldBuilder,oldAllocator,offset,i+1)));
const currentProbes=await Promise.all(seedOffsets.map((offset,i)=>probe(currentBuilder,currentAllocator,offset,i+11)));
const collisionOffset=currentCounter;
const oldCollision=await probe(oldBuilder,oldAllocator,collisionOffset,999);
const currentCollision=await probe(currentBuilder,currentAllocator,collisionOffset,1000);
console.log(JSON.stringify({
 chainId,block:blockNumber.toString(),timestamp:block.timestamp.toString(),baseNonce:base.toString(),
 currentAllocatorCounter:currentCounter.toString(),
 old:{builder:oldBuilder,allocator:oldAllocator,probes:oldProbes,collisionCase:oldCollision},
 current:{builder:currentBuilder,allocator:currentAllocator,probes:currentProbes,collisionCase:currentCollision},
 collisionIfEqual:oldCollision.nonce&&currentCollision.nonce?oldCollision.nonce===currentCollision.nonce:false,
 note:"Read-only eth_call only. The old builder takes params.data as a time nonce and validates freshness; the new builder derives block.timestamp*1000 plus the current allocator counter. A matching old seed and current counter produce the same destination nonce."
},null,2));
