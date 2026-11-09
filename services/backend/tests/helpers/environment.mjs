// Configure only the required values; tests never connect to this database.
export function configureTestEnvironment() {
  Object.assign(process.env, {
    SOCIAL_LAUNCHPAD_ADDRESS: "0x0000000000000000000000000000000000000001",
    SOCIAL_ADMIN_ADDRESS: "0x0000000000000000000000000000000000000002",
    SOCIAL_DATABASE_URL: "postgres://test:test@localhost:5432/test",
    SOCIAL_DEPLOYMENT_BLOCK: "1",
    PRIVY_APP_ID: "test",
    PRIVY_APP_SECRET: "test",
    SENTRY_DSN: "",
    SENTRY_BACKEND_DSN: "",
  });
}
