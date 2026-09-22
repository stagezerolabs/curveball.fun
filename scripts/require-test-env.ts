const args = process.argv.slice(2);
const separator = args.indexOf("--");

if (separator < 1 || separator === args.length - 1) {
  console.error(
    "Usage: bun scripts/require-test-env.ts ENV_NAME [ENV_NAME...] -- command [args...]",
  );
  process.exit(2);
}

const required = args.slice(0, separator);
const command = args.slice(separator + 1);
const missing = required.filter((name) => !Bun.env[name]?.trim());

if (missing.length > 0) {
  console.error(`Missing required integration-test environment: ${missing.join(", ")}`);
  process.exit(2);
}

const child = Bun.spawn(command, {
  cwd: process.cwd(),
  env: Bun.env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(await child.exited);
