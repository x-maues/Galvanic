// Hand-authored client wrapper, modeled on the generated-code pattern used by
// the Keeper Bot / Event Reactor templates (contracts/evm/ts/generated/*.ts
// there are produced by the CRE contract codegen once a real Foundry project
// is wired up). We don't have a deployed contract or a Foundry toolchain in
// this pass, so this file is written by hand against the same ABI shape the
// codegen would produce for `contracts/evm/src/FirewallMarginExecutor.sol`.
//
// NOT CODE-GENERATED. Regenerate/replace this once the real vault/executor is
// deployed and `cre` contract codegen (or forge + the CRE codegen script) is
// run against its actual ABI.
import type { EVMClient, Report, Runtime } from '@chainlink/cre-sdk'
import type { Address } from 'viem'

export const FirewallMarginExecutorABI = [
	{
		type: 'function',
		name: 'onReport',
		inputs: [
			{ name: 'metadata', type: 'bytes' },
			{ name: 'report', type: 'bytes' },
		],
		outputs: [],
		stateMutability: 'nonpayable',
	},
	{
		type: 'function',
		name: 'executeLiquidation',
		inputs: [
			{ name: 'account', type: 'address' },
			{ name: 'amountUsd', type: 'uint256' },
		],
		outputs: [],
		stateMutability: 'nonpayable',
	},
] as const

export class FirewallMarginExecutor {
	constructor(
		private readonly client: EVMClient,
		public readonly address: Address,
	) {}

	/**
	 * Delivers an already-generated DON-signed `Report` (from `donRuntime.report(...)`)
	 * to this contract via the CRE Forwarder. The Forwarder calls `onReport`,
	 * which (via `ReceiverTemplate`) decodes the report payload as
	 * `(uint8 action, address account, uint256 amountUsd)` and applies the
	 * confidential policy state transition to the vault.
	 */
	deliver(runtime: Runtime<unknown>, report: Report, gasConfig?: { gasLimit?: string }) {
		return this.client
			.writeReport(runtime, {
				receiver: this.address,
				report,
				gasConfig,
			})
			.result()
	}
}
