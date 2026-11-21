import { createPublicClient, http, parseAbi, parseAbiParameters, decodeAbiParameters, getAddress, keccak256, stringToHex, decodeFunctionData } from "viem";
const client = createPublicClient({ transport: http(process.env.RELAY_RPC_URL || "https://rpc.chain.relay.link", { timeout: 30_000 }) });
const chainId = await client.getChainId();
if (chainId !== 537713) throw new Error(`Wrong chain id ${chainId}`);
const inbox = getAddress("0x30e6Cd00D0F6553884B151c1B1B74FD59369ff41");
const limiter = getAddress("0x23AFd9E0348C058EBA84C434d9C6B508CEA764E6");
const abi = parseAbi([
 "event FastMint(bytes32 indexed idempotencyKey,address hubToAddress,uint256 hubTokenId,uint256 amount,uint256 feeCurrency,uint256 feeAmount,address feeRecipient,address feePayer)",
 "event TokensConsumed(string indexed chainId,uint256 usdAmount,uint256 remaining)"
]);
const executeAbi = parseAbi([
  "function execute((bytes32 idempotencyKey,bytes[] actions,uint256 expiration) execution,address oracle,bytes signature)",
  "function executeMultiple((bytes32 idempotencyKey,bytes[] actions,uint256 expiration)[] executions,address oracle,bytes[] signatures)"
]);
const wrapperAbi = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)"
]);
const actionParams = parseAbiParameters("uint8 actionType,address hubToAddress,uint256 hubTokenId,uint256 amount,address feeCalculator,bytes feeCalculatorData,address rateLimiter,bytes rateLimiterData");
const latest = await client.getBlockNumber();
const from = latest > 50000n ? latest - 50000n : 0n;
const [fast, consumed] = await Promise.all([
 client.getLogs({ address: inbox, event: abi[0], fromBlock: from, toBlock: latest }),
 client.getLogs({ address: limiter, event: abi[1], fromBlock: from, toBlock: latest })
]);
const byTx = new Map();
for (const l of consumed) {
 const k=l.transactionHash.toLowerCase();
 if(!byTx.has(k)) byTx.set(k,[]);
 byTx.get(k).push({chainIdHash:l.topics[1]?.toLowerCase(),usdAmount:l.args.usdAmount.toString(),remaining:l.args.remaining.toString()});
}
const unmatched=[];
for(const l of fast){
 const tx=await client.getTransaction({hash:l.transactionHash});
 const outer=decodeFunctionData({abi:wrapperAbi,data:tx.input});
 const nested=outer.args[0].filter(c=>getAddress(c.target)===inbox).map(c=>c.callData);
 let rateData;
 for(const callData of nested){
  const inner=decodeFunctionData({abi:executeAbi,data:callData});
  const executions=inner.functionName==="execute"?[inner.args[0]]:inner.args[0];
  for(const ex of executions){
   const key=String(ex.idempotencyKey??ex[0]).toLowerCase();
   if(key===String(l.args.idempotencyKey).toLowerCase()){
    const acts=ex.actions??ex[1];
    const action=acts.map(raw=>decodeAbiParameters(actionParams,raw)).find(x=>x[0]===3);
    if(action) rateData=action[7];
   }
  }
 }
 if(!rateData){unmatched.push({tx:l.transactionHash,reason:"FAST_MINT rateLimiterData not found"});continue;}
 const [originChainId]=decodeAbiParameters(parseAbiParameters("string"),rateData);
 const expectedHash=keccak256(stringToHex(originChainId)).toLowerCase();
 const entries=byTx.get(l.transactionHash.toLowerCase())||[];
 const idx=entries.findIndex(x=>x.chainIdHash===expectedHash && BigInt(x.usdAmount)>0n);
 if(idx<0) unmatched.push({tx:l.transactionHash,block:l.blockNumber.toString(),tokenId:l.args.hubTokenId.toString(),amount:l.args.amount.toString(),originChainId,recipient:l.args.hubToAddress});
 else entries.splice(idx,1);
}
const report={
 chainId,inbox,limiter,fromBlock:from.toString(),toBlock:latest.toString(),
 fastMintCount:fast.length,limiterConsumeEventCount:consumed.length,
 matchedFastMints:fast.length-unmatched.length,unmatchedFastMints:unmatched.length,
 unmatchedSamples:unmatched.slice(0,30),
 limiterConsumeWithoutFastMint: [...byTx.values()].reduce((n,a)=>n+a.length,0)
};
console.log(JSON.stringify(report,null,2));
