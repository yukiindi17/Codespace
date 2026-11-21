const addresses={
 inbox:"0x30e6Cd00D0F6553884B151c1B1B74FD59369ff41",
 limiter:"0x23AFd9E0348C058EBA84C434d9C6B508CEA764E6"
};
for(const [name,address] of Object.entries(addresses)){
 const url=`https://explorer.chain.relay.link/api/v2/smart-contracts/${address}`;
 const res=await fetch(url,{headers:{accept:"application/json"}});
 const raw=await res.text();
 if(!res.ok){console.log(JSON.stringify({name,address,status:res.status,body:raw.slice(0,1000)}));continue;}
 const j=JSON.parse(raw);
 const src=typeof j.source_code==="string"?j.source_code:"";
 const abi=j.abi||[];
 const events=abi.filter(x=>x.type==="event").map(x=>({name:x.name,inputs:x.inputs?.map(i=>({name:i.name,type:i.type,indexed:i.indexed}))}));
 const funcs=abi.filter(x=>x.type==="function").map(x=>x.name);
 const terms=name==="limiter"?["function consume","event TokensConsumed","function getBucket","event BucketConfigSet"]:["function _executeFastMint","rateLimiter","function executeMultiple","event FastMint"];
 const snippets=[];
 for(const term of terms){const pos=src.toLowerCase().indexOf(term.toLowerCase());if(pos>=0)snippets.push({term,snippet:src.slice(Math.max(0,pos-250),pos+1800)});}
 console.log(JSON.stringify({name,address,is_verified:j.is_verified,contract_name:j.name,compiler_version:j.compiler_version,implementation_address:j.implementations?.[0]?.address||j.implementation_address,abiEvents:events,hasGetBucket:funcs.includes("getBucket"),functions:funcs.filter(x=>/consume|getBucket|execute|rate|fee/i.test(x)),snippets},null,2));
}
