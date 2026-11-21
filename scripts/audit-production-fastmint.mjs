import { createPublicClient, http, parseAbi, parseAbiParameters, decodeAbiParameters, getAddress, decodeFunctionData } from "viem";

const RPC = process.env.RELAY_RPC_URL || "https://rpc.chain.relay.link";
const CHAIN_ID = 537713;
const INBOX = getAddress("0x30e6cd00d0f6553884b151c1b1b74fd59369ff41");
const MANIFEST_LIMITER = getAddress("0x23afd9e0348c058eba84c434d9c6b508cea764e6");
const MANIFEST_FEE_CALCULATOR = getAddress("0xdd7d96282b7fda7c83aca1ed8d09733ad51caa09");
const client = createPublicClient({ transport: http(RPC, { timeout: 60_000 }) });
const chainId = await client.getChainId();
if (chainId !== CHAIN_ID) throw new Error(`Wrong chain id ${chainId}`);
const latest = await client.getBlockNumber();
const abi = parseAbi([
  "event FastMint(bytes32 indexed idempotencyKey,address hubToAddress,uint256 hubTokenId,uint256 amount,uint256 feeCurrency,uint256 feeAmount,address feeRecipient,address feePayer)",
  "function execute((bytes32 idempotencyKey,bytes[] actions) execution,address oracle,bytes signature)",
  "function executeMultiple((bytes32 idempotencyKey,bytes[] actions)[] executions,address oracle,bytes[] signatures)",
  "function isRateLimiter(address) view returns (bool)",
  "function isFeeCalculator(address) view returns (bool)"
]);
const actionParams = parseAbiParameters("uint8 actionType,address hubToAddress,uint256 hubTokenId,uint256 amount,address feeCalculator,bytes feeCalculatorData,address rateLimiter,bytes rateLimiterData");
async function scanFastMintLogs(){
  let from=0n,span=20_000n;const out=[];
  while(from<=latest){
    const to=from+span-1n>latest?latest:from+span-1n;
    try{out.push(...await client.getLogs({address:INBOX,event:abi[0],fromBlock:from,toBlock:to}));from=to+1n}
    catch(e){if(span<=1n)throw new Error("FastMint logs "+from+"-"+to+": "+(e.shortMessage||e.message));span/=2n}
  }
  return out;
}
const deploymentBlock=await findDeploymentBlock();
const logs=await scanFastMintLogs(deploymentBlock);
const stats={fastMintEvents:logs.length,decodedTransactions:0,decodeErrors:[],zeroRateLimiterSuccess:0,zeroFeeCalculatorSuccess:0,rateLimiters:{},feeCalculators:{},samples:[]};
const zero="0x0000000000000000000000000000000000000000";
for(const log of logs){
  try{
    const tx=await client.getTransaction({hash:log.transactionHash});
    const parsed=decodeFunctionData({abi,data:tx.input});
    let executions=[];
    if(parsed.functionName==="execute")executions=[parsed.args[0]];
    else if(parsed.functionName==="executeMultiple")executions=parsed.args[0];
    else throw new Error("Unexpected transaction method "+parsed.functionName);
    const key=String(log.args.idempotencyKey).toLowerCase();
    const execution=executions.find(x=>String(x.idempotencyKey??x[0]).toLowerCase()===key);
    if(!execution)throw new Error("FastMint idempotency key not found in transaction calldata");
    const actions=execution.actions??execution[1];
    const decoded=actions.map(raw=>decodeAbiParameters(actionParams,raw)).find(x=>x[0]===3);
    if(!decoded)throw new Error("FAST_MINT action missing in calldata");
    const [,recipient,tokenId,amount,feeCalc,feeData,limiter,limiterData]=decoded;
    const fc=getAddress(feeCalc),rl=getAddress(limiter);
    stats.decodedTransactions++;
    if(rl===zero)stats.zeroRateLimiterSuccess++;
    if(fc===zero)stats.zeroFeeCalculatorSuccess++;
    stats.rateLimiters[rl]=(stats.rateLimiters[rl]||0)+1;
    stats.feeCalculators[fc]=(stats.feeCalculators[fc]||0)+1;
    if(stats.samples.length<20)stats.samples.push({
      block:log.blockNumber?.toString(),tx:log.transactionHash,idempotencyKey:key,
      recipient,tokenId:tokenId.toString(),amount:amount.toString(),feeCalculator:fc,rateLimiter:rl,
      rateLimiterDataBytes:(limiterData.length-2)/2,feeCalculatorDataBytes:(feeData.length-2)/2
    });
  }catch(e){stats.decodeErrors.push({tx:log.transactionHash,error:e.shortMessage||e.message})}
}
const [limiterAllowed,feeCalculatorAllowed,limiterCode,feeCalculatorCode]=await Promise.all([
  client.readContract({address:INBOX,abi,functionName:"isRateLimiter",args:[MANIFEST_LIMITER]}),
  client.readContract({address:INBOX,abi,functionName:"isFeeCalculator",args:[MANIFEST_FEE_CALCULATOR]}),
  client.getCode({address:MANIFEST_LIMITER}),client.getCode({address:MANIFEST_FEE_CALCULATOR})
]);
console.log(JSON.stringify({
  chainId,block:latest.toString(),oracleV2:INBOX,deploymentBlock:deploymentBlock.toString(),stats,
  manifestModules:{
    rateLimiter:{address:MANIFEST_LIMITER,hasCode:!!limiterCode&&limiterCode!=="0x",allowlisted:limiterAllowed},
    feeCalculator:{address:MANIFEST_FEE_CALCULATOR,hasCode:!!feeCalculatorCode&&feeCalculatorCode!=="0x",allowlisted:feeCalculatorAllowed}
  },
  note:"A zero rateLimiter in a successful FAST_MINT action means an oracle-authorized explicit bypass. It is not a permissionless bypass."
},null,2));
