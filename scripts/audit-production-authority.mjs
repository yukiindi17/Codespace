import { createPublicClient, http, parseAbi, getAddress, keccak256, toBytes } from "viem";

const RPC = process.env.RELAY_RPC_URL || "https://rpc.chain.relay.link";
const CHAIN_ID = 537713;
const A = {
  hub: getAddress("0xddd361727c22a01eb137880678a20b0beae69318"),
  oracleV2: getAddress("0x30e6cd00d0f6553884b151c1b1b74fd59369ff41"),
  executor: getAddress("0x946773048565893b6b6051a485c52e32e43cc2fe"),
  allocator: getAddress("0xa68dcb6ca9a7bc8cac147688f1cbfe68524b38c8"),
  oracleMultisig: getAddress("0x3036b2b6cc6172d0d306657855d4996f484a29f7"),
  poolDrawResolver: getAddress("0xbc8aa4624a503d5c85bbf0e969f141da60216af9"),
  basicCallResolver: getAddress("0xb24ac15b9da6d88e283ffe048befe02e188ea64e"),
  protocolSafe: getAddress("0xd6d07a5bf6fe112051740f37a2df08699b9df782"),
  config: getAddress("0x8162beec776442afd262b672730bb5d0d8af16a1"),
  withdrawGasPayer: getAddress("0x17b8e9d9455b64033ddc22d0490e995a1e69c479"),
  rateLimiter: getAddress("0x23afd9e0348c058eba84c434d9c6b508cea764e6"),
  feeCalculator: getAddress("0xdd7d96282b7fda7c83aca1ed8d09733ad51caa09"),
};
const client = createPublicClient({ transport: http(RPC, { timeout: 60_000 }) });
const chainId = await client.getChainId();
if (chainId !== CHAIN_ID) throw new Error(`Wrong chain id ${chainId}`);
const latest = await client.getBlockNumber();
const hubAbi = parseAbi([
  "function ADMIN_ROLE() view returns (bytes32)",
  "function OPERATOR_ROLE() view returns (bytes32)",
  "function EDITOR_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function getRoleAdmin(bytes32) view returns (bytes32)",
  "function isOperator(address,address) view returns (bool)",
]);
const oracleV2Abi = parseAbi([
  "function ADMIN_ROLE() view returns (bytes32)",
  "function ORACLE_ROLE() view returns (bytes32)",
  "function IDEMPOTENCY_STORE() view returns (address)",\n  "function HUB() view returns (address)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function isRateLimiter(address) view returns (bool)",
  "function isFeeCalculator(address) view returns (bool)",
]);
const execAbi = parseAbi([
  "function ADMIN_ROLE() view returns (bytes32)",
  "function ORACLE_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
]);
const allocAbi = parseAbi([
  "function owner() view returns (address)",\n  "function HUB() view returns (address)",
  "function ORACLE_MULTISIG() view returns (address)",
  "function suspended(address) view returns (bool)",
  "function payloadBuilders(string,bytes) view returns (address)",
]);
const roleEvents = parseAbi([
  "event RoleGranted(bytes32 indexed role,address indexed account,address indexed sender)",
  "event RoleRevoked(bytes32 indexed role,address indexed account,address indexed sender)",
]);
async function scan(event,address,label){
  let from=0n, span=50_000n; const out=[];
  while(from<=latest){
    const to=from+span-1n>latest?latest:from+span-1n;
    try{out.push(...await client.getLogs({address,event,fromBlock:from,toBlock:to}));from=to+1n}
    catch(e){if(span<=100n)throw new Error(label+" "+from+"-"+to+": "+(e.shortMessage||e.message));span/=5n}
  }
  return out;
}
const roleIds = {
  hub: {
    ADMIN_ROLE: await client.readContract({address:A.hub,abi:hubAbi,functionName:"ADMIN_ROLE"}),
    OPERATOR_ROLE: await client.readContract({address:A.hub,abi:hubAbi,functionName:"OPERATOR_ROLE"}),
    EDITOR_ROLE: await client.readContract({address:A.hub,abi:hubAbi,functionName:"EDITOR_ROLE"}),
  },
  oracleV2: {
    ADMIN_ROLE: await client.readContract({address:A.oracleV2,abi:oracleV2Abi,functionName:"ADMIN_ROLE"}),
    ORACLE_ROLE: await client.readContract({address:A.oracleV2,abi:oracleV2Abi,functionName:"ORACLE_ROLE"}),
  },
  executor: {
    ADMIN_ROLE: await client.readContract({address:A.executor,abi:execAbi,functionName:"ADMIN_ROLE"}),
    ORACLE_ROLE: await client.readContract({address:A.executor,abi:execAbi,functionName:"ORACLE_ROLE"}),
  }
};
const contracts = [
  ["oracleV2",A.oracleV2],["executor",A.executor],["allocator",A.allocator],
  ["oracleMultisig",A.oracleMultisig],["poolDrawResolver",A.poolDrawResolver],
  ["basicCallResolver",A.basicCallResolver],["protocolSafe",A.protocolSafe],
  ["config",A.config],["withdrawGasPayer",A.withdrawGasPayer],
  ["rateLimiter",A.rateLimiter],["feeCalculator",A.feeCalculator]
];
const hubLogs=(await Promise.all(roleEvents.map((event,i)=>scan(event,A.hub,"Hub role event "+i)))).flat();
const active = {};
for(const [name,role] of Object.entries(roleIds.hub)){
  const set=new Map();
  for(const l of hubLogs.filter(x=>x.args.role===role).sort((a,b)=>a.blockNumber===b.blockNumber?Number(a.logIndex-b.logIndex):a.blockNumber<b.blockNumber?-1:1)){
    const who=getAddress(l.args.account);
    if(l.eventName==="RoleGranted")set.set(who.toLowerCase(),who); else set.delete(who.toLowerCase());
  }
  active[name]=[...set.values()];
}
const contractCode={};
for(const [name,address] of contracts){const code=await client.getCode({address});contractCode[name]={address,hasCode:!!code&&code!=="0x",bytes:code&&code!=="0x"?(code.length-2)/2:0};}
const oracleV2Roles={};
for(const [name,role] of Object.entries(roleIds.oracleV2)){
  oracleV2Roles[name]={role,knownMembers:{}};
  for(const [label,address] of [["oracleMultisig",A.oracleMultisig],["protocolSafe",A.protocolSafe],["config",A.config],["withdrawGasPayer",A.withdrawGasPayer]]){
    oracleV2Roles[name].knownMembers[label]=await client.readContract({address:A.oracleV2,abi:oracleV2Abi,functionName:"hasRole",args:[role,address]});
  }
}
const execRoles={};
for(const [name,role] of Object.entries(roleIds.executor)){
  execRoles[name]={role,knownMembers:{}};
  for(const [label,address] of [["oracleMultisig",A.oracleMultisig],["protocolSafe",A.protocolSafe],["config",A.config],["withdrawGasPayer",A.withdrawGasPayer]]){
    execRoles[name].knownMembers[label]=await client.readContract({address:A.executor,abi:execAbi,functionName:"hasRole",args:[role,address]});
  }
}
const [idempotencyStore, oracleV2RateLimiterAllowed, oracleV2FeeCalculatorAllowed, allocatorOwner, allocatorOracle, oracleHub, executorHub, executorAllocator, allocatorHub] = await Promise.all([
  client.readContract({address:A.oracleV2,abi:oracleV2Abi,functionName:"IDEMPOTENCY_STORE"}),
  client.readContract({address:A.oracleV2,abi:oracleV2Abi,functionName:"isRateLimiter",args:[A.rateLimiter]}),
  client.readContract({address:A.oracleV2,abi:oracleV2Abi,functionName:"isFeeCalculator",args:[A.feeCalculator]}),
  client.readContract({address:A.allocator,abi:allocAbi,functionName:"owner"}),
  client.readContract({address:A.allocator,abi:allocAbi,functionName:"ORACLE_MULTISIG"}),\n  client.readContract({address:A.oracleV2,abi:oracleAbi,functionName:"HUB"}),\n  client.readContract({address:A.executor,abi:execAbi,functionName:"HUB"}),\n  client.readContract({address:A.executor,abi:execAbi,functionName:"ALLOCATOR"}),\n  client.readContract({address:A.allocator,abi:allocAbi,functionName:"HUB"}),
]);
const operatorChecks={};
for(const [label,address] of contracts){
  operatorChecks[label]=await client.readContract({address:A.hub,abi:hubAbi,functionName:"hasRole",args:[roleIds.hub.OPERATOR_ROLE,address]});
}
const allocatorAliases={};
for(const [label,address] of contracts){
  allocatorAliases[label]=await client.readContract({address:A.allocator,abi:allocAbi,functionName:"suspended",args:[address]});
}
console.log(JSON.stringify({
  chainId,block:latest.toString(),contractCode,
  hubRoles:{activeMembers:active,roleAdmin:{
    ADMIN_ROLE:await client.readContract({address:A.hub,abi:hubAbi,functionName:"getRoleAdmin",args:[roleIds.hub.ADMIN_ROLE]}),
    OPERATOR_ROLE:await client.readContract({address:A.hub,abi:hubAbi,functionName:"getRoleAdmin",args:[roleIds.hub.OPERATOR_ROLE]}),
    EDITOR_ROLE:await client.readContract({address:A.hub,abi:hubAbi,functionName:"getRoleAdmin",args:[roleIds.hub.EDITOR_ROLE]})
  },knownContractOperatorMembership:operatorChecks},
  oracleV2:{roles:oracleV2Roles,idempotencyStore,rateLimiter:A.rateLimiter,rateLimiterAllowed:oracleV2RateLimiterAllowed,feeCalculator:A.feeCalculator,feeCalculatorAllowed:oracleV2FeeCalculatorAllowed,hub:oracleHub,hubMatchesManifest:oracleHub.toLowerCase()===A.hub.toLowerCase()},
  executor:{roles:execRoles,hub:executorHub,allocator:executorAllocator,hubMatchesManifest:executorHub.toLowerCase()===A.hub.toLowerCase(),allocatorMatchesManifest:executorAllocator.toLowerCase()===A.allocator.toLowerCase()},
  allocator:{owner:allocatorOwner,hub:allocatorHub,oracleMultisig:allocatorOracle,hubMatchesManifest:allocatorHub.toLowerCase()===A.hub.toLowerCase(),knownAddressSuspensions:allocatorAliases},
},null,2));
