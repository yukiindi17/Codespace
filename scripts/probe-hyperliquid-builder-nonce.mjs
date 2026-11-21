import {createPublicClient,http,parseAbi,parseAbiParameters,encodeAbiParameters,decodeAbiParameters,getAddress} from "viem";
const RPC=process.env.RELAY_RPC_URL||"https://rpc.chain.relay.link";
const client=createPublicClient({transport:http(RPC,{timeout:60_000})});
const chainId=await client.getChainId();if(chainId!==537713)throw new Error("wrong chain "+chainId);
const block=await client.getBlockNumber();
const oldAllocator=getAddress("0x613d3c588f6b8f89302b463f8f19f7241b2857e2");
const currentAllocator=getAddress("0xa68dcb6ca9a7bc8cac147688f1cbfe68524b38c8");
const oldBuilder=getAddress("0x69719e3b08c6f12dd89a84a9b0f33defd762c94e");
const currentBuilder=getAddress("0xc5f8df1448091ceeca0fb3699125d9e8b171a8df");
const depository="0x66cf0aace1b4e562593bec10ec7868fba9932224";
const abi=parseAbi(["function buildPayload(string chainId,bytes depository,(string chainId,bytes depository,bytes currency,uint256 amount,string spenderChainId,bytes spender,bytes receiver,bytes data,bytes32 nonce) params) view returns (bytes payload,(bytes currency,uint256 amount) withdrawFee)"]);
const paramsType=parseAbiParameters("(string chainId,bytes depository,bytes currency,uint256 amount,string spenderChainId,bytes spender,bytes receiver,bytes data,bytes32 nonce)");
const currency="0x00000000000000000000000000000000";
const receiver="0x1111111111111111111111111111111111111111";
const zeroNonce="0x"+"00".repeat(31)+"01";
async function probe(builder,caller,seed,nonce=zeroNonce){
 const data=encodeAbiParameters(parseAbiParameters("uint64"),[BigInt(seed)]);
 const params={chainId:"hyperliquid",depository,currency,amount:1000000n,spenderChainId:"relay",spender:caller,receiver,data,nonce};
 try{
  const [payload,fee]=await client.readContract({address:builder,abi,functionName:"buildPayload",args:["hyperliquid",depository,params],account:caller,blockNumber:block});
  const d=decodeAbiParameters(parseAbiParameters("uint8,string,string,string,uint64"),payload);
  return {seed,nonce,txType:d[0],hyperliquidChain:d[1],destination:d[2],amount:d[3],time:d[4].toString(),feeCurrency:fee.currency,feeAmount:fee.amount.toString()};
 }catch(e){return {seed,error:e.shortMessage||e.message}}
}
const seeds=[0,1,2,999];
const [oldInfo,currentInfo]=await Promise.all([
 Promise.all(seeds.map(seed=>probe(oldBuilder,oldAllocator,seed))),
 Promise.all(seeds.map(seed=>probe(currentBuilder,currentAllocator,seed)))
]);
console.log(JSON.stringify({chainId,block:block.toString(),old:{builder:oldBuilder,allocator:oldAllocator,probes:oldInfo},current:{builder:currentBuilder,allocator:currentAllocator,probes:currentInfo}},null,2));
