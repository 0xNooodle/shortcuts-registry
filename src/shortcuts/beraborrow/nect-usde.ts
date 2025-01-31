import { Builder } from '@ensofinance/shortcuts-builder';
import { RoycoClient } from '@ensofinance/shortcuts-builder/client/implementations/roycoClient';
import { walletAddress } from '@ensofinance/shortcuts-builder/helpers';
import { AddressArg, ChainIds, WeirollScript } from '@ensofinance/shortcuts-builder/types';
import { StaticJsonRpcProvider } from '@ethersproject/providers';

import { chainIdToDeFiAddresses, chainIdToTokenHolder } from '../../constants';
import { AddressData, Input, Output, Shortcut } from '../../types';
import { balanceOf, depositKodiak, mintNect, redeemNect } from '../../utils';

export class BeraborrowNectUsdeShortcut implements Shortcut {
  name = 'beraborrow-nect-usde';
  description = '';
  supportedChains = [ChainIds.Cartio, ChainIds.Berachain];
  inputs: Record<number, Input> = {
    [ChainIds.Cartio]: {
      nect: chainIdToDeFiAddresses[ChainIds.Cartio].nect,
      usde: chainIdToDeFiAddresses[ChainIds.Cartio].usde,
      usdc: chainIdToDeFiAddresses[ChainIds.Cartio].usdc,
      island: '0x0d81a1E72950575e0df6228E528F362cc5d169c4',
      primary: chainIdToDeFiAddresses[ChainIds.Cartio].kodiakRouter,
    },
    [ChainIds.Berachain]: {
      nect: chainIdToDeFiAddresses[ChainIds.Berachain].nect,
      usde: chainIdToDeFiAddresses[ChainIds.Berachain].usde,
      usdc: chainIdToDeFiAddresses[ChainIds.Berachain].usdc,
      island: '0x78F87aA41a4C32a619467d5B36e0319F3EAf2DA2',
      primary: chainIdToDeFiAddresses[ChainIds.Berachain].kodiakRouter,
    },
  };
  setterInputs = new Set(['minAmountOut', 'minAmount0Bps', 'minAmount1Bps']);

  async build(chainId: number, provider: StaticJsonRpcProvider): Promise<Output> {
    const client = new RoycoClient();

    const inputs = this.inputs[chainId];
    const { nect, usdc, usde, island } = inputs;

    const builder = new Builder(chainId, client, {
      tokensIn: [usdc, usde],
      tokensOut: [island],
    });
    const usdeAmount = builder.add(balanceOf(usde, walletAddress()));
    const usdcAmount = builder.add(balanceOf(usdc, walletAddress()));
    const mintedAmount = await mintNect(usdcAmount, builder);

    await depositKodiak(provider, builder, [nect, usde], [mintedAmount, usdeAmount], island, this.setterInputs);

    const nectLeftoversAmount = builder.add(balanceOf(nect, walletAddress()));
    await redeemNect(nectLeftoversAmount, builder);

    const payload = await builder.build({
      requireWeiroll: true,
      returnWeirollScript: true,
    });

    return {
      script: payload.shortcut as WeirollScript,
      metadata: builder.metadata,
    };
  }

  getAddressData(chainId: number): Map<AddressArg, AddressData> {
    switch (chainId) {
      case ChainIds.Cartio:
        return new Map([
          [this.inputs[ChainIds.Cartio].usde, { label: 'ERC20:USDE' }],
          [this.inputs[ChainIds.Cartio].usdc, { label: 'ERC20:USDC' }],
          [this.inputs[ChainIds.Cartio].nect, { label: 'ERC20:NECT' }],
          [this.inputs[ChainIds.Cartio].island, { label: 'Kodiak Island-nect-USDE-0.3%' }],
          [chainIdToDeFiAddresses[ChainIds.Cartio].kodiakRouter, { label: 'Kodiak Island Router' }],
        ]);
      case ChainIds.Berachain:
        return new Map([
          [this.inputs[ChainIds.Berachain].usde, { label: 'ERC20:USDE' }],
          [this.inputs[ChainIds.Berachain].usdc, { label: 'ERC20:USDC' }],
          [this.inputs[ChainIds.Berachain].nect, { label: 'ERC20:NECT' }],
          [this.inputs[ChainIds.Berachain].island, { label: 'Kodiak Island-nect-USDE-0.3%' }],
          [chainIdToDeFiAddresses[ChainIds.Berachain].kodiakRouter, { label: 'Kodiak Island Router' }],
        ]);
      default:
        throw new Error(`Unsupported chainId: ${chainId}`);
    }
  }
  getTokenHolder(chainId: number): Map<AddressArg, AddressArg> {
    const tokenToHolder = chainIdToTokenHolder.get(chainId);
    if (!tokenToHolder) throw new Error(`Unsupported 'chainId': ${chainId}`);

    return tokenToHolder as Map<AddressArg, AddressArg>;
  }
}
