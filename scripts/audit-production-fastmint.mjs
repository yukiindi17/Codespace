import { createPublicClient, http, parseAbi, parseAbiParameters, decodeAbiParameters, getAddress } from "viem";

const RPC = process.env.RELAY_RPC_URL || "https://rpc.chain.relay.link";
const CHAIN_ID = 537713;
const INBOX = getAddress("0x30e6cd00d0f6553884b151c1b1b74fd59369ff41");
const MANIFEST_LIMITER = getAddress("0x23afd9e0348c058eba84c434d9c6b508cea764e6");
const MANIFEST_FEE_CALCULATOR = getAddress("0xdd7d96282b7fda7c83aca1ed8d09733ad51caa09");
const client = createPublicClient({ transport: http(RPC, { timeout: 60_000 }) });
const chainId = await client.getChainId();
if (chainId !== CHAIN_ID) throw new Error(`Wrong chain id ${chainId}`);
const latest = await client.getBlockNumber();
const inboxAbi = parseAbi([
  "event Executed(bytes32 indexed idempotencyKey,bytes[] actions)",
  "event ExecutionFailed(bytes32 indexed idempotencyKey,bytes[] actions)",
  "function isRateLimiter(address) view returns (bool)",
  "function isFeeCalculator(address) view returns (bool)",
]);
const actionParams = parseAbiParameters("uint8 actionType,address hubToAddress,uint256 hubTokenId,uint256 amount,address feeCalculator,bytes feeCalculatorData,address rateLimiter,bytes rateLimiterData");
async function scan(event,label){
  let from=0n,span=20_000n;const out=[];
  while(from<=latest){
    const to=from+span-1n>latest?latest:from+span-1n;
    try{out.push(...await client.getLogs({address:INBOX,event,fromBlock:from,toBlock:to}));from=to+1n}
    catch(e){if(span<=100n)throw new Error(label+" "+from+"-"+to+": "+(e.shortMessage||e.message));span/=4n}
  }
  return out;
}
const [successLogs,failedLogs]=await Promise.all([
  scan(inboxAbi[0],"Executed"),scan(inboxAbi[1],"ExecutionFailed")
]);
const stats={executed:successLogs.length,failed:failedLogs.length,fastMintSuccess:0,fastMintFailed:0,zeroRateLimiterSuccess:0,zeroFeeCalculatorSuccess:0,rateLimiters:{},feeCalculators:{},fastMintSamples:[]};
function record(log,failed){
  for(const raw of log.args.actions){
    let d;try{d=decodeAbiParameters(actionParams,raw)}catch{continue}
    if(d[0]!==3)continue;
    const [,recipient,tokenId,amount,feeCalc,feeData,limiter,limiterData]=d;
    const fc=getAddress(feeCalc),rl=getAddress(limiter);
    if(failed)stats.fastMintFailed++;else stats.fastMintSuccess++;
    if(rl==="0x0000000000000000000000000000000000000000"&&!failed)stats.zeroRateLimiterSuccess++;
    if(fc==="0x0000000000000000000000000000000000000000"&&!failed)stats.zeroFeeCalculatorSuccess++;
    if(!failed)stats.rateLimiters[rl]=(stats.rateLimiters[rl]||0)+1;
    if(!failed)stats.feeCalculators[fc]=(stats.feeCalculators[fc]||0)+1;
    if(stats.fastMintSamples.length<10)stats.fastMintSamples.push({
      block:log.blockNumber?.toString(),tx:log.transactionHash,idempotencyKey:log.args.idempotencyKey,
      recipient,tokenId:tokenId.toString(),amount:amount.toString(),feeCalculator:fc,rateLimiter:rl,
      rateLimiterDataBytes:(limiterData.length-2)/2,feeCalculatorDataBytes:(feeData.length-2)/2,failed
    });
  }
}
for(const l of successLogs)record(l,false);
for(const l of failedLogs)record(l,true);
const [limiterAllowed,feeCalculatorAllowed,limiterCode,feeCalculatorCode]=await Promise.all([
  client.readContract({address:INBOX,abi:inboxAbi,functionName:"isRateLimiter",args:[MANIFEST_LIMITER]}),
  client.readContract({address:INBOX,abi:inboxAbi,functionName:"isFeeCalculator",args:[MANIFEST_FEE_CALCULATOR]}),
  client.getCode({address:MANIFEST_LIMITER}),client.getCode({address:MANIFEST_FEE_CALCULATOR})
]);
console.log(JSON.stringify({
  chainId,block:latest.toString(),inbox:INBOX,successfulExecutionEvents:successLogs.length,
  failedExecutionEvents:failedLogs.length,stats,
  manifestModules:{
    rateLimiter:{address:MANIFEST_LIMITER,hasCode:!!limiterCode&&limiterCode!=="0x",allowlisted:limiterAllowed},
    feeCalculator:{address:MANIFEST_FEE_CALCULATOR,hasCode:!!feeCalculatorCode&&feeCalculatorCode!=="0x",allowlisted:feeCalculatorAllowed}
  },
  note:"The action data is oracle-signed. A zero rateLimiter indicates an explicit oracle-authorized bypass, not a permissionless bypass."
},null,2));
