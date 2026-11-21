import { createPublicClient, http, parseAbi, getAddress } from "viem";
const client = createPublicClient({ transport: http(process.env.RELAY_RPC_URL || "https://rpc.chain.relay.link", { timeout: 30_000 }) });
const chainId = await client.getChainId();
if (chainId !== 537713) throw new Error(`Wrong chain id ${chainId}`);
const inbox = getAddress("0x30e6Cd00D0F6553884B151c1B1B74FD59369ff41");
const limiter = getAddress("0x23AFd9E0348C058EBA84C434d9C6B508CEA764E6");
const abi = parseAbi([
 "event FastMint(bytes32 indexed idempotencyKey,address hubToAddress,uint256 hubTokenId,uint256 amount,uint256 feeCurrency,uint256 feeAmount,address feeRecipient,address feePayer)",
 "event TokensConsumed(uint256 indexed tokenId,uint256 amount,uint256 remaining)"
]);
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
 byTx.get(k).push({tokenId:l.args.tokenId.toString(),amount:l.args.amount.toString(),remaining:l.args.remaining.toString()});
}
const unmatched=[];
for(const l of fast){
 const entries=byTx.get(l.transactionHash.toLowerCase())||[];
 const idx=entries.findIndex(x=>x.tokenId===l.args.hubTokenId.toString()&&x.amount===l.args.amount.toString());
 if(idx<0) unmatched.push({tx:l.transactionHash,block:l.blockNumber.toString(),tokenId:l.args.hubTokenId.toString(),amount:l.args.amount.toString(),recipient:l.args.hubToAddress});
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
