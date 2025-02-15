import { AddressArg, ChainIds } from '@ensofinance/shortcuts-builder/types';
import { Interface } from '@ethersproject/abi';
import { BigNumber, BigNumberish } from '@ethersproject/bignumber';
import { StaticJsonRpcProvider } from '@ethersproject/providers';

import { chainIdToDeFiAddresses } from '../constants';
import { APITransaction, QuoteRequest, simulateTransactionOnQuoter } from '../simulations/simulateOnQuoter';
import { Campaign } from '../types';
import { getSimulationRolesByChainId } from './utils';

const depositExecutorCreationBlock: Record<number, number> = {
  [ChainIds.Cartio]: 4417729,
  [ChainIds.Berachain]: 148757,
};
async function call(
  provider: StaticJsonRpcProvider,
  iface: Interface,
  target: string,
  method: string,
  args: ReadonlyArray<BigNumberish>,
) {
  const data = await provider.call({
    to: target,
    data: iface.encodeFunctionData(method, args),
  });
  return iface.decodeFunctionResult(method, data);
}

async function quote(
  chainId: number,
  iface: Interface,
  target: string,
  method: string,
  args: ReadonlyArray<BigNumberish>,
  tokenIn: AddressArg,
  tokenOut: AddressArg,
  amountIn: string,
) {
  const data = iface.encodeFunctionData(method, args);
  const tx: APITransaction = {
    data,
    value: '0',
    to: target,
    from: '0x93621DCA56fE26Cdee86e4F6B18E116e9758Ff11',
  };

  const request: QuoteRequest = {
    chainId,
    transactions: [tx],
    tokenIn: [tokenIn],
    amountIn: [amountIn],
    tokenOut: [tokenOut],
  };

  const response = (await simulateTransactionOnQuoter(request))[0];
  if (response.status === 'Error') throw 'Quote error';
  return response.amountOut[0];
}

export function getEncodedData(commands: string[], state: string[]): string {
  const weirollWalletInterface = new Interface([
    'function executeWeiroll(bytes32[] calldata commands, bytes[] calldata state) external payable returns (bytes[] memory)',
  ]);
  return weirollWalletInterface.encodeFunctionData('executeWeiroll', [commands, state]);
}

export async function getUniswapLiquidity(
  provider: StaticJsonRpcProvider,
  lpToken: AddressArg,
  liquidity: BigNumberish,
) {
  const lpInterface = new Interface([
    'function token0() external view returns (address)',
    'function token1() external view returns (address)',
    'function totalSupply() external view returns (uint256)',
  ]);
  const [token0Response, token1Response] = await Promise.all([
    call(provider, lpInterface, lpToken, 'token0', []),
    call(provider, lpInterface, lpToken, 'token1', []),
  ]);
  const [token0, token1] = [token0Response[0], token1Response[0]];
  const [balance0, balance1] = await getBalances(provider, lpToken, [token0, token1]);
  const totalSupply = (await call(provider, lpInterface, lpToken, 'totalSupply', []))[0];
  const amount0 = BigNumber.from(liquidity).mul(balance0).div(totalSupply).toString();
  const amount1 = BigNumber.from(liquidity).mul(balance1).div(totalSupply).toString();
  return { amount0, amount1, token0, token1 };
}

export async function getHoneyExchangeRate(
  provider: StaticJsonRpcProvider,
  chainId: number,
  underlyingToken: AddressArg,
): Promise<BigNumber> {
  const honeyFactoryInterface = new Interface(['function mintRates(address) external view returns (uint256)']);
  const honeyFactory = chainIdToDeFiAddresses[chainId]!.honeyFactory;
  return (await call(provider, honeyFactoryInterface, honeyFactory, 'mintRates', [underlyingToken]))[0] as BigNumber;
}

export async function getBeraEthExchangeRate(provider: StaticJsonRpcProvider, chainId: number): Promise<BigNumber> {
  const addresses = chainIdToDeFiAddresses[chainId];
  if (!addresses) {
    throw new Error(`No addresses configured for chainId=${chainId}`);
  }
  const { weth, rBeraeth, beraeth } = addresses;

  /*
  const quoterInterface = new Interface([
    'function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256)',
  ]);

  const beraethInterface = new Interface([
    'function getLSTAmount(uint256 rBeraETHAmount) external view returns (uint256)',
  ]);

  // Convert 1 WETH  → rBeraETH

  const [rBeraethAmount] = await call(
    provider,
    quoterInterface,
    bridgeQuoter,
    'getAmountOut',
    [weth, BigNumber.from(10).pow(18)], // 1 WETH in wei
  );

  // Convert rBeraETH → beraETH

  const [beraethAmount] = await call(provider, beraethInterface, beraeth, 'getLSTAmount', [rBeraEthAmount]);
*/

  const amountIn = BigNumber.from(10).pow(18).toString();
  const amountOut = await quote(
    chainId,
    new Interface([
      'function depositAndWrap(address tokenIn, uint256 amountIn, uint256 minAmountOut) external returns (uint256)',
    ]),
    rBeraeth,
    'depositAndWrap',
    [weth, amountIn, 0],
    weth,
    beraeth,
    amountIn,
  );

  return BigNumber.from(amountOut);
}

export async function getIslandMintAmounts(
  provider: StaticJsonRpcProvider,
  island: AddressArg,
  amounts: string[],
): Promise<{ amount0: BigNumber; amount1: BigNumber; mintAmount: BigNumber }> {
  const islandInterface = new Interface([
    'function getMintAmounts(uint256, uint256) external view returns (uint256 amount0, uint256 amount1, uint256 mintAmount)',
  ]);
  const mintAmounts = await call(provider, islandInterface, island, 'getMintAmounts', amounts);
  return {
    amount0: mintAmounts.amount0,
    amount1: mintAmounts.amount1,
    mintAmount: mintAmounts.mintAmount,
  };
}

export async function getIslandTokens(
  provider: StaticJsonRpcProvider,
  island: AddressArg,
): Promise<{ token0: AddressArg; token1: AddressArg }> {
  const islandInterface = new Interface([
    'function token0() external view returns (address token)',
    'function token1() external view returns (address token)',
  ]);
  const [token0, token1] = (
    await Promise.all([
      call(provider, islandInterface, island, 'token0', []),
      call(provider, islandInterface, island, 'token1', []),
    ])
  ).map((response) => response.token);

  return {
    token0,
    token1,
  };
}

export async function getCampaignVerificationHash(
  provider: StaticJsonRpcProvider,
  chainId: number,
  marketHash: string,
): Promise<string> {
  const depositExecutorInterface = new Interface([
    'function getCampaignVerificationHash(bytes32 marketHash) external view returns (bytes32 verificationHash)',
  ]);
  const roles = getSimulationRolesByChainId(chainId);
  return (
    await call(provider, depositExecutorInterface, roles.depositExecutor.address!, 'getCampaignVerificationHash', [
      marketHash,
    ])
  ).verificationHash as string;
}

export async function getCampaign(
  provider: StaticJsonRpcProvider,
  chainId: number,
  marketHash: string,
): Promise<Campaign> {
  const depositExecutorInterface = new Interface([
    'function sourceMarketHashToDepositCampaign(bytes32 marketHash) external view returns (address owner, bool verified, uint8 numInputTokens, address receiptToken, uint256 unlockTimestamp, tuple(bytes32[] commands, bytes[] state) depositRecipe)',
  ]);
  const roles = getSimulationRolesByChainId(chainId);
  return (await call(
    provider,
    depositExecutorInterface,
    roles.depositExecutor.address!,
    'sourceMarketHashToDepositCampaign',
    [marketHash],
  )) as unknown as Campaign;
}

export async function getTotalTokenAmountDeposited(
  provider: StaticJsonRpcProvider,
  chainId: number,
  marketHash: string,
  wallet: string,
  tokens: string[],
): Promise<BigNumber[]> {
  const depositExecutorInterface = new Interface([
    'function getTotalTokenAmountDepositedInWeirollWallet(bytes32 _sourceMarketHash, address _weirollWallet, address _token) external view returns (uint256 totalAmountDeposited)',
  ]);
  const roles = getSimulationRolesByChainId(chainId);
  return Promise.all(
    tokens.map(
      async (token) =>
        (
          await call(
            provider,
            depositExecutorInterface,
            roles.depositExecutor.address!,
            'getTotalTokenAmountDepositedInWeirollWallet',
            [marketHash, wallet, token],
          )
        ).totalAmountDeposited as unknown as BigNumber,
    ),
  );
}

export async function getBalances(
  provider: StaticJsonRpcProvider,
  wallet: string,
  tokens: string[],
): Promise<BigNumber[]> {
  const tokenInterface = new Interface(['function balanceOf(address owner) external view returns (uint256 amount)']);
  return Promise.all(
    tokens.map(
      async (token) =>
        (await call(provider, tokenInterface, token, 'balanceOf', [wallet])).amount as unknown as BigNumber,
    ),
  );
}

export async function getDepositLockerAmount(provider: StaticJsonRpcProvider, marketHash: string): Promise<BigNumber> {
  const depositLockerInterface = new Interface([
    'function marketHashToMerkleDepositsInfo(bytes32 marketHash) external view returns ((uint256 _nextLeafIndex, bytes32[] _sides, bytes32[] _zeros) merkleTree, bytes32 merkleRoot, uint256 totalAmountDeposited, uint256 lastCcdmNonceBridged)',
  ]);
  const depositInfo = await call(
    provider,
    depositLockerInterface,
    '0x63E8209CAa13bbA1838E3946a50d717071A28CFB',
    'marketHashToMerkleDepositsInfo',
    [marketHash],
  );
  return depositInfo.totalAmountDeposited as BigNumber;
}

export async function getMarketInputToken(provider: StaticJsonRpcProvider, marketHash: string): Promise<AddressArg> {
  const recipeHubInterface = new Interface([
    'function marketHashToWeirollMarket(bytes32 marketHash) external view returns (uint256 marketID, address inputToken, uint256 lockupTime, uint256 frontendFee, (bytes32[] commands, bytes[] state) depositRecipe, (bytes32[] commands, bytes[] state) withdrawRecipe, uint256 rewardStyle)',
  ]);
  const marketInfo = await call(
    provider,
    recipeHubInterface,
    '0x783251f103555068c1E9D755f69458f39eD937c0',
    'marketHashToWeirollMarket',
    [marketHash],
  );
  return marketInfo.inputToken as AddressArg;
}

export async function getWeirollWallets(
  provider: StaticJsonRpcProvider,
  chainId: number,
  marketHash: string,
): Promise<AddressArg[]> {
  const depositExecutorInterface = new Interface([
    'function getWeirollWalletByCcdmNonce(bytes32 marketHash, uint256 ccdmNonce) external view returns (address wallet)',
    'event CCDMBridgeProcessed(bytes32 indexed sourceMarketHash, uint256 indexed ccdmNonce, bytes32 indexed guid, address weirollWallet)',
  ]);
  const roles = getSimulationRolesByChainId(chainId);
  const depositExecutor = roles.depositExecutor.address!;

  const wallets: AddressArg[] = [];

  const latestBlock = await provider.getBlockNumber();
  let fromBlock = depositExecutorCreationBlock[chainId];
  while (fromBlock < latestBlock) {
    let toBlock = fromBlock + 9999;
    if (toBlock > latestBlock) toBlock = latestBlock;
    const filter = {
      address: depositExecutor,
      topics: [depositExecutorInterface.getEventTopic('CCDMBridgeProcessed'), marketHash],
      fromBlock,
      toBlock,
    };
    // All params except for the weiroll wallet address are indexed so that is all that is present in the log data,
    // which we can simply decode using getWeirollWalletByCcdmNonce because it has the same return value
    (await provider.getLogs(filter)).forEach((l) =>
      wallets.push(depositExecutorInterface.decodeFunctionResult('getWeirollWalletByCcdmNonce', l.data).wallet),
    );
    fromBlock = toBlock + 1;
  }

  return [...new Set(wallets)];
}

export async function getWeirollWalletsExecuted(
  provider: StaticJsonRpcProvider,
  chainId: number,
  marketHash: string,
): Promise<AddressArg[]> {
  const depositExecutorInterface = new Interface([
    'function mockWeirollWalletsExecuted() external view returns (address[] weirollWalletsExecuted, uint256[] receiptTokensReceived)',
    'event WeirollWalletsExecutedDepositRecipe(bytes32 indexed sourceMarketHash, address[] weirollWalletsExecuted, uint256[] receiptTokensReceived)',
  ]);
  const roles = getSimulationRolesByChainId(chainId);
  const depositExecutor = roles.depositExecutor.address!;

  const wallets: AddressArg[] = [];

  const latestBlock = await provider.getBlockNumber();
  let fromBlock = depositExecutorCreationBlock[chainId];
  while (fromBlock < latestBlock) {
    let toBlock = fromBlock + 9999;
    if (toBlock > latestBlock) toBlock = latestBlock;
    const filter = {
      address: depositExecutor,
      topics: [depositExecutorInterface.getEventTopic('WeirollWalletsExecutedDepositRecipe'), marketHash],
      fromBlock,
      toBlock,
    };
    // All params except for the weiroll wallet address are indexed so that is all that is present in the log data,
    // which wedecode using mockWeirollWalletsExecuted to define the return values
    (await provider.getLogs(filter)).forEach((l) =>
      wallets.push(
        ...depositExecutorInterface.decodeFunctionResult('mockWeirollWalletsExecuted', l.data).weirollWalletsExecuted,
      ),
    );
    fromBlock = toBlock + 1;
  }

  return [...new Set(wallets)];
}
