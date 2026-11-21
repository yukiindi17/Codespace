import { createPublicClient, http, parseAbi, getAddress, keccak256, toBytes } from "viem";

const RPC=process.env.RELAY_RPC_URL||"https://rpc.chain.relay.link";
const CHAIN_ID=537713;
const HUB=getAddress("0xddd361727c22a01eb137880678a20b0beae69318");
const ADDRESSES={
  council:"0xF61A305199fa1135d76FFaB3752D42F55cBd775A",
  legacyAllocator:"0x613D3c588F6B8f89302b463F8F19f7241B2857E2",
  legacyOracleV2:"0xd180Dc3b8Cb71b185c563B6e4857592cA93dACAf",
  legacyExecutorOrOracle:"0x6747c7e64B90DCcc0D54F865cBd9513156adBC0c",
  currentAllocator:"0xa68dcb6ca9a7bc8cac147688f1cbfe68524b38c8",
  currentExecutor:"0x946773048565893b6b6051a485c52e32e43cc2fe",
  currentInbox:"0x30e6cd00d0f6553884b151c1b1b74fd59369ff41",
  oldOracleSigner:"0x2A72EB8Cf0233A3DC6198683c83B1078DE6Fa2B0",
  currentOracleMultisig:"0x3036b2b6cc6172d0d306657855d4996f484a29f7"
};
const client=createPublicClient({transport:http(RPC,{timeout:60_000})});
const chainId=await client.getChainId();if(chainId!==CHAIN_ID)throw new Error("Wrong chain "+chainId);
const block=await client.getBlockNumber();
const hubAbi=parseAbi(["function OPERATOR_ROLE() view returns (bytes32)","function hasRole(bytes32,address) view returns (bool)"]);
const opRole=await client.readContract({address:HUB,abi:hubAbi,functionName:"OPERATOR_ROLE"});
const allocatorAbi=parseAbi(["function owner() view returns (address)","function ORACLE_MULTISIG() view returns (address)","function suspended(address) view returns (bool)"]);
const oracleAbi=parseAbi(["function ORACLE_ROLE() view returns (bytes32)","function hasRole(bytes32,address) view returns (bool)","function owner() view returns (address)","function getSigners() view returns (address[])","function threshold() view returns (uint256)"]);
const report={chainId,block:block.toString(),hub:HUB,operatorRole:opRole,contracts:{}};
const codeHashes={};
for(const [label,raw] of Object.entries(ADDRESSES)){
 if(label==="oldOracleSigner"||label==="currentOracleMultisig")continue;
 const address=getAddress(raw),code=await client.getCode({address});
 const item={address,hasCode:!!code&&code!=="0x",runtimeBytes:code&&code!=="0x"?(code.length-2)/2:0,codeHash:code&&code!=="0x"?keccak256(toBytes(code)):null,hubOperator:await client.readContract({address:HUB,abi:hubAbi,functionName:"hasRole",args:[opRole,address]})};
 if(label.toLowerCase().includes("allocator")){
   for(const [k,fn,args] of [["owner","owner",[]],["oracleMultisig","ORACLE_MULTISIG",[]]])try{item[k]=await client.readContract({address,abi:allocatorAbi,functionName:fn})}catch{}
 }
 if(label.toLowerCase().includes("oracle")||label.toLowerCase().includes("executor")){
   try{const role=await client.readContract({address,abi:oracleAbi,functionName:"ORACLE_ROLE"});item.oracleRole=role;item.oldSignerHasOracleRole=await client.readContract({address,abi:oracleAbi,functionName:"hasRole",args:[role,getAddress(ADDRESSES.oldOracleSigner)]});item.currentMultisigHasOracleRole=await client.readContract({address,abi:oracleAbi,functionName:"hasRole",args:[role,getAddress(ADDRESSES.currentOracleMultisig)]})}catch{}
   try{item.owner=await client.readContract({address,abi:oracleAbi,functionName:"owner"})}catch{}
   try{item.signers=await client.readContract({address,abi:oracleAbi,functionName:"getSigners"});item.threshold=(await client.readContract({address,abi:oracleAbi,functionName:"threshold"})).toString()}catch{}
 }
 codeHashes[label]=item.codeHash;
 report.contracts[label]=item;
}
for(const [a,b] of [["legacyAllocator","currentAllocator"],["legacyOracleV2","currentInbox"],["legacyExecutorOrOracle","currentExecutor"]]){
 report.contracts[a].runtimeMatchesCurrent=!!codeHashes[a]&&codeHashes[a]===codeHashes[b];
}
console.log(JSON.stringify(report,null,2));
