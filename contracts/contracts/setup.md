these are going to be the layout of our contracts.

the system as a whole is made up of many subsystems

1. launch factory which is the main orchestrator
2. launch deployer deploys launch components
3. launchertoken is a fixed supply ERC20
4. bonding curve is the initial market
5. graduation guard checks if graduation can succeed
6. graduation executor performs all needed setup and initialization for the pool on icarus
7. launch locker permamnetly locks the LP positions
8. meme hook sets up trading fee mechanism on icarus
9. fee escrow to track claimable fees
10. buyback vault to Holds/vests buyback tokens
11. launch and buy to Optional atomic launch + buy
