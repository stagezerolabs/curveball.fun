const MAX_LINK_LENGTH = 256;
export const MAX_BIO_LENGTH = 160;
export const MAX_DESCRIPTION_LENGTH = 1_000;

const linkHosts = {
  website: null,
  xUrl: new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]),
  telegramUrl: new Set(["t.me", "www.t.me"]),
  discordUrl: new Set([
    "discord.gg",
    "www.discord.gg",
    "discord.com",
    "www.discord.com",
  ]),
};

function text(value, maximum) {
  return typeof value === "string"
    ? value.trim().slice(0, maximum) || null
    : null;
}

function link(value, kind) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > MAX_LINK_LENGTH
  )
    return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const hosts = linkHosts[kind];
    if (hosts && !hosts.has(url.hostname.toLowerCase())) return null;
    if (
      kind === "discordUrl" &&
      url.hostname.toLowerCase().endsWith("discord.com") &&
      !url.pathname.startsWith("/invite/")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function readLaunchDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return {
      bio: null,
      description: null,
      website: null,
      xUrl: null,
      telegramUrl: null,
      discordUrl: null,
    };
  return {
    bio: text(value.bio, MAX_BIO_LENGTH),
    description: text(value.description, MAX_DESCRIPTION_LENGTH),
    website: link(value.website ?? value.external_url, "website"),
    xUrl: link(value.xUrl, "xUrl"),
    telegramUrl: link(value.telegramUrl, "telegramUrl"),
    discordUrl: link(value.discordUrl, "discordUrl"),
  };
}

export function normalizeLaunchDetails(value) {
  const fields = [
    ["bio", MAX_BIO_LENGTH, "Bio"],
    ["description", MAX_DESCRIPTION_LENGTH, "Description"],
  ];
  for (const [key, maximum, label] of fields) {
    const raw = value[key] ?? "";
    if (typeof raw !== "string" || raw.trim().length > maximum)
      throw new Error(`${label} must be ${maximum} characters or fewer.`);
  }
  for (const [key, label] of [
    ["website", "Website"],
    ["xUrl", "X"],
    ["telegramUrl", "Telegram"],
    ["discordUrl", "Discord"],
  ]) {
    const raw = value[key] ?? "";
    if (typeof raw !== "string" || (raw.trim() && !link(raw, key)))
      throw new Error(`${label} must be a valid HTTPS link.`);
  }
  return readLaunchDetails(value);
}
