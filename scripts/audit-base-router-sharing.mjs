import { createPublicClient, http, parseAbi, getAddress, formatUnits } from "viem";

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const CHAIN_ID = 8453;
const ROUTER = getAddress("0xab86c681c081c9125be8ef3af374d3b409e4484f");
const RELAY_DEPOSITORY = getAddress("0x4cD00E387622C35bDDB9b4c962C136462338BC31");
const GATEWAY_DEPOSITORY = getAddress("0x251e4b432d5c69d8f4d3d31aae4ae4f3c4816fc7");
const COUNCIL = getAddress("0xF61A305199fa1135d76FFaB3752D42F55cBd775A");
const abi = parseAbi([
  "function ADMIN_ROLE() view returns (bytes32)",
  "function DEPOSITORY_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function getRoleAdmin(bytes32) view returns (bytes32)"
]);
const tokens = [
  ["USDC",getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")],
  ["WETH",getAddress("0x4200000000000000000000000000000000000006")],
  ["USDbC",getAddress("0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA")],
  ["USDT",getAddress("0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2")]
];
const client=createPublicClient({transport:http(RPC,{timeout:60_000})});
const chainId=await client.getChainId();
if(chainId!==CHAIN_ID)throw new Error("Wrong Base RPC chain "+chainId);
const block=await client.getBlockNumber();
const code=await client.getCode({address:ROUTER});
const [adminRole,depositoryRole]=await Promise.all([
  client.readContract({address:ROUTER,abi,functionName:"ADMIN_ROLE"}),
  client.readContract({address:ROUTER,abi,functionName:"DEPOSITORY_ROLE"})
]);
const memberships={};
for(const [label,address] of [["relayDepository",RELAY_DEPOSITORY],["gatewayDepository",GATEWAY_DEPOSITORY],["council",COUNCIL]]){
  memberships[label]={address,admin:await client.readContract({address:ROUTER,abi,functionName:"hasRole",args:[adminRole,address]}),depository:await client.readContract({address:ROUTER,abi,functionName:"hasRole",args:[depositoryRole,address]})};
}
const tokenBalances=[];
for(const [name,address] of tokens){
  const tokenAbi=parseAbi(["function balanceOf(address) view returns (uint256)","function decimals() view returns (uint8)"]);
  const [balance,decimals]=await Promise.all([
    client.readContract({address,abi:tokenAbi,functionName:"balanceOf",args:[ROUTER]}),
    client.readContract({address,abi:tokenAbi,functionName:"decimals"})
  ]);
  tokenBalances.push({name,address,raw:balance.toString(),formatted:formatUnits(balance,decimals),decimals});
}
console.log(JSON.stringify({
  chainId,block:block.toString(),router:ROUTER,routerHasCode:!!code&&code!=="0x",runtimeBytes:code&&code!=="0x"?(code.length-2)/2:0,
  councilAdmin:await client.readContract({address:ROUTER,abi,functionName:"hasRole",args:[adminRole,COUNCIL]}),
  memberships,tokenBalances,
  note:"Read-only current Base state. Balances are only a small known-token sample, not a complete ERC20 inventory."
},null,2));
