const addresses={
 oldHyperliquidBuilder:"0x69719e3B08C6f12Dd89A84A9B0f33dEfd762c94E",
 currentHyperliquidBuilder:"0xC5f8dF1448091ceEca0fb3699125d9e8b171a8dF",
 oldTonBuilder:"0x309cCc6Ff134b1a572d12DfcC9f393229DDa0069",
 currentTonBuilder:"0x4250E7e094eE62F38c86528E01799a052b2FDd03",
 oldAllocator:"0x613D3c588F6B8f89302b463F8F19f7241B2857E2",
 currentAllocator:"0xa68dcB6ca9A7bC8cAC147688F1Cbfe68524b38C8"
};
for(const [name,address] of Object.entries(addresses)){
 const url=`https://explorer.chain.relay.link/api/v2/smart-contracts/${address}`;
 try{
  const res=await fetch(url,{headers:{accept:"application/json"}});
  const raw=await res.text();
  if(!res.ok){console.log(JSON.stringify({name,address,status:res.status,body:raw.slice(0,500)}));continue}
  const j=JSON.parse(raw);
  const src=typeof j.source_code==="string"?j.source_code:JSON.stringify(j.additional_sources||{});
  const snippets=[];
  for(const term of ["nonce","seed","withdrawalsThisSecond","buildPayload","expiration"]){
   const i=src.toLowerCase().indexOf(term.toLowerCase());
   if(i>=0)snippets.push({term,snippet:src.slice(Math.max(0,i-300),i+900)});
  }
  console.log(JSON.stringify({name,address,is_verified:j.is_verified,contract_name:j.name,compiler_version:j.compiler_version,optimization_enabled:j.optimization_enabled,implementation_address:j.implementations?.[0]?.address||j.implementation_address,abiFunctions:(j.abi||[]).filter(x=>x.type==="function").map(x=>x.name),snippets},null,2));
 }catch(e){console.log(JSON.stringify({name,address,error:String(e)}))}
}
