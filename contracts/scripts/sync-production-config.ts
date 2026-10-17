export {};

const record = await Bun.file("deployments/4153/curveball.json").json() as {
  chainId: number;
  factory: string;
  deploymentBlock: string;
};
if (record.chainId !== 4_153 || !/^0x[0-9a-fA-F]{40}$/.test(record.factory) || !/^\d+$/.test(record.deploymentBlock)) {
  throw new Error("Invalid RISE mainnet deployment record.");
}

const path = ".env.production";
let source = await Bun.file(path).text();
const values = {
  VITE_CHAIN_ID: String(record.chainId),
  VITE_LAUNCHPAD_ADDRESS: record.factory,
  VITE_DEPLOYMENT_BLOCK: record.deploymentBlock,
};
for (const [key, value] of Object.entries(values)) {
  const line = `${key}=${value}`;
  source = new RegExp(`^${key}=.*$`, "m").test(source)
    ? source.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${source.trimEnd()}\n${line}\n`;
}
await Bun.write(path, source);
console.log(`Updated ${path} for ${record.factory} at block ${record.deploymentBlock}.`);
