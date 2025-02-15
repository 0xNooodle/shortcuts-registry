import { Builder } from '@ensofinance/shortcuts-builder';
import { RoycoClient } from '@ensofinance/shortcuts-builder/client/implementations/roycoClient';
import { AddressArg, ChainIds, WeirollScript } from '@ensofinance/shortcuts-builder/types';

import { chainIdToTokenHolder } from '../../constants';
import type { AddressData, Input, Output, Shortcut } from '../../types';
import { ensureMinAmountOut, getBalance, mintErc4626 } from '../../utils';

export class DolomiteDYlPumpBtcShortcut implements Shortcut {
  name = 'dolomite-dylpumpbtc';
  description = '';
  supportedChains = [ChainIds.Cartio, ChainIds.Berachain];
  inputs: Record<number, Input> = {
    [ChainIds.Cartio]: {
      ylpumpbtc: '0x4Ebd8983Ca3b7c3621cdB9AD87191f2cB5677726', // yl-pumpBTC
      vault: '0xC6AdB1e9cb781b9573B2cB83809E318D9619BC74', // dyl-pumpBTC
    },
    [ChainIds.Berachain]: {
      ylpumpbtc: '0xdCB3D91555385DaE23e6B966b5626aa7A75Be940', // yl-pumpBTC
      vault: '0xC6AdB1e9cb781b9573B2cB83809E318D9619BC74', // dyl-pumpBTC
    },
  };
  setterInputs = new Set(['minAmountOut']);

  async build(chainId: number): Promise<Output> {
    const client = new RoycoClient();

    const inputs = this.inputs[chainId];
    const { ylpumpbtc, vault } = inputs;

    const builder = new Builder(chainId, client, {
      tokensIn: [ylpumpbtc],
      tokensOut: [vault],
    });

    const ylpumpbtcAmount = getBalance(ylpumpbtc, builder);
    const vaultAmount = await mintErc4626(ylpumpbtc, vault, ylpumpbtcAmount, builder);

    ensureMinAmountOut(vaultAmount, builder);

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
          [this.inputs[ChainIds.Cartio].ylpumpbtc, { label: 'ERC20:yl-pumpBTC' }],
          [this.inputs[ChainIds.Cartio].vault, { label: 'ERC20:dyl-pumpBTC' }],
        ]);
      case ChainIds.Berachain:
        return new Map([
          [this.inputs[ChainIds.Berachain].ylpumpbtc, { label: 'ERC20:yl-pumpBTC' }],
          [this.inputs[ChainIds.Berachain].vault, { label: 'ERC20:dyl-pumpBTC' }],
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
