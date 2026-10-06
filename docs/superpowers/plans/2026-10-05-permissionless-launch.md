# Permissionless launch implementation plan

1. **Contract:** change the new V2 factory source to allow creation from every wallet at deployment and remove curve buy authorization. Keep event signatures and financial invariants. Prove direct launch, launch-and-buy, arbitrary buyer, ownership restrictions, and graduation with Foundry tests.
2. **UX:** use the [launch prototype](../../ux/permissionless-launch-prototype.md) to present required details, wallet connection, transaction progress, and redirect. Preserve truthful legacy invitation states until the new address is active.
3. **Data and routing:** set the new factory as `LAUNCHPAD_ADDRESS` and use its deployment block as `INDEXER_START_BLOCK`. The existing deployment filter gives Markets a fresh list while old rows remain stored. The app routes writes only to the active factory.
4. **Deployment preparation:** prepare a separate replacement deployment script and artifact path. Verify address, chain, code, services, public access, and start block locally. Do not overwrite the existing deployment record.
5. **Validation:** run focused frontend and backend tests, full Foundry suite, bytecode check, typecheck, build, and local integration. Independently review contract/account authority and affected data paths.
6. **Activation:** after the implementation is reviewable, request exact diff-bound approval for any testnet broadcast, database migration, or hosted configuration change. Existing deployments remain unchanged until then.
